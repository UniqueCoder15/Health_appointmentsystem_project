-- Medical Appointment & Queue Management System Database Schema
-- SQLite3 Database

-- Users table (patients, doctors, admins)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT,
    role TEXT NOT NULL CHECK (role IN ('patient', 'doctor', 'admin')),
    avatar TEXT,
    -- Feature 1: ABHA ID Integration
    abha_id TEXT, -- 14-digit ABHA number (unique index created in migration)
    abha_verified INTEGER DEFAULT 0, -- 0 = not verified, 1 = verified
    abha_verified_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Specialties table
CREATE TABLE IF NOT EXISTS specialties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    icon TEXT DEFAULT '🩺',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Doctors table (extends users)
CREATE TABLE IF NOT EXISTS doctors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    specialty_id INTEGER NOT NULL,
    license_number TEXT UNIQUE NOT NULL,
    bio TEXT,
    location TEXT DEFAULT 'Downtown Medical Center',
    rating REAL DEFAULT 4.9,
    experience_years INTEGER DEFAULT 10,
    consultation_fee REAL DEFAULT 150,
    available_days TEXT, -- JSON array of days: ["monday", "tuesday", ...]
    available_hours_start TEXT, -- HH:MM format
    available_hours_end TEXT, -- HH:MM format
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (specialty_id) REFERENCES specialties(id)
);

-- Appointments & Queue table
CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    doctor_id INTEGER NOT NULL,
    appointment_date DATE NOT NULL,
    appointment_time TIME NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in-progress', 'completed', 'cancelled', 'no-show')),
    queue_number INTEGER DEFAULT 1,
    queue_status TEXT DEFAULT 'waiting' CHECK (queue_status IN ('waiting', 'in-consultation', 'completed', 'cancelled')),
    estimated_wait_mins INTEGER DEFAULT 15,

    -- Priority queue fields (Swasthya Saarthi)
    priority_level INTEGER DEFAULT 3 CHECK (priority_level BETWEEN 1 AND 5), -- 1=Critical, 2=Urgent, 3=Normal, 4=Low, 5=Routine
    priority_score REAL DEFAULT 100.0, -- Computed: base_score + wait_time_bonus + clinical_acuity + fairness_offset
    priority_reason TEXT, -- Human-readable reason for priority assignment

    notes TEXT,
    diagnosis TEXT,
    prescription TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    UNIQUE(doctor_id, appointment_date, appointment_time) -- Prevent double booking
);

-- Feature 2: Patient Reports / Medical Documents
CREATE TABLE IF NOT EXISTS patient_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
    file_name TEXT NOT NULL, -- UUID + extension (stored name)
    original_name TEXT NOT NULL, -- Original filename from user
    mime_type TEXT NOT NULL, -- application/pdf, image/jpeg, image/png
    file_size INTEGER NOT NULL, -- Size in bytes
    file_path TEXT NOT NULL, -- Relative path from uploads directory
    document_type TEXT, -- 'lab_result', 'prescription', 'imaging', 'discharge_summary', 'other'
    description TEXT,
    uploaded_by INTEGER REFERENCES users(id), -- User who uploaded
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_patient_reports_patient ON patient_reports(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_reports_appointment ON patient_reports(appointment_id);

-- Feature 3: Symptom Understanding Chatbot
CREATE TABLE IF NOT EXISTS symptom_assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
    session_id TEXT NOT NULL UNIQUE, -- UUID for chat session
    chief_complaint TEXT,
    symptoms_json TEXT, -- JSON array of structured symptoms
    severity_score INTEGER, -- 1-10
    urgency_level TEXT, -- 'routine', 'urgent', 'emergency'
    emergency_flag INTEGER DEFAULT 0, -- 0 = no, 1 = yes
    emergency_reason TEXT,
    summary_for_doctor TEXT, -- Generated summary for doctor
    status TEXT DEFAULT 'in_progress', -- 'in_progress', 'completed', 'abandoned'
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_symptom_assessments_patient ON symptom_assessments(patient_id);
CREATE INDEX IF NOT EXISTS idx_symptom_assessments_appointment ON symptom_assessments(appointment_id);
CREATE INDEX IF NOT EXISTS idx_symptom_assessments_session ON symptom_assessments(session_id);

-- Feature 4: Repeated Enquiries / Appointment Abuse Protocol
CREATE TABLE IF NOT EXISTS account_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL, -- 'booking_created', 'booking_cancelled', 'no_show', 'duplicate_enquiry', 'appointment_completed'
    appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
    metadata_json TEXT, -- JSON: { reason, previous_booking_id, etc. }
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_account_activity_user ON account_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_account_activity_type ON account_activity(activity_type);
CREATE INDEX IF NOT EXISTS idx_account_activity_date ON account_activity(created_at);

CREATE TABLE IF NOT EXISTS account_suspensions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    suspension_type TEXT NOT NULL, -- 'warning', 'temporary', 'permanent'
    reason TEXT NOT NULL,
    trigger_details_json TEXT, -- JSON: { cancellations: 5, no_shows: 3, window_days: 30 }
    suspended_by INTEGER REFERENCES users(id), -- admin who suspended
    suspended_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME, -- NULL for permanent
    lifted_at DATETIME,
    lifted_by INTEGER REFERENCES users(id),
    lift_reason TEXT,
    is_active INTEGER DEFAULT 1 -- 0 = inactive/lifted, 1 = active
);

CREATE INDEX IF NOT EXISTS idx_account_suspensions_user ON account_suspensions(user_id);
CREATE INDEX IF NOT EXISTS idx_account_suspensions_active ON account_suspensions(is_active);

CREATE TABLE IF NOT EXISTS abuse_thresholds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric TEXT NOT NULL UNIQUE, -- 'cancellations_per_30d', 'no_shows_per_90d', 'bookings_per_7d', 'duplicate_enquiries_per_24h'
    threshold INTEGER NOT NULL,
    action TEXT NOT NULL, -- 'flag', 'warn', 'suspend_temporary', 'suspend_permanent'
    window_days INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert default abuse thresholds
INSERT OR IGNORE INTO abuse_thresholds (metric, threshold, action, window_days) VALUES
    ('cancellations_per_30d', 5, 'flag', 30),
    ('no_shows_per_90d', 3, 'warn', 90),
    ('bookings_per_7d', 3, 'flag', 7),
    ('duplicate_enquiries_per_24h', 2, 'warn', 1);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_appointments_patient_date ON appointments(patient_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor_date ON appointments(doctor_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_date_status ON appointments(appointment_date, status);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_abha_id ON users(abha_id);
CREATE INDEX IF NOT EXISTS idx_doctors_specialty ON doctors(specialty_id);

-- Priority queue indexes (Swasthya Saarthi)
CREATE INDEX IF NOT EXISTS idx_appointments_priority ON appointments(doctor_id, appointment_date, priority_score DESC, queue_number ASC);
CREATE INDEX IF NOT EXISTS idx_appointments_priority_level ON appointments(doctor_id, appointment_date, priority_level ASC, priority_score DESC);

-- Trigger to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_users_timestamp
AFTER UPDATE ON users
BEGIN
    UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_doctors_timestamp
AFTER UPDATE ON doctors
BEGIN
    UPDATE doctors SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_appointments_timestamp
AFTER UPDATE ON appointments
BEGIN
    UPDATE appointments SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_patient_reports_timestamp
AFTER UPDATE ON patient_reports
BEGIN
    UPDATE patient_reports SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_abuse_thresholds_timestamp
AFTER UPDATE ON abuse_thresholds
BEGIN
    UPDATE abuse_thresholds SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;