const express = require('express');
const { queries, getDatabase } = require('../database/db');
const { computePriorityScore, priorityReasonText, evaluateConditionPriority } = require('../lib/priorityEngine');
const { publishToDoctor, publishToAppointment, publishToAllAdmins } = require('../lib/sseManager');

const router = express.Router();

// Helper: Check if user is suspended
function checkSuspension(userId) {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM account_suspensions
    WHERE user_id = ? AND is_active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY suspended_at DESC LIMIT 1
  `).get(userId);
}

// Helper: Find or create patient by phone/email
function findOrCreatePatient(db, full_name, phone, email) {
  // Normalize phone number
  const digitsOnly = phone.replace(/\D/g, '');
  let formattedPhone;
  if (digitsOnly.startsWith('91') && digitsOnly.length === 12) {
    formattedPhone = '+91-' + digitsOnly.slice(2);
  } else if (digitsOnly.length === 10) {
    formattedPhone = '+91-' + digitsOnly;
  } else if (digitsOnly.length === 11 && digitsOnly.startsWith('0')) {
    formattedPhone = '+91-' + digitsOnly.slice(1);
  } else if (phone.startsWith('+')) {
    formattedPhone = '+' + digitsOnly;
  } else {
    formattedPhone = digitsOnly.length === 10 ? '+91-' + digitsOnly : phone;
  }

  let patientUser = db.prepare('SELECT * FROM users WHERE phone = ? OR (email IS NOT NULL AND email = ?)').get(formattedPhone, email || '');

  if (!patientUser) {
    const generatedEmail = email || ('patient_' + Date.now() + '@kiosk.swasthya.com');
    const crypto = require('crypto');
    const randomPassword = crypto.randomBytes(16).toString('base64url');
    const passwordHash = require('bcryptjs').hashSync(randomPassword, 10);
    const initials = full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

    const userResult = queries.createUser.run(generatedEmail, passwordHash, full_name, formattedPhone, 'patient', initials || '👤');
    patientUser = queries.findUserById.get(userResult.lastInsertRowid);
  }

  return { patientUser, formattedPhone };
}

// Get specialties for Kiosk
router.get('/specialties', (req, res) => {
  try {
    const specialties = queries.getAllSpecialties.all();
    res.json({ specialties });
  } catch (error) {
    console.error('Kiosk specialties error:', error);
    res.status(500).json({ error: 'Failed to fetch specialties' });
  }
});

// Get doctors for Kiosk
router.get('/doctors', (req, res) => {
  try {
    const doctors = queries.getAllDoctors.all();
    const publicDoctors = doctors.map(doc => ({
      id: doc.id,
      full_name: doc.full_name,
      specialty_id: doc.specialty_id,
      specialty_name: doc.specialty_name,
      specialty_icon: doc.specialty_icon || '🩺',
      bio: doc.bio,
      location: doc.location || 'Downtown Medical Center',
      rating: doc.rating || 4.9,
      experience_years: doc.experience_years || 10,
      consultation_fee: doc.consultation_fee,
      available_days: JSON.parse(doc.available_days || '[]'),
      available_hours_start: doc.available_hours_start,
      available_hours_end: doc.available_hours_end
    }));
    res.json({ doctors: publicDoctors });
  } catch (error) {
    console.error('Kiosk doctors error:', error);
    res.status(500).json({ error: 'Failed to fetch doctors' });
  }
});

// Search appointment for check-in
router.get('/find-appointment', (req, res) => {
  try {
    const { phone, email, booking_id } = req.query;
    const db = getDatabase();

    const queryStr = "SELECT a.*, p.full_name as patient_name, p.email as patient_email, p.phone as patient_phone, u.full_name as doctor_name, u.email as doctor_email, d.location as doctor_location, s.name as specialty_name, s.icon as specialty_icon FROM appointments a JOIN users p ON a.patient_id = p.id JOIN doctors d ON a.doctor_id = d.id JOIN users u ON d.user_id = u.id JOIN specialties s ON d.specialty_id = s.id WHERE a.status IN ('scheduled', 'in-progress')";

    let appointment = null;

    if (phone) {
      // Normalize phone number for search - strip all non-digits
      const digitsOnly = phone.replace(/\D/g, '');
      // Search by last 10 digits (Indian mobile number)
      const last10 = digitsOnly.slice(-10);
      const appts = db.prepare(queryStr + " AND p.phone LIKE ?").all('%' + last10 + '%');
      appointment = appts[0] || null;
    } else if (email) {
      const appts = db.prepare(queryStr + " AND LOWER(p.email) = LOWER(?)").all(email);
      appointment = appts[0] || null;
    } else if (booking_id) {
      const numericId = parseInt(booking_id.replace(/\D/g, ''));
      if (numericId) {
        appointment = db.prepare(queryStr + " AND a.id = ?").get(numericId);
      }
    }

    if (!appointment) {
      return res.status(404).json({ error: 'No scheduled appointment found for details provided' });
    }

    res.json({ appointment });
  } catch (error) {
    console.error('Kiosk find appointment error:', error);
    res.status(500).json({ error: 'Failed to search appointment' });
  }
});

// Confirm Kiosk check-in
router.post('/checkin', (req, res) => {
  try {
    const { appointment_id } = req.body;
    if (!appointment_id) {
      return res.status(400).json({ error: 'Appointment ID required' });
    }

    const appointment = queries.getAppointmentById.get(appointment_id);
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    queries.updateAppointmentStatus.run('scheduled', 'waiting', appointment.notes, appointment.diagnosis, appointment.prescription, appointment_id);

    const updated = queries.getAppointmentById.get(appointment_id);

    publishToDoctor(updated.doctor_id, { type: 'appointment-changed', appointment: updated });
    publishToAppointment(updated.id, updated);
    publishToAllAdmins({ type: 'appointment-changed', appointmentId: updated.id });

    res.json({ message: 'Check-in successful', appointment: updated });
  } catch (error) {
    console.error('Kiosk checkin error:', error);
    res.status(500).json({ error: 'Failed to complete check-in' });
  }
});

// Walk-in registration & appointment booking
router.post('/walkin', (req, res) => {
  try {
    const { full_name, phone, email, doctor_id, notes, priority_level, priority_reason, abha_id } = req.body;

    if (!full_name || !phone || !doctor_id) {
      return res.status(400).json({ error: 'Name, phone, and doctor selection are required' });
    }

    const db = getDatabase();

    // Find or create patient
    const { patientUser, formattedPhone } = findOrCreatePatient(db, full_name, phone, email);

    if (!patientUser) {
      return res.status(500).json({ error: 'Failed to create or find patient user' });
    }

    // Check if patient is suspended
    const suspension = checkSuspension(patientUser.id);
    if (suspension) {
      return res.status(403).json({
        error: 'This patient account is currently suspended',
        suspension: {
          type: suspension.suspension_type,
          reason: suspension.reason,
          expiresAt: suspension.expires_at
        }
      });
    }

    // Handle ABHA ID if provided
    if (abha_id) {
      const abhaRegex = /^\d{14}$/;
      if (!abhaRegex.test(abha_id)) {
        return res.status(400).json({ error: 'ABHA ID must be a 14-digit number' });
      }
      const existingAbha = queries.findUserByAbhaId.get(abha_id);
      if (existingAbha && existingAbha.id !== patientUser.id) {
        return res.status(409).json({ error: 'This ABHA ID is already linked to another account' });
      }
      queries.updateUserAbha.run(abha_id, 1, new Date().toISOString(), patientUser.id);
    }

    const doctor = queries.getDoctorById.get(doctor_id);
    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 5);

    // Find the next available time slot for walk-in
    let apptTime = null;
    const startHour = parseInt(doctor.available_hours_start.split(':')[0]);
    const startMin = parseInt(doctor.available_hours_start.split(':')[1]);
    const endHour = parseInt(doctor.available_hours_end.split(':')[0]);
    const endMin = parseInt(doctor.available_hours_end.split(':')[1]);

    let currentHour = startHour;
    let currentMin = startMin;

    // If current time is within hours, start from current time rounded up to 15 min
    if (currentTime >= doctor.available_hours_start && currentTime < doctor.available_hours_end) {
      const [curHour, curMin] = currentTime.split(':').map(Number);
      currentHour = curHour;
      currentMin = Math.ceil(curMin / 15) * 15;
      if (currentMin >= 60) {
        currentMin = 0;
        currentHour++;
      }
    }

    while (currentHour < endHour || (currentHour === endHour && currentMin <= endMin)) {
      const timeStr = `${currentHour.toString().padStart(2, '0')}:${currentMin.toString().padStart(2, '0')}`;
      const slotCheck = queries.checkTimeSlotAvailable.get(doctor_id, todayStr, timeStr);
      if (slotCheck.count === 0) {
        apptTime = timeStr;
        break;
      }
      currentMin += 15;
      if (currentMin >= 60) {
        currentMin = 0;
        currentHour++;
      }
    }

    // Fallback if no slots found
    if (!apptTime) {
      apptTime = doctor.available_hours_start;
    }

    const maxQueue = queries.getMaxQueueNumber.get(doctor_id, todayStr);
    const queueNum = (maxQueue ? maxQueue.max_queue : 0) + 1;
    const estWait = (queueNum - 1) * 15;

    let level = parseInt(priority_level);
    let reason = priority_reason;

    if (!level || isNaN(level)) {
      const evalRes = evaluateConditionPriority(notes || '');
      level = evalRes.level;
      if (!reason) reason = evalRes.reason;
    }

    level = Math.min(5, Math.max(1, level));
    const score = computePriorityScore({ priority_level: level, bookedAt: new Date(), queueNumber: queueNum });
    const finalReason = priorityReasonText(level, reason);

    const result = queries.createAppointment.run(
      patientUser.id, doctor_id, todayStr, apptTime,
      queueNum, 'waiting', estWait,
      level, score, finalReason, notes || 'Kiosk walk-in registration'
    );

    publishToDoctor(doctor_id, { type: 'appointment-changed', appointment });
    publishToAllAdmins({ type: 'appointment-changed', appointmentId: appointment.id });

    res.status(201).json({
      message: 'Walk-in registration successful',
      appointment
    });
  } catch (error) {
    console.error('Kiosk walkin error:', error);
    res.status(500).json({ error: 'Failed to process walk-in registration' });
  }
});

// Get live queue for Kiosk display (public)
router.get('/queue', (req, res) => {
  try {
    const { doctor_id } = req.query;
    const db = getDatabase();
    const todayStr = new Date().toISOString().split('T')[0];

    let queryStr = `
      SELECT a.id, a.patient_id, a.doctor_id, a.appointment_date, a.appointment_time,
             a.queue_number, a.status, a.queue_status, a.estimated_wait_mins as estimated_wait_time,
             a.priority_level, a.priority_score, a.priority_reason,
             p.full_name as patient_name, u.full_name as doctor_name,
             s.name as specialty_name, s.icon as specialty_icon, d.location as doctor_location
      FROM appointments a
      JOIN users p ON a.patient_id = p.id
      JOIN doctors d ON a.doctor_id = d.id
      JOIN users u ON d.user_id = u.id
      JOIN specialties s ON d.specialty_id = s.id
      WHERE a.appointment_date = ? AND a.status IN ('scheduled', 'in-progress')
    `;

    let appointments;
    if (doctor_id && doctor_id !== 'all') {
      queryStr += ' AND a.doctor_id = ? ORDER BY a.priority_score DESC, a.queue_number ASC';
      appointments = db.prepare(queryStr).all(todayStr, parseInt(doctor_id));
    } else {
      queryStr += ' ORDER BY a.priority_score DESC, a.queue_number ASC';
      appointments = db.prepare(queryStr).all(todayStr);
    }

    res.json({ queue: appointments });
  } catch (error) {
    console.error('Kiosk live queue error:', error);
    res.status(500).json({ error: 'Failed to fetch kiosk queue' });
  }
});

module.exports = router;
