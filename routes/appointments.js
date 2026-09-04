const express = require('express');
const { queries, getDatabase } = require('../database/db');
const { authenticateToken, authenticateTokenOrQuery, authorizeRoles } = require('../middleware/auth');
const { validateCreateAppointment, validateUpdateAppointment, validateAppointmentQuery, validateIdParam } = require('../middleware/validation');
const { computePriorityScore, priorityReasonText, evaluateConditionPriority } = require('../lib/priorityEngine');
const { subscribe, publishToDoctor, publishToAppointment, publishToAllAdmins, publishToPatient } = require('../lib/sseManager');

const router = express.Router();

// SSE stream for a single appointment (patient live tracker) - MUST come before authenticateToken middleware
// because EventSource cannot send Authorization headers
router.get('/:id/stream', validateIdParam, authenticateTokenOrQuery, (req, res) => {
  try {
    const appointment = queries.getAppointmentById.get(req.params.id);
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    // Authorization: patient owner or the doctor
    if (req.user.role === 'patient' && appointment.patient_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (req.user.role === 'doctor') {
      const doctor = queries.getDoctorByUserId.get(req.user.id);
      if (!doctor || appointment.doctor_id !== doctor.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 3000\n\n');
    res.write(`event: appointment-update\ndata: ${JSON.stringify(appointment)}\n\n`);

    subscribe(`appointment:${req.params.id}`, res);
  } catch (error) {
    console.error('SSE stream error:', error);
    res.status(500).json({ error: 'Failed to open stream' });
  }
});

// All routes require authentication (applies to routes below)
router.use(authenticateToken);

// Get patient's appointments
router.get('/my', (req, res) => {
  try {
    const appointments = queries.getAppointmentsByPatient.all(req.user.id);
    res.json({ appointments });
  } catch (error) {
    console.error('Get appointments error:', error);
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// Get patient's active next appointment for dashboard hero
router.get('/next', (req, res) => {
  try {
    const appointment = queries.getNextAppointmentByPatient.get(req.user.id);
    res.json({ appointment: appointment || null });
  } catch (error) {
    console.error('Get next appointment error:', error);
    res.status(500).json({ error: 'Failed to fetch next appointment' });
  }
});

// Get all appointments (admin/doctor)
router.get('/', authorizeRoles('admin', 'doctor'), validateAppointmentQuery, (req, res) => {
  try {
    let appointments;

    if (req.user.role === 'doctor') {
      // Get doctor's ID from user_id
      const doctor = queries.getDoctorByUserId.get(req.user.id);
      if (!doctor) {
        return res.status(404).json({ error: 'Doctor profile not found' });
      }
      appointments = queries.getAppointmentsByDoctor.all(doctor.id);
    } else {
      // Admin sees all appointments
      appointments = queries.getAllAppointments.all();
    }

    // Filter by date range if provided
    if (req.query.date_from || req.query.date_to) {
      const dateFrom = req.query.date_from || '1900-01-01';
      const dateTo = req.query.date_to || '2100-12-31';
      appointments = queries.getAppointmentsByDateRange.all(dateFrom, dateTo);
    }

    // Filter by status if provided
    if (req.query.status) {
      appointments = appointments.filter(a => a.status === req.query.status);
    }

    res.json({ appointments });
  } catch (error) {
    console.error('Get all appointments error:', error);
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// Get single appointment
router.get('/:id', validateIdParam, (req, res) => {
  try {
    const appointment = queries.getAppointmentById.get(req.params.id);

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    // Check permissions
    if (req.user.role === 'patient' && appointment.patient_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (req.user.role === 'doctor') {
      const doctor = queries.getDoctorByUserId.get(req.user.id);
      if (!doctor || appointment.doctor_id !== doctor.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.json({ appointment });
  } catch (error) {
    console.error('Get appointment error:', error);
    res.status(500).json({ error: 'Failed to fetch appointment' });
  }
});

// Helper: Log account activity and check abuse thresholds
function logActivityAndCheckAbuse(userId, activityType, appointmentId, metadata = {}) {
  try {
    const db = getDatabase();
    db.prepare('INSERT INTO account_activity (user_id, activity_type, appointment_id, metadata_json) VALUES (?, ?, ?, ?)')
      .run(userId, activityType, appointmentId, JSON.stringify(metadata));

    // Check abuse thresholds
    const thresholds = db.prepare('SELECT * FROM abuse_thresholds').all();
    for (const threshold of thresholds) {
      const windowDays = threshold.window_days;
      const windowStr = `-${windowDays} days`;
      const countResult = db.prepare(`
        SELECT COUNT(*) as count FROM account_activity
        WHERE user_id = ? AND activity_type = ? AND created_at >= datetime('now', ?)
      `).get(userId, threshold.metric.replace('_per_', ''), windowStr);
      const count = countResult?.count || 0;

      if (count >= threshold.threshold) {
        // Notify admins
        const { publishToAllAdmins } = require('../lib/sseManager');
        publishToAllAdmins({
          type: 'abuse-flag-raised',
          userId,
          flags: [{
            metric: threshold.metric,
            count,
            threshold: threshold.threshold,
            action: threshold.action,
            windowDays
          }]
        });
        break; // Notify once per booking
      }
    }
  } catch (error) {
    console.error('Log activity error:', error);
  }
}

// Helper: Check for duplicate enquiry
function checkDuplicateEnquiry(patientId, doctorId, specialtyId) {
  try {
    const db = getDatabase();
    const recentBooking = db.prepare(`
      SELECT 1 FROM appointments
      WHERE patient_id = ? AND doctor_id = ?
        AND status IN ('scheduled', 'in-progress')
        AND created_at >= datetime('now', '-1 day')
      LIMIT 1
    `).get(patientId, doctorId);

    if (recentBooking) {
      return true;
    }

    // Check same specialty within 24h
    const recentSpecialtyBooking = db.prepare(`
      SELECT 1 FROM appointments a
      JOIN doctors d ON a.doctor_id = d.id
      WHERE a.patient_id = ? AND d.specialty_id = ?
        AND a.status IN ('scheduled', 'in-progress')
        AND a.created_at >= datetime('now', '-1 day')
      LIMIT 1
    `).get(patientId, specialtyId);

    return !!recentSpecialtyBooking;
  } catch (error) {
    console.error('Check duplicate enquiry error:', error);
    return false;
  }
}

// Create new appointment (patient only)
router.post('/', authorizeRoles('patient'), validateCreateAppointment, (req, res) => {
  try {
    const { doctor_id, appointment_date, appointment_time, notes } = req.body;

    // Check if user is suspended
    const suspension = getDatabase().prepare(`
      SELECT * FROM account_suspensions
      WHERE user_id = ? AND is_active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY suspended_at DESC LIMIT 1
    `).get(req.user.id);

    if (suspension) {
      return res.status(403).json({
        error: 'Your account is currently suspended',
        suspension: {
          type: suspension.suspension_type,
          reason: suspension.reason,
          expiresAt: suspension.expires_at
        }
      });
    }

    // Check for duplicate enquiry
    const doctor = queries.getDoctorById.get(doctor_id);
    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    if (checkDuplicateEnquiry(req.user.id, doctor_id, doctor.specialty_id)) {
      logActivityAndCheckAbuse(req.user.id, 'duplicate_enquiry', null, { doctorId: doctor_id });
      return res.status(409).json({ error: 'You already have a pending appointment with this doctor or specialty. Please wait for that appointment or cancel it first.' });
    }

    // Check if time slot is available
    const slotCheck = queries.checkTimeSlotAvailable.get(doctor_id, appointment_date, appointment_time);
    if (slotCheck.count > 0) {
      return res.status(409).json({ error: 'Time slot not available' });
    }

    // Check if date is in the past
    const appointmentDateTime = new Date(`${appointment_date}T${appointment_time}`);
    if (appointmentDateTime < new Date()) {
      return res.status(400).json({ error: 'Cannot book appointments in the past' });
    }

    // Check if doctor is available on that day
    const availableDays = JSON.parse(doctor.available_days || '[]');
    const dayOfWeek = appointmentDateTime.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    if (!availableDays.includes(dayOfWeek)) {
      return res.status(400).json({ error: 'Doctor not available on this day' });
    }

    // Check if time is within doctor's hours
    const appointmentTime = appointment_time;
    if (appointmentTime < doctor.available_hours_start || appointmentTime > doctor.available_hours_end) {
      return res.status(400).json({ error: 'Appointment time outside doctor\'s working hours' });
    }

    // Compute queue position
    const maxQueue = queries.getMaxQueueNumber.get(doctor_id, appointment_date);
    const queueNum = (maxQueue ? maxQueue.max_queue : 0) + 1;
    const estWait = (queueNum - 1) * 15;

    // Priority engine: auto-classify condition if not explicitly provided
    let priorityLevel = req.body.priority_level;
    let priorityReason = req.body.priority_reason;

    if (!priorityLevel) {
      const evalRes = evaluateConditionPriority(notes || '');
      priorityLevel = evalRes.level;
      if (!priorityReason) priorityReason = evalRes.reason;
    }

    priorityLevel = Math.min(5, Math.max(1, priorityLevel));
    const acuityBonus = req.body.acuity_bonus || 0;
    const priorityScore = computePriorityScore({
      priority_level: priorityLevel,
      bookedAt: new Date(),
      acuityBonus,
      queueNumber: queueNum
    });
    const finalReasonText = priorityReasonText(priorityLevel, priorityReason);

    // Create appointment
    const result = queries.createAppointment.run(
      req.user.id, doctor_id, appointment_date, appointment_time,
      queueNum, 'waiting', estWait,
      priorityLevel, priorityScore, finalReasonText, notes || null
    );
    const appointment = queries.getAppointmentById.get(result.lastInsertRowid);

    // Log activity
    logActivityAndCheckAbuse(req.user.id, 'booking_created', appointment.id, { doctorId: doctor_id });

    // Trigger AI priority validation asynchronously
    try {
      const { priorityValidationService } = require('../services/priorityValidationService');
      priorityValidationService.validatePriority({
        symptoms: notes || '',
        severity: priorityLevel === 1 ? 9 : (priorityLevel === 2 ? 7 : 4),
        existingPriority: priorityLevel,
        recordCount: 0,
        patientAge: 35
      }).then(valResult => {
        const reviewStatus = (valResult.confidence >= 0.85 && (valResult.action === 'ESCALATE' || valResult.action === 'DOWNGRADE')) ? 'applied' : 'pending';
        let finalPriority = priorityLevel;
        if (reviewStatus === 'applied') {
          finalPriority = valResult.recommended_priority;
          const newScore = computePriorityScore({ priority_level: finalPriority, bookedAt: appointment.created_at, queueNumber: appointment.queue_number });
          queries.updateAppointmentPriority.run(finalPriority, newScore, `AI Triage (${valResult.action}): ${valResult.reason_codes.join(', ')}`, appointment.id);
        }
        queries.createPriorityValidation.run(
          appointment.id, appointment.patient_id, priorityLevel, valResult.recommended_priority,
          valResult.confidence, valResult.action, JSON.stringify(valResult.reason_codes),
          valResult.model_version, reviewStatus, null, null
        );
      }).catch(err => console.error('Auto AI Validation Error:', err));
    } catch (e) {
      console.error('Trigger AI validation error:', e);
    }

    res.status(201).json({
      message: 'Appointment booked successfully',
      appointment
    });
  } catch (error) {
    console.error('Create appointment error:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Time slot already booked' });
    }
    res.status(500).json({ error: 'Failed to create appointment' });
  }
});

// Update appointment
router.put('/:id', validateIdParam, validateUpdateAppointment, (req, res) => {
  try {
    const appointment = queries.getAppointmentById.get(req.params.id);

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    // Check permissions
    let canModify = false;
    if (req.user.role === 'admin') {
      canModify = true;
    } else if (req.user.role === 'patient' && appointment.patient_id === req.user.id) {
      canModify = true;
    } else if (req.user.role === 'doctor') {
      const doctor = queries.getDoctorByUserId.get(req.user.id);
      if (doctor && appointment.doctor_id === doctor.id) {
        canModify = true;
      }
    }

    if (!canModify) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { status, doctor_id, appointment_date, appointment_time, notes } = req.body;

    // If patient is updating, they can only cancel
    if (req.user.role === 'patient' && status && status !== 'cancelled') {
      return res.status(403).json({ error: 'Patients can only cancel appointments' });
    }

    const oldStatus = appointment.status;

    // If rescheduling, check availability
    if (appointment_date || appointment_time || doctor_id) {
      const newDoctorId = doctor_id || appointment.doctor_id;
      const newDate = appointment_date || appointment.appointment_date;
      const newTime = appointment_time || appointment.appointment_time;

      const slotCheck = queries.checkTimeSlotAvailable.get(newDoctorId, newDate, newTime);
      if (slotCheck.count > 0) {
        // Check if it's the same appointment
        const existing = queries.getAppointmentById.get(req.params.id);
        if (!(existing.doctor_id === newDoctorId && existing.appointment_date === newDate && existing.appointment_time === newTime)) {
          return res.status(409).json({ error: 'Time slot not available' });
        }
      }

      // Validate new date/time
      const newDateTime = new Date(`${newDate}T${newTime}`);
      if (newDateTime < new Date() && status !== 'cancelled') {
        return res.status(400).json({ error: 'Cannot schedule appointments in the past' });
      }

      queries.updateAppointment.run(
        newDoctorId,
        newDate,
        newTime,
        notes !== undefined ? notes : appointment.notes,
        req.params.id
      );
    }

    const newStatus = status || appointment.status;
    const newQueueStatus = status === 'cancelled' ? 'cancelled' : (status === 'completed' ? 'completed' : appointment.queue_status);

    queries.updateAppointmentStatus.run(
      newStatus,
      newQueueStatus,
      notes !== undefined ? notes : appointment.notes,
      req.body.diagnosis || appointment.diagnosis,
      req.body.prescription || appointment.prescription,
      req.params.id
    );
    const updatedAppointment = queries.getAppointmentById.get(req.params.id);

    // Log activity for status changes
    if (oldStatus !== newStatus) {
      if (newStatus === 'cancelled') {
        logActivityAndCheckAbuse(appointment.patient_id, 'booking_cancelled', appointment.id, { reason: notes || 'Cancelled by user' });
      } else if (newStatus === 'no-show') {
        logActivityAndCheckAbuse(appointment.patient_id, 'no_show', appointment.id, {});
      } else if (newStatus === 'completed' && oldStatus !== 'completed') {
        logActivityAndCheckAbuse(appointment.patient_id, 'appointment_completed', appointment.id, {});
      }
    }

    // Real-time push
    publishToAppointment(req.params.id, updatedAppointment);
    publishToDoctor(appointment.doctor_id, { type: 'appointment-changed', appointment: updatedAppointment });
    publishToAllAdmins({ type: 'appointment-changed', appointmentId: updatedAppointment.id });

    res.json({
      message: 'Appointment updated successfully',
      appointment: updatedAppointment
    });
  } catch (error) {
    console.error('Update appointment error:', error);
    res.status(500).json({ error: 'Failed to update appointment' });
  }
});

// Delete appointment (admin only)
router.delete('/:id', authorizeRoles('admin'), validateIdParam, (req, res) => {
  try {
    const appointment = queries.getAppointmentById.get(req.params.id);

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    queries.deleteAppointment.run(req.params.id);
    res.json({ message: 'Appointment deleted successfully' });
  } catch (error) {
    console.error('Delete appointment error:', error);
    res.status(500).json({ error: 'Failed to delete appointment' });
  }
});

// Get available time slots for a doctor on a specific date
router.get('/slots/:doctorId/:date', (req, res) => {
  try {
    const { doctorId, date } = req.params;

    const doctor = queries.getDoctorById.get(doctorId);
    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    // Check if doctor is available on this day
    const appointmentDate = new Date(date);
    const dayOfWeek = appointmentDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const availableDays = JSON.parse(doctor.available_days || '[]');

    if (!availableDays.includes(dayOfWeek)) {
      return res.json({ slots: [], message: 'Doctor not available on this day' });
    }

    // Generate time slots (30-minute intervals)
    const startHour = parseInt(doctor.available_hours_start.split(':')[0]);
    const startMin = parseInt(doctor.available_hours_start.split(':')[1]);
    const endHour = parseInt(doctor.available_hours_end.split(':')[0]);
    const endMin = parseInt(doctor.available_hours_end.split(':')[1]);

    const slots = [];
    let currentHour = startHour;
    let currentMin = startMin;

    while (currentHour < endHour || (currentHour === endHour && currentMin < endMin)) {
      const timeStr = `${currentHour.toString().padStart(2, '0')}:${currentMin.toString().padStart(2, '0')}`;

      // Check if slot is booked
      const slotCheck = queries.checkTimeSlotAvailable.get(doctorId, date, timeStr);
      if (slotCheck.count === 0) {
        slots.push(timeStr);
      }

      // Increment by 30 minutes
      currentMin += 30;
      if (currentMin >= 60) {
        currentMin = 0;
        currentHour++;
      }
    }

    res.json({ slots });
  } catch (error) {
    console.error('Get slots error:', error);
    res.status(500).json({ error: 'Failed to fetch available slots' });
  }
});

module.exports = router;