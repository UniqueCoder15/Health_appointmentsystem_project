const express = require('express');
const { queries, getDatabase } = require('../database/db');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { publishToAllAdmins, publishToPatient } = require('../lib/sseManager');

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Helper: Check if user is currently suspended
function checkSuspension(userId) {
  const suspension = queries.getActiveSuspensionByUser.get(userId);
  if (suspension) {
    return {
      suspended: true,
      suspensionType: suspension.suspension_type,
      reason: suspension.reason,
      expiresAt: suspension.expires_at,
      suspendedAt: suspension.suspended_at
    };
  }
  return { suspended: false };
}

// Helper: Log account activity
function logActivity(userId, activityType, appointmentId = null, metadata = {}) {
  queries.createAccountActivity.run(userId, activityType, appointmentId, JSON.stringify(metadata));
}

// Helper: Map metric to activity type
function getActivityTypeForMetric(metric) {
  const metricMap = {
    'cancellations_per_30d': 'booking_cancelled',
    'no_shows_per_90d': 'no_show',
    'bookings_per_7d': 'booking_created',
    'duplicate_enquiries_per_24h': 'duplicate_enquiry'
  };
  return metricMap[metric] || metric;
}

// Helper: Check abuse thresholds and flag if exceeded
function checkAbuseThresholds(userId) {
  const db = getDatabase();
  const thresholds = queries.getAllAbuseThresholds.all();
  const flags = [];

  for (const threshold of thresholds) {
    const windowDays = threshold.window_days;
    const windowStr = `-${windowDays} days`;
    const activityType = getActivityTypeForMetric(threshold.metric);
    const countResult = queries.getAccountActivityCountByType.get(userId, activityType, windowStr);
    const count = countResult?.count || 0;

    if (count >= threshold.threshold) {
      flags.push({
        metric: threshold.metric,
        count,
        threshold: threshold.threshold,
        action: threshold.action,
        windowDays
      });
    }
  }

  return flags;
}

// Get abuse thresholds configuration (admin)
router.get('/thresholds', authorizeRoles('admin'), (req, res) => {
  try {
    const thresholds = queries.getAllAbuseThresholds.all();
    res.json({ thresholds });
  } catch (error) {
    console.error('Get abuse thresholds error:', error);
    res.status(500).json({ error: 'Failed to fetch thresholds' });
  }
});

// Update abuse thresholds (admin)
router.post('/thresholds', authorizeRoles('admin'), (req, res) => {
  try {
    const { metric, threshold, action, window_days } = req.body;

    if (!metric || typeof threshold !== 'number' || !action || typeof window_days !== 'number') {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const validActions = ['flag', 'warn', 'suspend_temporary', 'suspend_permanent'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    const existing = queries.getAbuseThresholdByMetric.get(metric);
    if (!existing) {
      return res.status(404).json({ error: 'Threshold metric not found' });
    }

    queries.updateAbuseThreshold.run(threshold, action, window_days, metric);
    const updated = queries.getAbuseThresholdByMetric.get(metric);

    res.json({ message: 'Threshold updated', threshold: updated });
  } catch (error) {
    console.error('Update abuse threshold error:', error);
    res.status(500).json({ error: 'Failed to update threshold' });
  }
});

// Get flagged users (admin)
router.get('/flagged-users', authorizeRoles('admin'), (req, res) => {
  try {
    const db = getDatabase();
    const patients = db.prepare(`
      SELECT u.id, u.email, u.full_name, u.phone, u.created_at
      FROM users u
      WHERE u.role = 'patient'
    `).all();

    const flaggedUsers = [];

    for (const patient of patients) {
      const flags = checkAbuseThresholds(patient.id);
      if (flags.length > 0) {
        const suspension = queries.getActiveSuspensionByUser.get(patient.id);
        const activity = queries.getAccountActivityByUser.all(patient.id);
        flaggedUsers.push({
          user: patient,
          flags,
          isSuspended: !!suspension,
          suspension: suspension || null,
          recentActivity: activity.slice(0, 20)
        });
      }
    }

    // Sort by number of flags descending
    flaggedUsers.sort((a, b) => b.flags.length - a.flags.length);

    res.json({ flaggedUsers });
  } catch (error) {
    console.error('Get flagged users error:', error);
    res.status(500).json({ error: 'Failed to fetch flagged users' });
  }
});

// Get user's abuse profile (admin)
router.get('/user/:userId', authorizeRoles('admin'), (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const user = queries.findUserById.get(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const flags = checkAbuseThresholds(userId);
    const suspension = queries.getActiveSuspensionByUser.get(userId);
    const suspensionHistory = queries.getSuspensionHistoryByUser.all(userId);
    const activity = queries.getAccountActivityByUser.all(userId);

    res.json({
      user: { id: user.id, email: user.email, full_name: user.full_name, phone: user.phone, role: user.role, created_at: user.created_at },
      flags,
      suspension: suspension || null,
      suspensionHistory,
      activity
    });
  } catch (error) {
    console.error('Get user abuse profile error:', error);
    res.status(500).json({ error: 'Failed to fetch user abuse profile' });
  }
});

// Suspend user (admin)
router.post('/suspend', authorizeRoles('admin'), (req, res) => {
  try {
    const { user_id, suspension_type, reason, expires_at } = req.body;

    if (!user_id || !suspension_type || !reason) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const validTypes = ['warning', 'temporary', 'permanent'];
    if (!validTypes.includes(suspension_type)) {
      return res.status(400).json({ error: 'Invalid suspension type' });
    }

    const user = queries.findUserById.get(user_id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Deactivate any existing active suspensions
    const db = getDatabase();
    db.prepare('UPDATE account_suspensions SET is_active = 0 WHERE user_id = ? AND is_active = 1').run(user_id);

    // Create new suspension
    const triggerDetails = {
      flags: checkAbuseThresholds(user_id),
      suspendedAt: new Date().toISOString()
    };

    const result = queries.createAccountSuspension.run(
      user_id,
      suspension_type,
      reason,
      JSON.stringify(triggerDetails),
      req.user.id,
      suspension_type === 'permanent' ? null : expires_at
    );

    const suspension = queries.getActiveSuspensionByUser.get(user_id);

    // Log activity
    logActivity(user_id, 'account_suspended', null, { suspensionType: suspension_type, reason, suspendedBy: req.user.id });

    // SSE notifications
    const adminUser = queries.findUserById.get(req.user.id);
    publishToAllAdmins({
      type: 'user-suspended',
      userId: user_id,
      userName: user.full_name,
      suspensionType: suspension_type,
      suspension
    });
    publishToPatient(user_id, { type: 'suspension-applied', suspension });

    res.status(201).json({ message: 'User suspended', suspension });
  } catch (error) {
    console.error('Suspend user error:', error);
    res.status(500).json({ error: 'Failed to suspend user' });
  }
});

// Unsuspend user (admin)
router.post('/unsuspend', authorizeRoles('admin'), (req, res) => {
  try {
    const { user_id, lift_reason } = req.body;

    if (!user_id || !lift_reason) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const suspension = queries.getActiveSuspensionByUser.get(user_id);
    if (!suspension) {
      return res.status(404).json({ error: 'No active suspension found' });
    }

    queries.liftSuspension.run(req.user.id, lift_reason, suspension.id);

    // Log activity
    logActivity(user_id, 'account_unsuspended', null, { liftReason: lift_reason, liftedBy: req.user.id });

    // SSE notifications
    publishToAllAdmins({
      type: 'user-unsuspended',
      userId: user_id,
      userName: user.full_name,
      liftReason: lift_reason
    });
    publishToPatient(user_id, { type: 'suspension-lifted', liftReason: lift_reason });

    res.json({ message: 'Suspension lifted' });
  } catch (error) {
    console.error('Unsuspend user error:', error);
    res.status(500).json({ error: 'Failed to lift suspension' });
  }
});

// Check if user is suspended (for booking validation)
router.get('/check/:userId', (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const suspension = checkSuspension(userId);
    res.json(suspension);
  } catch (error) {
    console.error('Check suspension error:', error);
    res.status(500).json({ error: 'Failed to check suspension' });
  }
});

// Get current user's suspension status (patient self-check)
router.get('/my-status', (req, res) => {
  try {
    const suspension = checkSuspension(req.user.id);
    res.json(suspension);
  } catch (error) {
    console.error('Get my suspension status error:', error);
    res.status(500).json({ error: 'Failed to check suspension status' });
  }
});

// Log activity (internal use by other routes)
router.post('/log-activity', (req, res) => {
  try {
    const { user_id, activity_type, appointment_id, metadata } = req.body;

    if (!user_id || !activity_type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    logActivity(user_id, activity_type, appointment_id, metadata || {});

    // Check thresholds after logging
    const flags = checkAbuseThresholds(user_id);
    if (flags.length > 0) {
      // Notify admins
      const user = queries.findUserById.get(user_id);
      for (const flag of flags) {
        publishToAllAdmins({
          type: 'abuse-flag-raised',
          userId: user_id,
          userName: user?.full_name || 'Unknown',
          metric: flag.metric,
          count: flag.count,
          threshold: flag.threshold,
          action: flag.action
        });
      }
    }

    res.json({ message: 'Activity logged', flags });
  } catch (error) {
    console.error('Log activity error:', error);
    res.status(500).json({ error: 'Failed to log activity' });
  }
});

// Admin: Get all active suspensions
router.get('/suspensions', authorizeRoles('admin'), (req, res) => {
  try {
    const suspensions = queries.getAllActiveSuspensions.all();
    res.json({ suspensions });
  } catch (error) {
    console.error('Get all suspensions error:', error);
    res.status(500).json({ error: 'Failed to fetch suspensions' });
  }
});

module.exports = router;