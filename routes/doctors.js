const express = require('express');
const { queries } = require('../database/db');
const { authenticateToken, authenticateTokenOrQuery, authorizeRoles } = require('../middleware/auth');
const { validateCreateDoctor, validateUpdateDoctor, validateIdParam } = require('../middleware/validation');
const { subscribe, publishToDoctor, publishToAppointment, publishToAllAdmins } = require('../lib/sseManager');

const router = express.Router();

// Get all doctors (public - for patients to browse)
router.get('/', (req, res) => {
  try {
    const { specialty_id } = req.query;

    let doctors;
    if (specialty_id) {
      doctors = queries.getDoctorsBySpecialty.all(parseInt(specialty_id));
    } else {
      doctors = queries.getAllDoctors.all();
    }

    // Include rich details for public view
    const publicDoctors = doctors.map(doc => ({
      id: doc.id,
      full_name: doc.full_name,
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
    console.error('Get doctors error:', error);
    res.status(500).json({ error: 'Failed to fetch doctors' });
  }
});

// Get single doctor (public)
router.get('/:id', validateIdParam, (req, res) => {
  try {
    const doctor = queries.getDoctorById.get(req.params.id);

    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    // Return public info only
    const publicDoctor = {
      id: doctor.id,
      full_name: doctor.full_name,
      specialty_name: doctor.specialty_name,
      specialty_icon: doctor.specialty_icon || '🩺',
      bio: doctor.bio,
      location: doctor.location || 'Downtown Medical Center',
      rating: doctor.rating || 4.9,
      experience_years: doctor.experience_years || 10,
      consultation_fee: doctor.consultation_fee,
      available_days: JSON.parse(doctor.available_days || '[]'),
      available_hours_start: doctor.available_hours_start,
      available_hours_end: doctor.available_hours_end
    };

    res.json({ doctor: publicDoctor });
  } catch (error) {
    console.error('Get doctor error:', error);
    res.status(500).json({ error: 'Failed to fetch doctor' });
  }
});

// All following routes require authentication
router.use(authenticateToken);

// Get doctor profile (for logged-in doctor)
router.get('/profile/me', authorizeRoles('doctor'), (req, res) => {
  try {
    const doctor = queries.getDoctorByUserId.get(req.user.id);

    if (!doctor) {
      return res.status(404).json({ error: 'Doctor profile not found' });
    }

    res.json({ doctor });
  } catch (error) {
    console.error('Get doctor profile error:', error);
    res.status(500).json({ error: 'Failed to fetch doctor profile' });
  }
});

// Get today's patient queue for doctor (priority-ordered)
router.get('/queue/today', authorizeRoles('doctor'), (req, res) => {
  try {
    const doctor = queries.getDoctorByUserId.get(req.user.id);
    if (!doctor) {
      return res.status(404).json({ error: 'Doctor profile not found' });
    }

    const queue = queries.getTodayDoctorQueue.all(doctor.id);
    // Add priority metadata to each queue item
    const enrichedQueue = queue.map(q => ({
      ...q,
      priority_meta: { level: q.priority_level, score: q.priority_score, reason: q.priority_reason }
    }));
    res.json({ queue: enrichedQueue });
  } catch (error) {
    console.error('Get doctor queue error:', error);
    res.status(500).json({ error: 'Failed to fetch queue' });
  }
});

// SSE stream for doctor's live queue
router.get('/queue/today/stream', authenticateTokenOrQuery, authorizeRoles('doctor'), (req, res) => {
  try {
    const doctor = queries.getDoctorByUserId.get(req.user.id);
    if (!doctor) {
      return res.status(404).json({ error: 'Doctor profile not found' });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 3000\n\n');

    const queue = queries.getTodayDoctorQueue.all(doctor.id);
    const enrichedQueue = queue.map(q => ({ ...q, priority_meta: { level: q.priority_level, score: q.priority_score, reason: q.priority_reason } }));
    res.write(`event: queue-update\ndata: ${JSON.stringify({ queue: enrichedQueue })}\n\n`);

    subscribe(`doctor-queue:${doctor.id}`, res);
  } catch (error) {
    console.error('Doctor queue SSE error:', error);
    res.status(500).json({ error: 'Failed to open stream' });
  }
});

// Update appointment queue status (doctor only)
router.post('/queue/status', authorizeRoles('doctor'), (req, res) => {
  try {
    const { appointment_id, status, queue_status, diagnosis, prescription, notes } = req.body;
    const appointment = queries.getAppointmentById.get(appointment_id);

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    const doctor = queries.getDoctorByUserId.get(req.user.id);
    if (!doctor || appointment.doctor_id !== doctor.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const newStatus = status || (queue_status === 'completed' ? 'completed' : (queue_status === 'in-consultation' ? 'in-progress' : appointment.status));
    const newQueueStatus = queue_status || (newStatus === 'completed' ? 'completed' : (newStatus === 'in-progress' ? 'in-consultation' : appointment.queue_status));

    queries.updateAppointmentStatus.run(newStatus, newQueueStatus, notes || appointment.notes, diagnosis || appointment.diagnosis, prescription || appointment.prescription, appointment_id);

    const updated = queries.getAppointmentById.get(appointment_id);

    // Real-time push
    publishToDoctor(doctor.id, { type: 'appointment-changed', appointment: updated });
    publishToAppointment(appointment_id, updated);
    publishToAllAdmins({ type: 'appointment-changed', appointmentId: updated.id });

    res.json({ message: 'Queue status updated', appointment: updated });
  } catch (error) {
    console.error('Update queue status error:', error);
    res.status(500).json({ error: 'Failed to update queue status' });
  }
});

// Create doctor profile (admin only)
router.post('/', authorizeRoles('admin'), validateCreateDoctor, (req, res) => {
  try {
    const { user_id, specialty_id, license_number, bio, location, rating, experience_years, consultation_fee, available_days, available_hours_start, available_hours_end } = req.body;

    // Check if user exists and is a doctor
    const user = queries.findUserById.get(user_id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.role !== 'doctor') {
      return res.status(400).json({ error: 'User must have doctor role' });
    }

    // Check if doctor profile already exists
    const existingDoctor = queries.getDoctorByUserId.get(user_id);
    if (existingDoctor) {
      return res.status(409).json({ error: 'Doctor profile already exists for this user' });
    }

    // Check specialty exists
    const specialty = queries.getSpecialtyById.get(specialty_id);
    if (!specialty) {
      return res.status(404).json({ error: 'Specialty not found' });
    }

    const result = queries.createDoctor.run(
      user_id,
      specialty_id,
      license_number,
      bio || null,
      location || 'Downtown Medical Center',
      rating || 4.9,
      experience_years || 10,
      consultation_fee || 0,
      JSON.stringify(available_days || []),
      available_hours_start || '09:00',
      available_hours_end || '17:00'
    );

    const doctor = queries.getDoctorById.get(result.lastInsertRowid);
    res.status(201).json({ message: 'Doctor profile created', doctor });
  } catch (error) {
    console.error('Create doctor error:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'License number already in use' });
    }
    res.status(500).json({ error: 'Failed to create doctor profile' });
  }
});

// Update doctor profile (admin or the doctor themselves)
router.put('/:id', authorizeRoles('admin', 'doctor'), validateUpdateDoctor, (req, res) => {
  try {
    const doctor = queries.getDoctorById.get(req.params.id);

    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    // Check permissions
    if (req.user.role === 'doctor' && doctor.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { specialty_id, license_number, bio, location, rating, experience_years, consultation_fee, available_days, available_hours_start, available_hours_end } = req.body;

    // Validate specialty if provided
    if (specialty_id) {
      const specialty = queries.getSpecialtyById.get(specialty_id);
      if (!specialty) {
        return res.status(404).json({ error: 'Specialty not found' });
      }
    }

    queries.updateDoctor.run(
      specialty_id || doctor.specialty_id,
      license_number || doctor.license_number,
      bio !== undefined ? bio : doctor.bio,
      location || doctor.location,
      rating !== undefined ? rating : doctor.rating,
      experience_years !== undefined ? experience_years : doctor.experience_years,
      consultation_fee !== undefined ? consultation_fee : doctor.consultation_fee,
      available_days ? JSON.stringify(available_days) : doctor.available_days,
      available_hours_start || doctor.available_hours_start,
      available_hours_end || doctor.available_hours_end,
      req.params.id
    );

    const updatedDoctor = queries.getDoctorById.get(req.params.id);
    res.json({ message: 'Doctor profile updated', doctor: updatedDoctor });
  } catch (error) {
    console.error('Update doctor error:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'License number already in use' });
    }
    res.status(500).json({ error: 'Failed to update doctor profile' });
  }
});

// Delete doctor (admin only)
router.delete('/:id', authorizeRoles('admin'), validateIdParam, (req, res) => {
  try {
    const doctor = queries.getDoctorById.get(req.params.id);

    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    queries.deleteDoctor.run(req.params.id);
    res.json({ message: 'Doctor profile deleted' });
  } catch (error) {
    console.error('Delete doctor error:', error);
    res.status(500).json({ error: 'Failed to delete doctor profile' });
  }
});

module.exports = router;