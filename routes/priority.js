const express = require('express');
const { queries, getDatabase } = require('../database/db');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { priorityValidationService } = require('../services/priorityValidationService');
const { computePriorityScore, priorityReasonText, getPriorityMeta } = require('../lib/priorityEngine');
const { publishToDoctor, publishToAppointment, publishToAllAdmins, publishToPatient } = require('../lib/sseManager');

const router = express.Router();

router.use(authenticateToken);

// Trigger AI Priority Validation for an appointment
router.post('/validate/:appointmentId', async (req, res) => {
  try {
    const appointmentId = parseInt(req.params.appointmentId);
    const appointment = queries.getAppointmentById.get(appointmentId);

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    // Check authorization: patient owner, doctor, or admin
    if (req.user.role === 'patient' && appointment.patient_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check existing validation override status — do not overwrite clinician manual decision
    const existingVal = queries.getPriorityValidationByAppointment.get(appointmentId);
    if (existingVal && existingVal.review_status === 'overridden') {
      return res.json({
        success: true,
        message: 'Priority was manually overridden by clinician. AI re-overwrite skipped.',
        validation: existingVal
      });
    }

    // Gather context for AI validation
    const patientReports = queries.getPatientReports.all(appointment.patient_id);
    const symptoms = appointment.notes || '';

    const validationResult = await priorityValidationService.validatePriority({
      symptoms,
      severity: appointment.priority_level === 1 ? 9 : (appointment.priority_level === 2 ? 7 : 4),
      existingPriority: appointment.priority_level,
      recordCount: patientReports.length,
      patientAge: 35
    });

    const confidence = validationResult.confidence;
    const action = validationResult.action;
    const recommendedPriority = validationResult.recommended_priority;

    let reviewStatus = 'pending';
    let newPriorityLevel = appointment.priority_level;

    // Automated queue adjustment policy: confidence >= 0.85 and ESCALATE or DOWNGRADE
    if (confidence >= 0.85 && (action === 'ESCALATE' || action === 'DOWNGRADE')) {
      newPriorityLevel = recommendedPriority;
      reviewStatus = 'applied';

      const newScore = computePriorityScore({
        priority_level: newPriorityLevel,
        bookedAt: appointment.created_at,
        queueNumber: appointment.queue_number
      });
      const reasonText = `AI Triage (${action}): ${validationResult.reason_codes.join(', ')}`;

      queries.updateAppointmentPriority.run(newPriorityLevel, newScore, reasonText, appointmentId);
    }

    // Insert audit record
    const result = queries.createPriorityValidation.run(
      appointmentId,
      appointment.patient_id,
      appointment.priority_level,
      recommendedPriority,
      confidence,
      action,
      JSON.stringify(validationResult.reason_codes),
      validationResult.model_version,
      reviewStatus,
      null,
      null
    );

    const auditRecord = queries.getPriorityValidationByAppointment.get(appointmentId);
    const updatedAppointment = queries.getAppointmentById.get(appointmentId);

    // Broadcast SSE queue update
    publishToDoctor(appointment.doctor_id, { type: 'priority-validated', appointmentId, validation: auditRecord, appointment: updatedAppointment });
    publishToPatient(appointment.patient_id, { type: 'priority-validated', appointmentId, validation: auditRecord, appointment: updatedAppointment });
    publishToAllAdmins({ type: 'priority-validated', appointmentId, validation: auditRecord, appointment: updatedAppointment });

    res.json({
      success: true,
      validation: auditRecord,
      appointment: updatedAppointment
    });
  } catch (error) {
    console.error('Trigger priority validation error:', error);
    res.status(500).json({ error: 'Failed to validate priority' });
  }
});

// Get latest validation for an appointment
router.get('/validation/:appointmentId', (req, res) => {
  try {
    const appointmentId = parseInt(req.params.appointmentId);
    const validation = queries.getPriorityValidationByAppointment.get(appointmentId);
    res.json({ validation: validation || null });
  } catch (error) {
    console.error('Get validation error:', error);
    res.status(500).json({ error: 'Failed to fetch priority validation' });
  }
});

// Get all pending priority validations (Doctor/Admin)
router.get('/pending', authorizeRoles('doctor', 'admin'), (req, res) => {
  try {
    const validations = queries.getPendingPriorityValidations.all();
    res.json({ validations });
  } catch (error) {
    console.error('Get pending validations error:', error);
    res.status(500).json({ error: 'Failed to fetch pending validations' });
  }
});

// Clinician Approve AI Recommendation
router.post('/validation/:id/approve', authorizeRoles('doctor', 'admin'), (req, res) => {
  try {
    const validationId = parseInt(req.params.id);
    const validation = getDatabase().prepare('SELECT * FROM priority_validations WHERE id = ?').get(validationId);

    if (!validation) {
      return res.status(404).json({ error: 'Priority validation record not found' });
    }

    const appointment = queries.getAppointmentById.get(validation.appointment_id);
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    const approvedPriority = validation.recommended_priority;
    const newScore = computePriorityScore({
      priority_level: approvedPriority,
      bookedAt: appointment.created_at,
      queueNumber: appointment.queue_number
    });
    const reasonText = `Approved by Clinician: AI Triage (${approvedPriority})`;

    // Update appointment
    queries.updateAppointmentPriority.run(approvedPriority, newScore, reasonText, appointment.id);

    // Update validation audit record
    queries.updatePriorityValidationStatus.run('approved', req.user.id, null, validationId);

    const updatedAppt = queries.getAppointmentById.get(appointment.id);

    // SSE Broadcast
    publishToDoctor(appointment.doctor_id, { type: 'priority-approved', appointmentId: appointment.id, appointment: updatedAppt });
    publishToPatient(appointment.patient_id, { type: 'priority-approved', appointmentId: appointment.id, appointment: updatedAppt });
    publishToAllAdmins({ type: 'priority-approved', appointmentId: appointment.id, appointment: updatedAppt });

    res.json({ success: true, message: 'Priority recommendation approved', appointment: updatedAppt });
  } catch (error) {
    console.error('Approve priority error:', error);
    res.status(500).json({ error: 'Failed to approve priority' });
  }
});

// Clinician Override Priority
router.post('/validation/:id/override', authorizeRoles('doctor', 'admin'), (req, res) => {
  try {
    const validationId = parseInt(req.params.id);
    const { override_priority, reason } = req.body;

    const overrideLevel = parseInt(override_priority);
    if (!overrideLevel || overrideLevel < 1 || overrideLevel > 5) {
      return res.status(400).json({ error: 'override_priority must be an integer between 1 and 5' });
    }

    const validation = getDatabase().prepare('SELECT * FROM priority_validations WHERE id = ?').get(validationId);

    if (!validation) {
      return res.status(404).json({ error: 'Priority validation record not found' });
    }

    const appointment = queries.getAppointmentById.get(validation.appointment_id);
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    const newScore = computePriorityScore({
      priority_level: overrideLevel,
      bookedAt: appointment.created_at,
      queueNumber: appointment.queue_number
    });
    const meta = getPriorityMeta(overrideLevel);
    const reasonText = `Clinician Override (${meta.name}): ${reason || 'Manual clinician decision'}`;

    // Update appointment
    queries.updateAppointmentPriority.run(overrideLevel, newScore, reasonText, appointment.id);

    // Update validation audit record
    queries.updatePriorityValidationStatus.run('overridden', req.user.id, overrideLevel, validationId);

    const updatedAppt = queries.getAppointmentById.get(appointment.id);

    // SSE Broadcast
    publishToDoctor(appointment.doctor_id, { type: 'priority-overridden', appointmentId: appointment.id, appointment: updatedAppt });
    publishToPatient(appointment.patient_id, { type: 'priority-overridden', appointmentId: appointment.id, appointment: updatedAppt });
    publishToAllAdmins({ type: 'priority-overridden', appointmentId: appointment.id, appointment: updatedAppt });

    res.json({ success: true, message: 'Priority overridden by clinician', appointment: updatedAppt });
  } catch (error) {
    console.error('Override priority error:', error);
    res.status(500).json({ error: 'Failed to override priority' });
  }
});

module.exports = router;
