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
    SELECT a.*, u.full_name as doctor_name, u.email as doctor_email, d.location as doctor_location, d.rating as doctor_rating, s.name as specialty_name, s.icon as specialty_icon
    FROM appointments a
    JOIN doctors d ON a.doctor_id = d.id
    JOIN users u ON d.user_id = u.id
    JOIN specialties s ON d.specialty_id = s.id
    WHERE a.patient_id = ?
    ORDER BY a.appointment_date DESC, a.appointment_time DESC
  `),
  getNextAppointmentByPatient: getDatabase().prepare(`
    SELECT a.*, u.full_name as doctor_name, u.email as doctor_email, d.location as doctor_location, s.name as specialty_name, s.icon as specialty_icon
    FROM appointments a
    JOIN doctors d ON a.doctor_id = d.id
    JOIN users u ON d.user_id = u.id
    JOIN specialties s ON d.specialty_id = s.id
    WHERE a.patient_id = ? AND a.status IN ('scheduled', 'in-progress')
    ORDER BY a.appointment_date ASC, a.appointment_time ASC
    LIMIT 1
  `),
  getAppointmentsByDoctor: getDatabase().prepare(`
    SELECT a.*, u.full_name as patient_name, u.email as patient_email, u.phone as patient_phone, u.avatar as patient_avatar
    FROM appointments a
    JOIN users u ON a.patient_id = u.id
    WHERE a.doctor_id = ?
    ORDER BY a.appointment_date, a.appointment_time
  `),
  getTodayDoctorQueue: getDatabase().prepare(`
    SELECT a.*, u.full_name as patient_name, u.email as patient_email, u.phone as patient_phone, u.avatar as patient_avatar
    FROM appointments a
    JOIN users u ON a.patient_id = u.id
    WHERE a.doctor_id = ? AND a.appointment_date = date('now', 'localtime') AND a.status IN ('scheduled', 'in-progress')
    ORDER BY a.priority_score DESC, a.queue_number ASC
  `),
  getAllAppointments: getDatabase().prepare(`
    SELECT a.*,
      p.full_name as patient_name, p.email as patient_email, p.phone as patient_phone,
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
      p.full_name as patient_name, p.email as patient_email, p.phone as patient_phone,
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
  `)
};

module.exports = { getDatabase, closeDatabase, queries };