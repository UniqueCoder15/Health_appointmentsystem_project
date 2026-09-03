const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { queries, getDatabase } = require('../database/db');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { publishToDoctor, publishToAppointment, publishToAllAdmins, publishToPatient } = require('../lib/sseManager');

const router = express.Router();

// Configure multer for file uploads
const uploadsDir = path.join(__dirname, '..', 'uploads', 'reports');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${crypto.randomUUID()}${ext}`;
    cb(null, uniqueName);
  }
});

const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
const maxFileSize = parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024; // 10MB default

const upload = multer({
  storage,
  limits: { fileSize: maxFileSize },
  fileFilter: (req, file, cb) => {
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only PDF, JPEG, and PNG files are allowed.'), false);
    }
    cb(null, true);
  }
});

// All routes require authentication
router.use(authenticateToken);

// Upload a medical report
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { patient_id, appointment_id, document_type, description } = req.body;
    const uploadingUser = req.user;

    // Determine target patient ID
    let targetPatientId = patient_id ? parseInt(patient_id) : uploadingUser.id;

    // Authorization check
    if (uploadingUser.role === 'patient' && targetPatientId !== uploadingUser.id) {
      return res.status(403).json({ error: 'Patients can only upload reports for themselves' });
    }

    if (uploadingUser.role === 'doctor') {
      // Doctor can upload for their patients - verify doctor-patient relationship
      if (appointment_id) {
        const appointment = queries.getAppointmentById.get(parseInt(appointment_id));
        if (!appointment || appointment.doctor_id !== queries.getDoctorByUserId.get(uploadingUser.id)?.id) {
          return res.status(403).json({ error: 'You can only upload reports for your own patients' });
        }
        targetPatientId = appointment.patient_id;
      } else if (patient_id) {
        // Check if doctor has any appointment with this patient
        const doctorProfile = queries.getDoctorByUserId.get(uploadingUser.id);
        if (!doctorProfile) {
          return res.status(403).json({ error: 'Doctor profile not found' });
        }
        const hasAppointment = getDatabase().prepare(`
          SELECT 1 FROM appointments WHERE doctor_id = ? AND patient_id = ? LIMIT 1
        `).get(doctorProfile.id, targetPatientId);
        if (!hasAppointment) {
          return res.status(403).json({ error: 'You can only upload reports for your own patients' });
        }
      }
    }

    // Validate file
    if (req.file.size > maxFileSize) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: `File size exceeds ${maxFileSize / (1024 * 1024)}MB limit` });
    }

    // Create report record
    const result = queries.createPatientReport.run(
      targetPatientId,
      appointment_id ? parseInt(appointment_id) : null,
      req.file.filename,
      req.file.originalname,
      req.file.mimetype,
      req.file.size,
      req.file.filename, // file_path is just the filename since we store in uploads/reports/
      document_type || 'other',
      description || null,
      uploadingUser.id
    );

    const report = queries.getPatientReportById.get(result.lastInsertRowid);

    // SSE notifications
    const patient = queries.findUserById.get(targetPatientId);
    publishToPatient(targetPatientId, { type: 'report-uploaded', report });
    if (appointment_id) {
      publishToAppointment(parseInt(appointment_id), { type: 'report-uploaded', report });
      const appointment = queries.getAppointmentById.get(parseInt(appointment_id));
      if (appointment) {
        publishToDoctor(appointment.doctor_id, { type: 'report-uploaded', report });
      }
    }
    publishToAllAdmins({ type: 'report-uploaded', report, patientId: targetPatientId, userName: patient?.full_name || 'Unknown', uploadedBy: req.user.full_name || 'Unknown' });

    res.status(201).json({
      message: 'Report uploaded successfully',
      report
    });
  } catch (error) {
    console.error('Upload report error:', error);
    if (error.message === 'Invalid file type. Only PDF, JPEG, and PNG files are allowed.') {
      return res.status(400).json({ error: error.message });
    }
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Failed to upload report' });
  }
});

// List reports for a patient (or all for admin)
router.get('/', (req, res) => {
  try {
    const user = req.user;
    let patientId = req.query.patient_id ? parseInt(req.query.patient_id) : user.id;

    // Authorization
    if (user.role === 'patient' && patientId !== user.id) {
      return res.status(403).json({ error: 'Patients can only view their own reports' });
    }

    if (user.role === 'doctor') {
      // Doctor can view reports for their patients
      const doctorProfile = queries.getDoctorByUserId.get(user.id);
      if (!doctorProfile) {
        return res.status(403).json({ error: 'Doctor profile not found' });
      }
      const hasAppointment = getDatabase().prepare(`
        SELECT 1 FROM appointments WHERE doctor_id = ? AND patient_id = ? LIMIT 1
      `).get(doctorProfile.id, patientId);
      if (!hasAppointment) {
        return res.status(403).json({ error: 'You can only view reports for your own patients' });
      }
    }

    const reports = queries.getPatientReports.all(patientId);
    res.json({ reports });
  } catch (error) {
    console.error('List reports error:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// Get reports for a specific appointment
router.get('/appointment/:appointmentId', (req, res) => {
  try {
    const user = req.user;
    const appointmentId = parseInt(req.params.appointmentId);

    const appointment = queries.getAppointmentById.get(appointmentId);
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    // Authorization
    if (user.role === 'patient' && appointment.patient_id !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (user.role === 'doctor') {
      const doctorProfile = queries.getDoctorByUserId.get(user.id);
      if (!doctorProfile || appointment.doctor_id !== doctorProfile.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const reports = queries.getReportsByAppointment.all(appointmentId);
    res.json({ reports });
  } catch (error) {
    console.error('Get appointment reports error:', error);
    res.status(500).json({ error: 'Failed to fetch appointment reports' });
  }
});

// Get single report metadata
router.get('/:id', (req, res) => {
  try {
    const user = req.user;
    const reportId = parseInt(req.params.id);

    const report = queries.getPatientReportById.get(reportId);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Authorization
    if (user.role === 'patient' && report.patient_id !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (user.role === 'doctor') {
      const doctorProfile = queries.getDoctorByUserId.get(user.id);
      if (!doctorProfile) {
        return res.status(403).json({ error: 'Doctor profile not found' });
      }
      const hasAppointment = getDatabase().prepare(`
        SELECT 1 FROM appointments WHERE doctor_id = ? AND patient_id = ? LIMIT 1
      `).get(doctorProfile.id, report.patient_id);
      if (!hasAppointment) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.json({ report });
  } catch (error) {
    console.error('Get report error:', error);
    res.status(500).json({ error: 'Failed to fetch report' });
  }
});

// Download report file
router.get('/:id/download', (req, res) => {
  try {
    const user = req.user;
    const reportId = parseInt(req.params.id);

    const report = queries.getPatientReportById.get(reportId);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Authorization
    if (user.role === 'patient' && report.patient_id !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (user.role === 'doctor') {
      const doctorProfile = queries.getDoctorByUserId.get(user.id);
      if (!doctorProfile) {
        return res.status(403).json({ error: 'Doctor profile not found' });
      }
      const hasAppointment = getDatabase().prepare(`
        SELECT 1 FROM appointments WHERE doctor_id = ? AND patient_id = ? LIMIT 1
      `).get(doctorProfile.id, report.patient_id);
      if (!hasAppointment) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const filePath = path.join(uploadsDir, report.file_name);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }

    // Set headers for download
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(report.original_name)}"`);
    res.setHeader('Content-Type', report.mime_type);
    res.setHeader('Content-Length', report.file_size);

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    console.error('Download report error:', error);
    res.status(500).json({ error: 'Failed to download report' });
  }
});

// Update report metadata (document_type, description)
router.put('/:id', (req, res) => {
  try {
    const user = req.user;
    const reportId = parseInt(req.params.id);
    const { document_type, description } = req.body;

    const report = queries.getPatientReportById.get(reportId);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Authorization - only uploader or admin can update
    if (user.role !== 'admin' && report.uploaded_by !== user.id) {
      return res.status(403).json({ error: 'Only the uploader or admin can update this report' });
    }

    queries.updatePatientReport.run(document_type || 'other', description || null, reportId);
    const updatedReport = queries.getPatientReportById.get(reportId);

    res.json({ message: 'Report updated', report: updatedReport });
  } catch (error) {
    console.error('Update report error:', error);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

// Delete report
router.delete('/:id', (req, res) => {
  try {
    const user = req.user;
    const reportId = parseInt(req.params.id);

    const report = queries.getPatientReportById.get(reportId);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Authorization
    if (user.role === 'patient' && report.patient_id !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (user.role === 'doctor') {
      // Doctor can delete reports they uploaded for their patients
      if (report.uploaded_by !== user.id) {
        return res.status(403).json({ error: 'You can only delete reports you uploaded' });
      }
    }

    // Delete file from disk
    const filePath = path.join(uploadsDir, report.file_name);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Delete from database
    queries.deletePatientReport.run(reportId);

    // SSE notifications
    const patient = queries.findUserById.get(report.patient_id);
    publishToPatient(report.patient_id, { type: 'report-deleted', reportId });
    if (report.appointment_id) {
      publishToAppointment(report.appointment_id, { type: 'report-deleted', reportId });
      const appointment = queries.getAppointmentById.get(report.appointment_id);
      if (appointment) {
        publishToDoctor(appointment.doctor_id, { type: 'report-deleted', reportId });
      }
    }
    publishToAllAdmins({ type: 'report-deleted', reportId, patientId: report.patient_id, userName: patient?.full_name || 'Unknown' });

    res.json({ message: 'Report deleted successfully' });
  } catch (error) {
    console.error('Delete report error:', error);
    res.status(500).json({ error: 'Failed to delete report' });
  }
});

// Admin: Get all reports
router.get('/admin/all', authorizeRoles('admin'), (req, res) => {
  try {
    const db = getDatabase();
    const reports = db.prepare(`
      SELECT pr.*, p.full_name as patient_name, p.email as patient_email,
             u.full_name as uploaded_by_name
      FROM patient_reports pr
      JOIN users p ON pr.patient_id = p.id
      LEFT JOIN users u ON pr.uploaded_by = u.id
      ORDER BY pr.created_at DESC
    `).all();
    res.json({ reports });
  } catch (error) {
    console.error('Admin get all reports error:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

module.exports = router;