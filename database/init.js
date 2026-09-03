const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'clinic.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

function runMigrations(db) {
  console.log('Running database migrations...');

  // Feature 1: Add ABHA columns to users table
  const usersColumns = db.prepare("PRAGMA table_info(users)").all();
  const usersColumnNames = usersColumns.map(c => c.name);

  if (!usersColumnNames.includes('abha_id')) {
    db.exec('ALTER TABLE users ADD COLUMN abha_id TEXT');
    console.log('  Added abha_id column to users');
  }

  // Create unique index for abha_id (after column exists)
  const abhaIndexExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_users_abha_id_unique'").get();
  if (!abhaIndexExists) {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_abha_id_unique ON users(abha_id) WHERE abha_id IS NOT NULL');
    console.log('  Created unique index for abha_id');
  }
  if (!usersColumnNames.includes('abha_verified')) {
    db.exec('ALTER TABLE users ADD COLUMN abha_verified INTEGER DEFAULT 0');
    console.log('  Added abha_verified column to users');
  }
  if (!usersColumnNames.includes('abha_verified_at')) {
    db.exec('ALTER TABLE users ADD COLUMN abha_verified_at DATETIME');
    console.log('  Added abha_verified_at column to users');
  }

  // Feature 2: Create patient_reports table
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const tableNames = tables.map(t => t.name);

  if (!tableNames.includes('patient_reports')) {
    db.exec(`
      CREATE TABLE patient_reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
          file_name TEXT NOT NULL,
          original_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          file_path TEXT NOT NULL,
          document_type TEXT,
          description TEXT,
          uploaded_by INTEGER REFERENCES users(id),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_patient_reports_patient ON patient_reports(patient_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_patient_reports_appointment ON patient_reports(appointment_id)');
    console.log('  Created patient_reports table');
  }

  // Feature 3: Create symptom_assessments table
  if (!tableNames.includes('symptom_assessments')) {
    db.exec(`
      CREATE TABLE symptom_assessments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
          session_id TEXT NOT NULL UNIQUE,
          chief_complaint TEXT,
          symptoms_json TEXT,
          severity_score INTEGER,
          urgency_level TEXT,
          emergency_flag INTEGER DEFAULT 0,
          emergency_reason TEXT,
          summary_for_doctor TEXT,
          status TEXT DEFAULT 'in_progress',
          started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          completed_at DATETIME
      );
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_symptom_assessments_patient ON symptom_assessments(patient_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_symptom_assessments_appointment ON symptom_assessments(appointment_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_symptom_assessments_session ON symptom_assessments(session_id)');
    console.log('  Created symptom_assessments table');
  }

  // Feature 4: Create account_activity table
  if (!tableNames.includes('account_activity')) {
    db.exec(`
      CREATE TABLE account_activity (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          activity_type TEXT NOT NULL,
          appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
          metadata_json TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_account_activity_user ON account_activity(user_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_account_activity_type ON account_activity(activity_type)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_account_activity_date ON account_activity(created_at)');
    console.log('  Created account_activity table');
  }

  // Create account_suspensions table
  if (!tableNames.includes('account_suspensions')) {
    db.exec(`
      CREATE TABLE account_suspensions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          suspension_type TEXT NOT NULL,
          reason TEXT NOT NULL,
          trigger_details_json TEXT,
          suspended_by INTEGER REFERENCES users(id),
          suspended_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME,
          lifted_at DATETIME,
          lifted_by INTEGER REFERENCES users(id),
          lift_reason TEXT,
          is_active INTEGER DEFAULT 1
      );
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_account_suspensions_user ON account_suspensions(user_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_account_suspensions_active ON account_suspensions(is_active)');
    console.log('  Created account_suspensions table');
  }

  // Create abuse_thresholds table with defaults
  if (!tableNames.includes('abuse_thresholds')) {
    db.exec(`
      CREATE TABLE abuse_thresholds (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          metric TEXT NOT NULL UNIQUE,
          threshold INTEGER NOT NULL,
          action TEXT NOT NULL,
          window_days INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('  Created abuse_thresholds table');

    const insertThreshold = db.prepare(`
      INSERT OR IGNORE INTO abuse_thresholds (metric, threshold, action, window_days)
      VALUES (?, ?, ?, ?)
    `);
    insertThreshold.run('cancellations_per_30d', 5, 'flag', 30);
    insertThreshold.run('no_shows_per_90d', 3, 'warn', 90);
    insertThreshold.run('bookings_per_7d', 3, 'flag', 7);
    insertThreshold.run('duplicate_enquiries_per_24h', 2, 'warn', 1);
    console.log('  Inserted default abuse thresholds');
  }

  // Add new indexes - idx_users_abha_id_unique already created in migration above
  // Partial unique index handles NULL values correctly

  // Add new triggers for updated_at
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_patient_reports_timestamp
    AFTER UPDATE ON patient_reports
    BEGIN
        UPDATE patient_reports SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_abuse_thresholds_timestamp
    AFTER UPDATE ON abuse_thresholds
    BEGIN
        UPDATE abuse_thresholds SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
  `);

  console.log('Migrations completed');
}

function initializeDatabase() {
  console.log('Initializing Swasthya Saarthi database...');

  // Create database connection
  const db = new Database(DB_PATH);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  
  // First apply schema so all base tables exist
const  schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

console.log('Schema created successfully');

// Then run migrations for additional features/columns
runMigrations(db);

  // Insert default specialties with icons matching Figma design
  const specialties = [
    { name: 'Cardiology', description: 'Heart and cardiovascular system care', icon: '❤️' },
    { name: 'Neurology', description: 'Nervous system, brain & spine disorders', icon: '🧠' },
    { name: 'Orthopedics', description: 'Bones, joints, and muscular health', icon: '🦴' },
    { name: 'Pediatrics', description: 'Infant, child, and adolescent medicine', icon: '👶' },
    { name: 'Dermatology', description: 'Skin, hair, and dermatological care', icon: '🔬' },
    { name: 'Pulmonology', description: 'Lungs and respiratory system health', icon: '🫁' },
    { name: 'General Medicine', description: 'Primary care and general health screening', icon: '🩺' },
    { name: 'Psychiatry', description: 'Mental health & wellness support', icon: '🧠' },
    { name: 'Ophthalmology', description: 'Comprehensive eye care & surgery', icon: '👁️' },
    { name: 'ENT', description: 'Ear, nose, and throat treatment', icon: '👂' }
  ];

  const insertSpecialty = db.prepare('INSERT OR IGNORE INTO specialties (name, description, icon) VALUES (?, ?, ?)');
  for (const spec of specialties) {
    insertSpecialty.run(spec.name, spec.description, spec.icon);
  }
  console.log('Default specialties inserted');

  // Create default admin user
  const adminEmail = 'admin@clinic.com';
  const adminPassword = 'admin123';
  const passwordHash = bcrypt.hashSync(adminPassword, 10);

  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (email, password_hash, full_name, phone, role, avatar)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertUser.run(adminEmail, passwordHash, 'System Administrator', '+91-99000-00000', 'admin', '⚙️');
  console.log('Default admin user created (admin@clinic.com / admin123)');

  // Create Indian doctor profiles
  const doctors = [
    {
      email: 'dr.sharma@clinic.com',
      password: 'doctor123',
      name: 'Dr. Ananya Sharma',
      phone: '+91-98110-01100',
      specialty: 'Cardiology',
      license: 'MCI99881',
      bio: 'Lead Cardiologist specializing in preventive heart care, angiography and non-invasive diagnostics.',
      location: 'AIIMS New Delhi',
      rating: 4.9,
      experience: 14,
      fee: 800,
      days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      start: '08:30',
      end: '17:00'
    },
    {
      email: 'dr.patel@clinic.com',
      password: 'doctor123',
      name: 'Dr. Rajesh Patel',
      phone: '+91-98220-02200',
      specialty: 'Orthopedics',
      license: 'MCI99882',
      bio: 'Senior Orthopedic Surgeon specializing in joint replacement, knee arthroscopy and sports rehabilitation.',
      location: 'Fortis Healthcare Gurgaon',
      rating: 4.8,
      experience: 16,
      fee: 1200,
      days: ['monday', 'tuesday', 'wednesday', 'thursday'],
      start: '09:00',
      end: '16:30'
    },
    {
      email: 'dr.sen@clinic.com',
      password: 'doctor123',
      name: 'Dr. Vikramaditya Sen',
      phone: '+1-555-0101',
      specialty: 'Cardiology',
      license: 'MCI12345',
      bio: 'Board-certified Interventional Cardiologist with 15 years of clinical practice.',
      location: 'Apollo Hospital Mumbai',
      rating: 4.7,
      experience: 15,
      fee: 900,
      days: ['monday', 'wednesday', 'friday'],
      start: '09:00',
      end: '17:00'
    },
    {
      email: 'dr.nair@clinic.com',
      password: 'doctor123',
      name: 'Dr. Priya Nair',
      phone: '+91-98440-04400',
      specialty: 'Dermatology',
      license: 'MCI12346',
      bio: 'Consultant Dermatologist specializing in medical dermatology, trichology and skin care.',
      location: 'Max Super Speciality Hospital Delhi',
      rating: 4.9,
      experience: 10,
      fee: 750,
      days: ['tuesday', 'thursday', 'saturday'],
      start: '10:00',
      end: '16:00'
    },
    {
      email: 'dr.reddy@clinic.com',
      password: 'doctor123',
      name: 'Dr. Kavita Reddy',
      phone: '+91-98550-05500',
      specialty: 'Pediatrics',
      license: 'MCI12348',
      bio: 'Senior Pediatric Specialist focused on child growth, vaccination and preventive care.',
      location: 'Manipal Hospital Bengaluru',
      rating: 4.9,
      experience: 8,
      fee: 600,
      days: ['monday', 'wednesday', 'friday', 'saturday'],
      start: '09:00',
      end: '14:00'
    }
  ];

  const getSpecialtyId = db.prepare('SELECT id FROM specialties WHERE name = ?');
  const insertDoctor = db.prepare(`
    INSERT OR IGNORE INTO doctors (user_id, specialty_id, license_number, bio, location, rating, experience_years, consultation_fee, available_days, available_hours_start, available_hours_end)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const doc of doctors) {
    const userHash = bcrypt.hashSync(doc.password, 10);
    const result = db.prepare('INSERT OR IGNORE INTO users (email, password_hash, full_name, phone, role, avatar) VALUES (?, ?, ?, ?, ?, ?)')
      .run(doc.email, userHash, doc.name, doc.phone, 'doctor', '👨‍⚕️');

    if (result.changes > 0) {
      const userId = result.lastInsertRowid;
      const specialty = getSpecialtyId.get(doc.specialty);

      if (specialty) {
        insertDoctor.run(
          userId,
          specialty.id,
          doc.license,
          doc.bio,
          doc.location,
          doc.rating,
          doc.experience,
          doc.fee,
          JSON.stringify(doc.days),
          doc.start,
          doc.end
        );
        console.log(`Created doctor: ${doc.name} (${doc.specialty})`);
      }
    }
  }

  // Create sample Indian patients
  const patients = [
    { email: 'patient1@email.com', password: 'patient123', name: 'Aarav Mehta', phone: '+91-98765-43210', avatar: 'AM' },
    { email: 'patient2@email.com', password: 'patient123', name: 'Rohan Gupta', phone: '+91-98123-45678', avatar: 'RG' },
    { email: 'patient3@email.com', password: 'patient123', name: 'Sneha Verma', phone: '+91-97111-22334', avatar: 'SV' }
  ];

  for (const patient of patients) {
    const userHash = bcrypt.hashSync(patient.password, 10);
    db.prepare('INSERT OR IGNORE INTO users (email, password_hash, full_name, phone, role, avatar) VALUES (?, ?, ?, ?, ?, ?)')
      .run(patient.email, userHash, patient.name, patient.phone, 'patient', patient.avatar);
  }
  console.log('Sample Indian patients created');

  // Seed sample appointments for today with full priority queue spectrum
  const patientAarav = db.prepare("SELECT id FROM users WHERE email = 'patient1@email.com'").get();
  const patientRohan = db.prepare("SELECT id FROM users WHERE email = 'patient2@email.com'").get();
  const patientSneha = db.prepare("SELECT id FROM users WHERE email = 'patient3@email.com'").get();
  const drSharma = db.prepare("SELECT d.id FROM doctors d JOIN users u ON d.user_id = u.id WHERE u.email = 'dr.sharma@clinic.com'").get();
  const drPatel = db.prepare("SELECT d.id FROM doctors d JOIN users u ON d.user_id = u.id WHERE u.email = 'dr.patel@clinic.com'").get();

  if (patientAarav && patientRohan && patientSneha && drSharma && drPatel) {
    const todayStr = new Date().toISOString().split('T')[0];

    const insertAppt = db.prepare(`
      INSERT OR IGNORE INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status, queue_number, queue_status, estimated_wait_mins, priority_level, priority_score, priority_reason, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Today's Priority Queue for Dr. Ananya Sharma
    // 1. Critical Priority (Level 1)
    insertAppt.run(patientRohan.id, drSharma.id, todayStr, '09:00', 'scheduled', 1, 'waiting', 0, 1, 998.0, 'High-risk emergency symptoms indicated', 'Severe chest pain & shortness of breath');

    // 2. High Priority (Level 2)
    insertAppt.run(patientSneha.id, drSharma.id, todayStr, '09:15', 'scheduled', 2, 'waiting', 15, 2, 846.0, 'Acute condition requiring urgent evaluation', 'High fever 103F & severe headache');

    // 3. Medium Priority (Level 3)
    insertAppt.run(patientAarav.id, drSharma.id, todayStr, '09:30', 'scheduled', 3, 'waiting', 30, 3, 694.0, 'Moderate symptomatic condition', 'Moderate chest discomfort & fatigue');

    // Upcoming appointment for Dr. Rajesh Patel on Aug 25
    insertAppt.run(patientAarav.id, drPatel.id, '2026-08-25', '15:15', 'scheduled', 1, 'waiting', 0, 4, 548.0, 'Routine / non-urgent consultation', 'Orthopedic knee joint evaluation');

    // Historical completed appointments
    for (let i = 1; i <= 10; i++) {
      const pastDate = new Date(Date.now() - i * 86400000 * 2).toISOString().split('T')[0];
      insertAppt.run(patientAarav.id, drSharma.id, pastDate, '10:00', 'completed', i, 'completed', 0, 4, 500.0, 'Routine consultation', 'Follow-up consultation completed.');
    }
  }

  // Seed sample patient reports for patient 7 (Aarav Mehta)
  const patientAaravId = patientAarav?.id;
  const drSharmaId = drSharma?.id;
  const drPatelId = drPatel?.id;

  if (patientAaravId && drSharmaId) {
    const insertReport = db.prepare(`
      INSERT OR IGNORE INTO patient_reports (patient_id, appointment_id, file_name, original_name, mime_type, file_size, file_path, document_type, description, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Get some appointment IDs for patient 7 with doctor 1
    const sampleAppointments = db.prepare(`
      SELECT id FROM appointments WHERE patient_id = ? AND doctor_id = ? AND status = 'completed' ORDER BY appointment_date DESC LIMIT 5
    `).all(patientAaravId, drSharmaId);

    if (sampleAppointments.length > 0) {
      // Sample report 1 - Lab result
      insertReport.run(
        patientAaravId,
        sampleAppointments[0]?.id || null,
        'a1b2c3d4-lab-results.pdf',
        'CBC_Lipid_Profile_2024.pdf',
        'application/pdf',
        245760,
        'a1b2c3d4-lab-results.pdf',
        'lab_result',
        'Complete blood count and lipid profile from annual checkup',
        patientAaravId // Self-uploaded by patient
      );

      // Sample report 2 - Prescription
      if (sampleAppointments.length > 1) {
        insertReport.run(
          patientAaravId,
          sampleAppointments[1]?.id || null,
          'e5f6g7h8-prescription.pdf',
          'Prescription_Cardio_Meds.pdf',
          'application/pdf',
          156432,
          'e5f6g7h8-prescription.pdf',
          'prescription',
          'Prescription for hypertension and cholesterol management',
          drSharmaId // Uploaded by doctor
        );
      }

      // Sample report 3 - Imaging
      if (sampleAppointments.length > 2) {
        insertReport.run(
          patientAaravId,
          sampleAppointments[2]?.id || null,
          'i9j0k1l2-ecg.jpg',
          'ECG_Report.jpg',
          'image/jpeg',
          892100,
          'i9j0k1l2-ecg.jpg',
          'imaging',
          'ECG showing normal sinus rhythm',
          drSharmaId // Uploaded by doctor
        );
      }

      console.log('Sample patient reports created for patient 7');
    }
  }

  // Seed sample symptom assessments for patient 7
  if (patientAaravId) {
    const insertAssessment = db.prepare(`
      INSERT OR IGNORE INTO symptom_assessments (patient_id, appointment_id, session_id, chief_complaint, symptoms_json, severity_score, urgency_level, emergency_flag, emergency_reason, summary_for_doctor, status, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const crypto = require('crypto');

    // Assessment 1 - Completed with emergency flag (linked to an appointment)
    const apptWithSymptoms = db.prepare(`
      SELECT id FROM appointments WHERE patient_id = ? AND doctor_id = ? AND status = 'completed' ORDER BY appointment_date DESC LIMIT 1
    `).get(patientAaravId, drSharmaId);

    if (apptWithSymptoms) {
      const sessionId1 = crypto.randomUUID();
      const symptoms1 = [
        { questionId: 'chief_complaint', answer: 'Chest pain and shortness of breath for 2 days', timestamp: '2026-08-20T10:00:00Z' },
        { questionId: 'body_system', answer: 'chest', timestamp: '2026-08-20T10:01:00Z' },
        { questionId: 'specific_symptoms', answer: 'Sharp chest pain radiating to left arm, worse with exertion. Shortness of breath on climbing stairs. No palpitations.', timestamp: '2026-08-20T10:02:00Z' },
        { questionId: 'severity', answer: '8', timestamp: '2026-08-20T10:03:00Z' },
        { questionId: 'duration', answer: 'days', timestamp: '2026-08-20T10:04:00Z' },
        { questionId: 'associated', answer: ['fatigue', 'sweating'], timestamp: '2026-08-20T10:05:00Z' },
        { questionId: 'medications', answer: 'Amlodipine 5mg daily, Atorvastatin 20mg daily', timestamp: '2026-08-20T10:06:00Z' },
        { questionId: 'allergies', answer: 'Penicillin', timestamp: '2026-08-20T10:07:00Z' },
        { questionId: 'past_history', answer: 'Hypertension diagnosed 2020, High cholesterol', timestamp: '2026-08-20T10:08:00Z' }
      ];

      const summary1 = `**Chief Complaint:** Chest pain and shortness of breath for 2 days

**Body System:** chest
**Severity:** 8/10
**Duration:** days
**Urgency Level:** URGENT
**⚠️ EMERGENCY FLAG:** Emergency keyword detected: "chest pain"

**Symptoms:** Sharp chest pain radiating to left arm, worse with exertion. Shortness of breath on climbing stairs. No palpitations.

**Associated Symptoms:** fatigue, sweating

**Current Medications:** Amlodipine 5mg daily, Atorvastatin 20mg daily
**Allergies:** Penicillin
**Past Medical History:** Hypertension diagnosed 2020, High cholesterol

**Recommended Specialty:** Cardiology

*This is an AI-assisted symptom summary for clinical reference only. Not a diagnosis.*`;

      insertAssessment.run(
        patientAaravId,
        apptWithSymptoms.id,
        sessionId1,
        'Chest pain and shortness of breath for 2 days',
        JSON.stringify(symptoms1),
        8,
        'urgent',
        1,
        'Emergency keyword detected: "chest pain"',
        summary1,
        'completed',
        '2026-08-20 10:08:00'
      );
    }

    // Assessment 2 - Completed routine (no emergency)
    const apptWithSymptoms2 = db.prepare(`
      SELECT id FROM appointments WHERE patient_id = ? AND doctor_id = ? AND status = 'completed' ORDER BY appointment_date DESC LIMIT 1 OFFSET 1
    `).get(patientAaravId, drSharmaId);

    if (apptWithSymptoms2) {
      const sessionId2 = crypto.randomUUID();
      const symptoms2 = [
        { questionId: 'chief_complaint', answer: 'Routine follow-up for hypertension management', timestamp: '2026-08-15T10:00:00Z' },
        { questionId: 'body_system', answer: 'general', timestamp: '2026-08-15T10:01:00Z' },
        { questionId: 'specific_symptoms', answer: 'Feeling well, no specific complaints. Here for regular BP check and medication review.', timestamp: '2026-08-15T10:02:00Z' },
        { questionId: 'severity', answer: '2', timestamp: '2026-08-15T10:03:00Z' },
        { questionId: 'duration', answer: 'months', timestamp: '2026-08-15T10:04:00Z' },
        { questionId: 'associated', answer: ['none'], timestamp: '2026-08-15T10:05:00Z' },
        { questionId: 'medications', answer: 'Amlodipine 5mg daily, Atorvastatin 20mg daily', timestamp: '2026-08-15T10:06:00Z' },
        { questionId: 'allergies', answer: 'Penicillin', timestamp: '2026-08-15T10:07:00Z' },
        { questionId: 'past_history', answer: 'Hypertension diagnosed 2020, High cholesterol', timestamp: '2026-08-15T10:08:00Z' }
      ];

      const summary2 = `**Chief Complaint:** Routine follow-up for hypertension management

**Body System:** general
**Severity:** 2/10
**Duration:** months
**Urgency Level:** ROUTINE

**Symptoms:** Feeling well, no specific complaints. Here for regular BP check and medication review.

**Associated Symptoms:** None

**Current Medications:** Amlodipine 5mg daily, Atorvastatin 20mg daily
**Allergies:** Penicillin
**Past Medical History:** Hypertension diagnosed 2020, High cholesterol

**Recommended Specialty:** General Medicine

*This is an AI-assisted symptom summary for clinical reference only. Not a diagnosis.*`;

      insertAssessment.run(
        patientAaravId,
        apptWithSymptoms2.id,
        sessionId2,
        'Routine follow-up for hypertension management',
        JSON.stringify(symptoms2),
        2,
        'routine',
        0,
        null,
        summary2,
        'completed',
        '2026-08-15 10:08:00'
      );
    }

    // Assessment 3 - In progress (not completed)
    const sessionId3 = crypto.randomUUID();
    insertAssessment.run(
      patientAaravId,
      null,
      sessionId3,
      'Mild headache and dizziness',
      JSON.stringify([
        { questionId: 'chief_complaint', answer: 'Mild headache and dizziness', timestamp: '2026-09-01T14:00:00Z' },
        { questionId: 'body_system', answer: 'head', timestamp: '2026-09-01T14:01:00Z' },
        { questionId: 'specific_symptoms', answer: 'Intermittent headache for 3 days, mild dizziness when standing up quickly', timestamp: '2026-09-01T14:02:00Z' }
      ]),
      4,
      'routine',
      0,
      null,
      null,
      'in_progress',
      null
    );

    console.log('Sample symptom assessments created for patient 7');
  }

  console.log('\n✅ Database initialization complete!');
  console.log('\nDefault credentials:');
  console.log('  Admin:    admin@clinic.com     / admin123');
  console.log('  Doctors:  dr.sharma@clinic.com  / doctor123');
  console.log('  Patients: patient1@email.com   / patient123');

  db.close();
}

// Run if executed directly
if (require.main === module) {
  initializeDatabase();
}

module.exports = { initializeDatabase };