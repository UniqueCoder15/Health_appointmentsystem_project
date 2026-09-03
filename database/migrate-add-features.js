const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'clinic.db');

function runMigration() {
  console.log('Running migration for new features...');

  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  try {
    // Feature 1: Add ABHA columns to users table
    console.log('Adding ABHA columns to users table...');
    const usersColumns = db.prepare("PRAGMA table_info(users)").all();
    const usersColumnNames = usersColumns.map(c => c.name);

    if (!usersColumnNames.includes('abha_id')) {
      db.exec('ALTER TABLE users ADD COLUMN abha_id TEXT');
      console.log('  Added abha_id column');
    }

    // Create unique index for abha_id (after column exists)
    const abhaIndexExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_users_abha_id_unique'").get();
    if (!abhaIndexExists) {
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_abha_id_unique ON users(abha_id) WHERE abha_id IS NOT NULL');
      console.log('  Created unique index for abha_id');
    }
    if (!usersColumnNames.includes('abha_verified')) {
      db.exec('ALTER TABLE users ADD COLUMN abha_verified INTEGER DEFAULT 0');
      console.log('  Added abha_verified column');
    }
    if (!usersColumnNames.includes('abha_verified_at')) {
      db.exec('ALTER TABLE users ADD COLUMN abha_verified_at DATETIME');
      console.log('  Added abha_verified_at column');
    }

    // Feature 2: Create patient_reports table
    console.log('Creating patient_reports table...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS patient_reports (
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
    console.log('  patient_reports table created');

    // Feature 3: Create symptom_assessments table
    console.log('Creating symptom_assessments table...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS symptom_assessments (
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
    console.log('  symptom_assessments table created');

    // Feature 4: Create account_activity table
    console.log('Creating account_activity table...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS account_activity (
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
    console.log('  account_activity table created');

    // Create account_suspensions table
    console.log('Creating account_suspensions table...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS account_suspensions (
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
    console.log('  account_suspensions table created');

    // Create abuse_thresholds table with defaults
    console.log('Creating abuse_thresholds table...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS abuse_thresholds (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          metric TEXT NOT NULL UNIQUE,
          threshold INTEGER NOT NULL,
          action TEXT NOT NULL,
          window_days INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('  abuse_thresholds table created');

    // Insert default thresholds
    const insertThreshold = db.prepare(`
      INSERT OR IGNORE INTO abuse_thresholds (metric, threshold, action, window_days)
      VALUES (?, ?, ?, ?)
    `);
    insertThreshold.run('cancellations_per_30d', 5, 'flag', 30);
    insertThreshold.run('no_shows_per_90d', 3, 'warn', 90);
    insertThreshold.run('bookings_per_7d', 3, 'flag', 7);
    insertThreshold.run('duplicate_enquiries_per_24h', 2, 'warn', 1);
    console.log('  Default abuse thresholds inserted');

    // Add new indexes for users table
    console.log('Adding new indexes...');
    // idx_users_abha_id_unique already created above with partial unique index
    console.log('  Unique index for abha_id already created');

    // Add new triggers for updated_at
    console.log('Adding new triggers...');
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
    console.log('  Added triggers for updated_at timestamps');

    // Create uploads directory
    console.log('Creating uploads directory...');
    const uploadsDir = path.join(__dirname, '..', 'uploads', 'reports');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
      console.log('  Created uploads/reports directory');
    } else {
      console.log('  uploads/reports directory already exists');
    }

    console.log('\n✅ Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };