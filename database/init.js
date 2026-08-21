const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'clinic.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

function initializeDatabase() {
  console.log('Initializing Swasthya Saarthi database...');

  // Create database connection
  const db = new Database(DB_PATH);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Read and execute schema
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);

  console.log('Schema created successfully');

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