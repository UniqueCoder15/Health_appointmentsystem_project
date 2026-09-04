/**
 * Swasthya Saarthi — ABHA (Ayushman Bharat Health Account) Service Abstraction
 * Supports Sandbox / Prototype mode and clean adapter pattern for future government NDHM API integration.
 */

const { queries } = require('../database/db');

class ABHAAdapter {
  async link(userId, abhaId) {
    throw new Error('Method not implemented');
  }

  async verify(userId, abhaId, otp) {
    throw new Error('Method not implemented');
  }

  async unlink(userId) {
    throw new Error('Method not implemented');
  }

  async getProfile(abhaId) {
    throw new Error('Method not implemented');
  }
}

class MockABHAAdapter extends ABHAAdapter {
  constructor() {
    super();
    this.mode = 'sandbox';
    this.providerName = 'NDHM ABHA Sandbox / Prototype';
  }

  async link(userId, abhaId) {
    const cleanId = (abhaId || '').replace(/\D/g, '');
    if (cleanId.length !== 14) {
      return { success: false, error: 'ABHA ID must be a valid 14-digit number' };
    }

    // Check duplicate
    const existing = queries.findUserByAbhaId.get(cleanId);
    if (existing && existing.id !== userId) {
      return { success: false, error: 'This ABHA ID is already linked to another account' };
    }

    // Save pending verification status
    queries.updateUserAbha.run(cleanId, 0, null, userId);

    return {
      success: true,
      mode: this.mode,
      message: 'ABHA ID linked successfully. Verification OTP sent to registered mobile.',
      abhaId: cleanId,
      status: 'pending_verification',
      testOtp: '123456' // For sandbox demo convenience
    };
  }

  async verify(userId, abhaId, otp) {
    const cleanId = (abhaId || '').replace(/\D/g, '');
    const user = queries.findUserById.get(userId);

    if (!user || user.abha_id !== cleanId) {
      return { success: false, error: 'Linked ABHA ID mismatch' };
    }

    // In sandbox mode, accept 123456 or any 6-digit OTP
    if (otp !== '123456' && !/^\d{6}$/.test(otp)) {
      return { success: false, error: 'Invalid OTP code. Try 123456 in Sandbox Mode.' };
    }

    const verifiedAt = new Date().toISOString();
    queries.updateUserAbha.run(cleanId, 1, verifiedAt, userId);

    return {
      success: true,
      mode: this.mode,
      message: 'ABHA ID verified successfully (Sandbox Mode)',
      abhaId: cleanId,
      verified: true,
      verifiedAt
    };
  }

  async unlink(userId) {
    queries.updateUserAbha.run(null, 0, null, userId);
    return {
      success: true,
      mode: this.mode,
      message: 'ABHA ID unlinked successfully'
    };
  }

  async getProfile(abhaId) {
    const cleanId = (abhaId || '').replace(/\D/g, '');
    if (cleanId.length !== 14) return null;

    return {
      abhaId: cleanId,
      formattedAbhaId: `${cleanId.slice(0, 2)}-${cleanId.slice(2, 6)}-${cleanId.slice(6, 10)}-${cleanId.slice(10, 14)}`,
      mode: this.mode,
      provider: this.providerName,
      status: 'active'
    };
  }
}

// Active Adapter instance (Can be swapped with RealABHAAdapter when production credentials exist)
const activeAdapter = new MockABHAAdapter();

module.exports = {
  abhaService: activeAdapter,
  MockABHAAdapter
};
