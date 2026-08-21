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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_appointments_patient_date ON appointments(patient_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor_date ON appointments(doctor_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_date_status ON appointments(appointment_date, status);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
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