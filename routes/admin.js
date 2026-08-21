const express = require('express');
const { queries } = require('../database/db');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { validateAppointmentQuery } = require('../middleware/validation');
const { getDatabase } = require('../database/db');

const router = express.Router();

// All routes require admin role
router.use(authenticateToken);
router.use(authorizeRoles('admin'));

// Get dashboard statistics
router.get('/stats', (req, res) => {
  try {
    const stats = queries.getStats.get();

    // Additional stats
    const recentAppointments = queries.getAllAppointments.all().slice(0, 10);
    const appointmentsByStatus = queries.getAllAppointments.all().reduce((acc, apt) => {
      acc[apt.status] = (acc[apt.status] || 0) + 1;
      return acc;
    }, {});

    const appointmentsBySpecialty = queries.getAllAppointments.all().reduce((acc, apt) => {
      acc[apt.specialty_name] = (acc[apt.specialty_name] || 0) + 1;
      return acc;
    }, {});

    res.json({
      stats,
      recentAppointments,
      appointmentsByStatus,
      appointmentsBySpecialty
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Get all users (admin)
router.get('/users', (req, res) => {
  try {
    const db = require('../database/db').getDatabase();
    const users = db.prepare(`
      SELECT id, email, full_name, phone, role, created_at
      FROM users
      ORDER BY created_at DESC
    `).all();

    res.json({ users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Update user role (admin)
router.put('/users/:id/role', (req, res) => {
  try {
    const { role } = req.body;
    const { id } = req.params;

    if (!['patient', 'doctor', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const db = require('../database/db').getDatabase();
    const result = db.prepare('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(role, id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = db.prepare('SELECT id, email, full_name, phone, role, created_at FROM users WHERE id = ?').get(id);
    res.json({ message: 'User role updated', user });
  } catch (error) {
    console.error('Update user role error:', error);
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

// Delete user (admin)
router.delete('/users/:id', (req, res) => {
  try {
    const { id } = req.params;

    // Prevent deleting self
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const db = require('../database/db').getDatabase();
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Get all appointments with filters (admin)
router.get('/appointments', validateAppointmentQuery, (req, res) => {
  try {
    let appointments = queries.getAllAppointments.all();

    // Apply filters
    if (req.query.date_from) {
      appointments = appointments.filter(a => a.appointment_date >= req.query.date_from);
    }
    if (req.query.date_to) {
      appointments = appointments.filter(a => a.appointment_date <= req.query.date_to);
    }
    if (req.query.status) {
      appointments = appointments.filter(a => a.status === req.query.status);
    }
    if (req.query.doctor_id) {
      appointments = appointments.filter(a => a.doctor_id === parseInt(req.query.doctor_id));
    }
    if (req.query.patient_id) {
      appointments = appointments.filter(a => a.patient_id === parseInt(req.query.patient_id));
    }

    res.json({ appointments });
  } catch (error) {
    console.error('Get admin appointments error:', error);
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// Get appointment statistics by date range
router.get('/appointments/stats', (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    const from = date_from || '1900-01-01';
    const to = date_to || '2100-12-31';

    const db = require('../database/db').getDatabase();

    const stats = db.prepare(`
      SELECT
        appointment_date,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) as scheduled,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
        SUM(CASE WHEN status = 'no-show' THEN 1 ELSE 0 END) as no_show
      FROM appointments
      WHERE appointment_date BETWEEN ? AND ?
      GROUP BY appointment_date
      ORDER BY appointment_date
    `).all(from, to);

    res.json({ stats });
  } catch (error) {
    console.error('Get appointment stats error:', error);
    res.status(500).json({ error: 'Failed to fetch appointment statistics' });
  }
});

// ============================================================
// Priority Engine Configuration Routes
// ============================================================

// Get priority levels configuration
router.get('/priority/levels', (req, res) => {
  try {
    const db = getDatabase();
    // Return default priority levels (could be stored in DB)
    const levels = [
      { level: 1, name: 'Critical', icon: '🚨', baseScore: 880, description: 'Life-threatening emergencies' },
      { level: 2, name: 'Urgent', icon: '⚡', baseScore: 760, description: 'Requires attention within 15-30 min' },
      { level: 3, name: 'Normal', icon: '🟢', baseScore: 640, description: 'Standard walk-in / scheduled' },
      { level: 4, name: 'Low', icon: '🔵', baseScore: 520, description: 'Routine follow-ups, non-urgent' },
      { level: 5, name: 'Routine', icon: '⚪', baseScore: 400, description: 'Annual checkups, preventive' }
    ];
    res.json({ levels });
  } catch (error) {
    console.error('Get priority levels error:', error);
    res.status(500).json({ error: 'Failed to fetch priority levels' });
  }
});

// Get priority weights configuration
router.get('/priority/weights', (req, res) => {
  try {
    const db = getDatabase();
    // Return default weights (could be stored in DB)
    const weights = {
      base: 1.0,
      wait: 0.5,
      fairness: 2.0,
      acuity: 100
    };
    res.json({ weights });
  } catch (error) {
    console.error('Get priority weights error:', error);
    res.status(500).json({ error: 'Failed to fetch priority weights' });
  }
});

// Save priority weights
router.post('/priority/weights', (req, res) => {
  try {
    const { base, wait, fairness, acuity } = req.body;

    // Validate
    if (typeof base !== 'number' || base < 0.1 || base > 10) {
      return res.status(400).json({ error: 'Base weight must be between 0.1 and 10' });
    }
    if (typeof wait !== 'number' || wait < 0 || wait > 10) {
      return res.status(400).json({ error: 'Wait weight must be between 0 and 10' });
    }
    if (typeof fairness !== 'number' || fairness < 0 || fairness > 10) {
      return res.status(400).json({ error: 'Fairness weight must be between 0 and 10' });
    }
    if (typeof acuity !== 'number' || acuity < 0 || acuity > 500) {
      return res.status(400).json({ error: 'Acuity weight must be between 0 and 500' });
    }

    // In a real implementation, save to database
    // For now, return success
    res.json({
      message: 'Priority weights saved successfully',
      weights: { base, wait, fairness, acuity }
    });
  } catch (error) {
    console.error('Save priority weights error:', error);
    res.status(500).json({ error: 'Failed to save priority weights' });
  }
});

// Get acuity rules
router.get('/priority/acuity', (req, res) => {
  try {
    // Return default acuity rules
    const rules = {
      1: 400, // Critical
      2: 200, // Urgent
      3: 100, // Normal
      4: 50,  // Low
      5: 0    // Routine
    };
    res.json({ rules });
  } catch (error) {
    console.error('Get acuity rules error:', error);
    res.status(500).json({ error: 'Failed to fetch acuity rules' });
  }
});

// Save acuity rules
router.post('/priority/acuity', (req, res) => {
  try {
    const rules = req.body;

    // Validate
    const validLevels = ['1', '2', '3', '4', '5'];
    for (const [level, score] of Object.entries(rules)) {
      if (!validLevels.includes(level)) {
        return res.status(400).json({ error: `Invalid priority level: ${level}` });
      }
      if (typeof score !== 'number' || score < 0 || score > 1000) {
        return res.status(400).json({ error: `Acuity score for level ${level} must be between 0 and 1000` });
      }
    }

    // In a real implementation, save to database
    res.json({
      message: 'Acuity rules saved successfully',
      rules
    });
  } catch (error) {
    console.error('Save acuity rules error:', error);
    res.status(500).json({ error: 'Failed to save acuity rules' });
  }
});

// Get queue priority distribution
router.get('/priority/distribution', (req, res) => {
  try {
    const db = getDatabase();

    // Get today's queue with priority levels
    const today = new Date().toISOString().split('T')[0];
    const queue = db.prepare(`
      SELECT priority_level, COUNT(*) as count
      FROM appointments
      WHERE appointment_date = ?
        AND status = 'scheduled'
        AND queue_status IN ('waiting', 'in-consultation')
      GROUP BY priority_level
      ORDER BY priority_level
    `).all(today);

    // Add icons and names
    const priorityMeta = {
      1: { name: 'Critical', icon: '🚨', color: '#ef4444' },
      2: { name: 'Urgent', icon: '⚡', color: '#f97316' },
      3: { name: 'Normal', icon: '🟢', color: '#22c55e' },
      4: { name: 'Low', icon: '🔵', color: '#3b82f6' },
      5: { name: 'Routine', icon: '⚪', color: '#64748b' }
    };

    const distribution = queue.map(q => ({
      level: q.priority_level,
      count: q.count,
      ...priorityMeta[q.priority_level]
    }));

    // Ensure all levels are represented
    [1,2,3,4,5].forEach(level => {
      if (!distribution.find(d => d.level === level)) {
        distribution.push({ level, count: 0, ...priorityMeta[level] });
      }
    });

    distribution.sort((a, b) => a.level - b.level);

    res.json({ distribution });
  } catch (error) {
    console.error('Get priority distribution error:', error);
    res.status(500).json({ error: 'Failed to fetch priority distribution' });
  }
});

module.exports = router;