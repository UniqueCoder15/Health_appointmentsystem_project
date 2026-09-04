const express = require('express');
const { abhaService } = require('../services/abhaService');
const { authenticateToken } = require('../middleware/auth');
const { publishToPatient, publishToAllAdmins } = require('../lib/sseManager');
const { queries } = require('../database/db');

const router = express.Router();

router.use(authenticateToken);

// Get current user ABHA status
router.get('/status', (req, res) => {
  try {
    const user = queries.findUserById.get(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const status = user.abha_id ? (user.abha_verified ? 'verified' : 'pending_verification') : 'not_linked';

    res.json({
      success: true,
      mode: 'sandbox',
      provider: 'NDHM ABHA Sandbox / Prototype Mode',
      abha_id: user.abha_id,
      abha_verified: !!user.abha_verified,
      abha_verified_at: user.abha_verified_at,
      status
    });
  } catch (error) {
    console.error('Get ABHA status error:', error);
    res.status(500).json({ error: 'Failed to fetch ABHA status' });
  }
});

// Link ABHA ID
router.post('/link', async (req, res) => {
  try {
    const { abha_id } = req.body;
    if (!abha_id) {
      return res.status(400).json({ error: 'ABHA ID is required' });
    }

    const result = await abhaService.link(req.user.id, abha_id);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    publishToPatient(req.user.id, { type: 'abha-updated', status: 'pending_verification', abhaId: result.abhaId });
    publishToAllAdmins({ type: 'abha-updated', userId: req.user.id, userName: req.user.full_name, abhaId: result.abhaId });

    res.json(result);
  } catch (error) {
    console.error('Link ABHA error:', error);
    res.status(500).json({ error: 'Failed to link ABHA ID' });
  }
});

// Verify ABHA OTP
router.post('/verify', async (req, res) => {
  try {
    const dbUser = queries.findUserById.get(req.user.id);
    const abha_id = req.body.abha_id || (dbUser ? dbUser.abha_id : null);
    const otp = req.body.otp;
    if (!abha_id || !otp) {
      return res.status(400).json({ error: 'ABHA ID and OTP are required' });
    }

    const result = await abhaService.verify(req.user.id, abha_id, otp);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    publishToPatient(req.user.id, { type: 'abha-updated', status: 'verified', abhaId: result.abhaId });
    publishToAllAdmins({ type: 'abha-updated', userId: req.user.id, userName: req.user.full_name, abhaId: result.abhaId });

    res.json(result);
  } catch (error) {
    console.error('Verify ABHA error:', error);
    res.status(500).json({ error: 'Failed to verify ABHA ID' });
  }
});

// Unlink ABHA ID
const handleUnlink = async (req, res) => {
  try {
    const result = await abhaService.unlink(req.user.id);

    publishToPatient(req.user.id, { type: 'abha-updated', status: 'not_linked', abhaId: null });
    publishToAllAdmins({ type: 'abha-updated', userId: req.user.id, userName: req.user.full_name, abhaId: null });

    res.json(result);
  } catch (error) {
    console.error('Unlink ABHA error:', error);
    res.status(500).json({ error: 'Failed to unlink ABHA ID' });
  }
};

router.post('/unlink', handleUnlink);
router.delete('/unlink', handleUnlink);

module.exports = router;
