const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'clinic.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Singleton database connection
let dbInstance = null;

function getDatabase() {
  if (!dbInstance) {
    dbInstance = new Database(DB_PATH);

    // Enable foreign keys
    dbInstance.pragma('foreign_keys = ON');

    // Initialize database tables from schema.sql
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    dbInstance.exec(schema);

    // Disable safe integers to avoid BigInt serialization issues with JSON
    dbInstance.defaultSafeIntegers(false);
  }

  return dbInstance;
}

function closeDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

// Helper functions for common queries
const queries = {
  // User queries
  findUserByEmail: getDatabase().prepare('SELECT * FROM users WHERE email = ?'),
  findUserById: getDatabase().prepare('SELECT * FROM users WHERE id = ?'),
  createUser: getDatabase().prepare(`
    INSERT INTO users (email, password_hash, full_name, phone, role, avatar)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  updateUser: getDatabase().prepare(`
    UPDATE users SET full_name = ?, phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `),

  // Specialty queries
  getAllSpecialties: getDatabase().prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM doctors WHERE specialty_id = s.id) as doctor_count
    FROM specialties s
    ORDER BY s.name
  `),
  getSpecialtyById: getDatabase().prepare('SELECT * FROM specialties WHERE id = ?'),
  createSpecialty: getDatabase().prepare('INSERT INTO specialties (name, description, icon) VALUES (?, ?, ?)'),
  updateSpecialty: getDatabase().prepare('UPDATE specialties SET name = ?, description = ?, icon = ? WHERE id = ?'),
  deleteSpecialty: getDatabase().prepare('DELETE FROM specialties WHERE id = ?'),

  // Doctor queries
  getAllDoctors: getDatabase().prepare(`
    SELECT d.*, u.full_name, u.email, u.phone, u.avatar, s.name as specialty_name, s.icon as specialty_icon
    FROM doctors d
    JOIN users u ON d.user_id = u.id
    JOIN specialties s ON d.specialty_id = s.id
    ORDER BY u.full_name
  `),
  getDoctorById: getDatabase().prepare(`
    SELECT d.*, u.full_name, u.email, u.phone, u.avatar, s.name as specialty_name, s.icon as specialty_icon
    FROM doctors d
    JOIN users u ON d.user_id = u.id
    JOIN specialties s ON d.specialty_id = s.id
    WHERE d.id = ?
  `),
  getDoctorByUserId: getDatabase().prepare(`
    SELECT d.*, u.full_name, u.email, u.phone, u.avatar, s.name as specialty_name, s.icon as specialty_icon
    FROM doctors d
    JOIN users u ON d.user_id = u.id
    JOIN specialties s ON d.specialty_id = s.id
    WHERE d.user_id = ?
  `),
  getDoctorsBySpecialty: getDatabase().prepare(`
    SELECT d.*, u.full_name, u.email, u.phone, u.avatar, s.name as specialty_name, s.icon as specialty_icon
    FROM doctors d
    JOIN users u ON d.user_id = u.id
    JOIN specialties s ON d.specialty_id = s.id
    WHERE d.specialty_id = ?
    ORDER BY u.full_name
  `),
  createDoctor: getDatabase().prepare(`
    INSERT INTO doctors (user_id, specialty_id, license_number, bio, location, rating, experience_years, consultation_fee, available_days, available_hours_start, available_hours_end)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateDoctor: getDatabase().prepare(`
    UPDATE doctors SET specialty_id = ?, license_number = ?, bio = ?, location = ?, rating = ?, experience_years = ?, consultation_fee = ?,
      available_days = ?, available_hours_start = ?, available_hours_end = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),
  deleteDoctor: getDatabase().prepare('DELETE FROM doctors WHERE id = ?'),

  // Appointment & Queue queries
  getAppointmentsByPatient: getDatabase().prepare(`
    SELECT a.*, u.full_name as doctor_name, u.email as doctor_email, d.location as doctor_location, d.rating as doctor_rating, s.name as specialty_name, s.icon as specialty_icon, p.abha_id as patient_abha_id
    FROM appointments a
    JOIN doctors d ON a.doctor_id = d.id
    JOIN users u ON d.user_id = u.id
    JOIN specialties s ON d.specialty_id = s.id
    JOIN users p ON a.patient_id = p.id
    WHERE a.patient_id = ?
    ORDER BY a.appointment_date DESC, a.appointment_time DESC
  `),
  getNextAppointmentByPatient: getDatabase().prepare(`
    SELECT a.*, u.full_name as doctor_name, u.email as doctor_email, d.location as doctor_location, s.name as specialty_name, s.icon as specialty_icon, p.abha_id as patient_abha_id
    FROM appointments a
    JOIN doctors d ON a.doctor_id = d.id
    JOIN users u ON d.user_id = u.id
    JOIN specialties s ON d.specialty_id = s.id
    JOIN users p ON a.patient_id = p.id
    WHERE a.patient_id = ? AND a.status IN ('scheduled', 'in-progress')
    ORDER BY a.appointment_date ASC, a.appointment_time ASC
    LIMIT 1
  `),
  getAppointmentsByDoctor: getDatabase().prepare(`
    SELECT a.*, u.full_name as patient_name, u.email as patient_email, u.phone as patient_phone, u.avatar as patient_avatar, u.abha_id as patient_abha_id
    FROM appointments a
    JOIN users u ON a.patient_id = u.id
    WHERE a.doctor_id = ?
    ORDER BY a.appointment_date, a.appointment_time
  `),
  getTodayDoctorQueue: getDatabase().prepare(`
    SELECT a.*, u.full_name as patient_name, u.email as patient_email, u.phone as patient_phone, u.avatar as patient_avatar, u.abha_id as patient_abha_id
    FROM appointments a
    JOIN users u ON a.patient_id = u.id
    WHERE a.doctor_id = ? AND a.appointment_date = date('now', 'localtime') AND a.status IN ('scheduled', 'in-progress')
    ORDER BY a.priority_score DESC, a.queue_number ASC
  `),
  getAllAppointments: getDatabase().prepare(`
    SELECT a.*,
      p.full_name as patient_name, p.email as patient_email, p.phone as patient_phone, p.abha_id as patient_abha_id,
      u.full_name as doctor_name, u.email as doctor_email, s.name as specialty_name
    FROM appointments a
    JOIN users p ON a.patient_id = p.id
    JOIN doctors d ON a.doctor_id = d.id
    JOIN users u ON d.user_id = u.id
    JOIN specialties s ON d.specialty_id = s.id
    ORDER BY a.appointment_date DESC, a.appointment_time DESC
  `),
  getAppointmentById: getDatabase().prepare(`
    SELECT a.*,
      p.full_name as patient_name, p.email as patient_email, p.phone as patient_phone, p.abha_id as patient_abha_id,
      u.full_name as doctor_name, u.email as doctor_email, d.location as doctor_location, s.name as specialty_name
    FROM appointments a
    JOIN users p ON a.patient_id = p.id
    JOIN doctors d ON a.doctor_id = d.id
    JOIN users u ON d.user_id = u.id
    JOIN specialties s ON d.specialty_id = s.id
    WHERE a.id = ?
  `),
  createAppointment: getDatabase().prepare(`
    INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, queue_number, queue_status, estimated_wait_mins, priority_level, priority_score, priority_reason, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateAppointmentStatus: getDatabase().prepare(`
    UPDATE appointments SET status = ?, queue_status = ?, notes = ?, diagnosis = ?, prescription = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `),
  updateQueueStatus: getDatabase().prepare(`
    UPDATE appointments SET queue_status = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `),
  updateAppointment: getDatabase().prepare(`
    UPDATE appointments SET doctor_id = ?, appointment_date = ?, appointment_time = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `),
  deleteAppointment: getDatabase().prepare('DELETE FROM appointments WHERE id = ?'),
  checkTimeSlotAvailable: getDatabase().prepare(`
    SELECT COUNT(*) as count FROM appointments
    WHERE doctor_id = ? AND appointment_date = ? AND appointment_time = ? AND status != 'cancelled'
  `),
  getMaxQueueNumber: getDatabase().prepare(`
    SELECT COALESCE(MAX(queue_number), 0) as max_queue FROM appointments
    WHERE doctor_id = ? AND appointment_date = ? AND status != 'cancelled'
  `),
  getAppointmentsByDateRange: getDatabase().prepare(`
    SELECT a.*,
      p.full_name as patient_name, p.email as patient_email,
      u.full_name as doctor_name, s.name as specialty_name
    FROM appointments a
    JOIN users p ON a.patient_id = p.id
    JOIN doctors d ON a.doctor_id = d.id
    JOIN users u ON d.user_id = u.id
    JOIN specialties s ON d.specialty_id = s.id
    WHERE a.appointment_date BETWEEN ? AND ?
    ORDER BY a.appointment_date, a.appointment_time
  `),

  // Admin stats queries
  getStats: getDatabase().prepare(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE role = 'patient') as total_patients,
      (SELECT COUNT(*) FROM users WHERE role = 'doctor') as total_doctors,
      (SELECT COUNT(*) FROM appointments WHERE status = 'scheduled') as upcoming_appointments,
      (SELECT COUNT(*) FROM appointments WHERE status = 'completed') as completed_appointments,
      (SELECT COUNT(*) FROM appointments WHERE status = 'cancelled') as cancelled_appointments
  `),

  // Patient Reports queries
  getPatientReports: getDatabase().prepare(`
    SELECT pr.*, u.full_name as uploaded_by_name
    FROM patient_reports pr
    LEFT JOIN users u ON pr.uploaded_by = u.id
    WHERE pr.patient_id = ?
    ORDER BY pr.created_at DESC
  `),
  getPatientReportById: getDatabase().prepare(`
    SELECT pr.*, u.full_name as uploaded_by_name
    FROM patient_reports pr
    LEFT JOIN users u ON pr.uploaded_by = u.id
    WHERE pr.id = ?
  `),
  getReportsByAppointment: getDatabase().prepare(`
    SELECT pr.*, u.full_name as uploaded_by_name
    FROM patient_reports pr
    LEFT JOIN users u ON pr.uploaded_by = u.id
    WHERE pr.appointment_id = ?
    ORDER BY pr.created_at DESC
  `),
  createPatientReport: getDatabase().prepare(`
    INSERT INTO patient_reports (patient_id, appointment_id, file_name, original_name, mime_type, file_size, file_path, document_type, description, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  deletePatientReport: getDatabase().prepare('DELETE FROM patient_reports WHERE id = ?'),
  updatePatientReport: getDatabase().prepare(`
    UPDATE patient_reports SET document_type = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `),

  // Symptom Assessments queries
  createSymptomAssessment: getDatabase().prepare(`
    INSERT INTO symptom_assessments (patient_id, appointment_id, session_id, chief_complaint, symptoms_json, severity_score, urgency_level, emergency_flag, emergency_reason, summary_for_doctor, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getSymptomAssessmentById: getDatabase().prepare(`
    SELECT * FROM symptom_assessments WHERE id = ?
  `),
  getSymptomAssessmentBySessionId: getDatabase().prepare(`
    SELECT * FROM symptom_assessments WHERE session_id = ?
  `),
  getSymptomAssessmentsByPatient: getDatabase().prepare(`
    SELECT * FROM symptom_assessments WHERE patient_id = ? ORDER BY started_at DESC
  `),
  getSymptomAssessmentsByAppointment: getDatabase().prepare(`
    SELECT * FROM symptom_assessments WHERE appointment_id = ? ORDER BY started_at DESC
  `),
  updateSymptomAssessment: getDatabase().prepare(`
    UPDATE symptom_assessments SET chief_complaint = ?, symptoms_json = ?, severity_score = ?, urgency_level = ?, emergency_flag = ?, emergency_reason = ?, summary_for_doctor = ?, status = ?, completed_at = CASE WHEN ? = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE id = ?
  `),

  // Account Activity queries
  createAccountActivity: getDatabase().prepare(`
    INSERT INTO account_activity (user_id, activity_type, appointment_id, metadata_json)
    VALUES (?, ?, ?, ?)
  `),
  getAccountActivityByUser: getDatabase().prepare(`
    SELECT * FROM account_activity WHERE user_id = ? ORDER BY created_at DESC LIMIT 100
  `),
  getAccountActivityByUserAndType: getDatabase().prepare(`
    SELECT * FROM account_activity WHERE user_id = ? AND activity_type = ? AND created_at >= datetime('now', ?) ORDER BY created_at DESC
  `),
  getAccountActivityCountByType: getDatabase().prepare(`
    SELECT COUNT(*) as count FROM account_activity WHERE user_id = ? AND activity_type = ? AND created_at >= datetime('now', ?)
  `),

  // Account Suspensions queries
  createAccountSuspension: getDatabase().prepare(`
    INSERT INTO account_suspensions (user_id, suspension_type, reason, trigger_details_json, suspended_by, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  getActiveSuspensionByUser: getDatabase().prepare(`
    SELECT * FROM account_suspensions WHERE user_id = ? AND is_active = 1 AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY suspended_at DESC LIMIT 1
  `),
  getSuspensionHistoryByUser: getDatabase().prepare(`
    SELECT s.*, u.full_name as suspended_by_name, u2.full_name as lifted_by_name
    FROM account_suspensions s
    LEFT JOIN users u ON s.suspended_by = u.id
    LEFT JOIN users u2 ON s.lifted_by = u2.id
    WHERE s.user_id = ?
    ORDER BY s.suspended_at DESC
  `),
  getAllActiveSuspensions: getDatabase().prepare(`
    SELECT s.*, u.full_name as user_name, u.email as user_email, u2.full_name as suspended_by_name
    FROM account_suspensions s
    JOIN users u ON s.user_id = u.id
    LEFT JOIN users u2 ON s.suspended_by = u2.id
    WHERE s.is_active = 1 AND (s.expires_at IS NULL OR s.expires_at > datetime('now'))
    ORDER BY s.suspended_at DESC
  `),
  liftSuspension: getDatabase().prepare(`
    UPDATE account_suspensions SET is_active = 0, lifted_at = CURRENT_TIMESTAMP, lifted_by = ?, lift_reason = ? WHERE id = ?
  `),

  // Abuse Thresholds queries
  getAllAbuseThresholds: getDatabase().prepare('SELECT * FROM abuse_thresholds'),
  getAbuseThresholdByMetric: getDatabase().prepare('SELECT * FROM abuse_thresholds WHERE metric = ?'),
  updateAbuseThreshold: getDatabase().prepare(`
    UPDATE abuse_thresholds SET threshold = ?, action = ?, window_days = ?, updated_at = CURRENT_TIMESTAMP WHERE metric = ?
  `),

  // ABHA queries
  findUserByAbhaId: getDatabase().prepare('SELECT * FROM users WHERE abha_id = ?'),
  updateUserAbha: getDatabase().prepare(`
    UPDATE users SET abha_id = ?, abha_verified = ?, abha_verified_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `)
};

module.exports = { getDatabase, closeDatabase, queries };