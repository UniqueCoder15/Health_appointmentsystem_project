const express = require('express');
const crypto = require('crypto');
const { queries, getDatabase } = require('../database/db');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { publishToDoctor, publishToAppointment, publishToAllAdmins, publishToPatient } = require('../lib/sseManager');

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Emergency detection keywords
const EMERGENCY_KEYWORDS = [
  'chest pain', 'difficulty breathing', 'shortness of breath', 'cannot breathe',
  'severe bleeding', 'unconscious', 'unresponsive', 'stroke', 'heart attack',
  'suicidal', 'suicide', 'overdose', 'seizure', 'convulsion',
  'severe abdominal pain', 'coughing blood', 'vomiting blood',
  'sudden weakness', 'numbness', 'slurred speech', 'vision loss',
  'severe headache', 'worst headache', 'thunderclap headache'
];

// Chatbot question flow
const QUESTION_FLOW = [
  {
    id: 'chief_complaint',
    question: 'What is your main health concern or symptom today?',
    type: 'text',
    required: true
  },
  {
    id: 'body_system',
    question: 'Which area of your body is affected?',
    type: 'select',
    options: [
      { value: 'head', label: 'Head / Brain' },
      { value: 'chest', label: 'Chest / Heart' },
      { value: 'abdomen', label: 'Abdomen / Stomach' },
      { value: 'back', label: 'Back / Spine' },
      { value: 'limbs', label: 'Arms / Legs / Joints' },
      { value: 'skin', label: 'Skin / Hair / Nails' },
      { value: 'mental', label: 'Mental Health / Mood' },
      { value: 'general', label: 'General / Whole Body' },
      { value: 'other', label: 'Other' }
    ],
    required: true
  },
  {
    id: 'specific_symptoms',
    question: 'Please describe your specific symptoms in detail (e.g., type of pain, duration, triggers):',
    type: 'textarea',
    required: true
  },
  {
    id: 'severity',
    question: 'On a scale of 1-10, how severe is your discomfort? (1 = mild, 10 = worst imaginable)',
    type: 'number',
    min: 1,
    max: 10,
    required: true
  },
  {
    id: 'duration',
    question: 'How long have you been experiencing these symptoms?',
    type: 'select',
    options: [
      { value: 'minutes', label: 'Minutes to hours' },
      { value: 'hours', label: 'Hours' },
      { value: 'days', label: '1-3 days' },
      { value: 'week', label: '4-7 days' },
      { value: 'weeks', label: '1-4 weeks' },
      { value: 'months', label: 'More than a month' }
    ],
    required: true
  },
  {
    id: 'associated',
    question: 'Are you experiencing any of these associated symptoms? (Select all that apply)',
    type: 'multiselect',
    options: [
      { value: 'fever', label: 'Fever / Chills' },
      { value: 'nausea', label: 'Nausea / Vomiting' },
      { value: 'dizziness', label: 'Dizziness / Fainting' },
      { value: 'sweating', label: 'Excessive Sweating' },
      { value: 'palpitations', label: 'Heart Palpitations' },
      { value: 'swelling', label: 'Swelling / Edema' },
      { value: 'rash', label: 'Rash / Skin Changes' },
      { value: 'weight_change', label: 'Unexplained Weight Loss/Gain' },
      { value: 'fatigue', label: 'Fatigue / Weakness' },
      { value: 'appetite_change', label: 'Appetite Changes' },
      { value: 'none', label: 'None of the above' }
    ],
    required: false
  },
  {
    id: 'medications',
    question: 'Are you currently taking any medications?',
    type: 'text',
    required: false
  },
  {
    id: 'allergies',
    question: 'Do you have any known allergies?',
    type: 'text',
    required: false
  },
  {
    id: 'past_history',
    question: 'Do you have any relevant past medical history or surgeries?',
    type: 'textarea',
    required: false
  }
];

// Helper: Check for emergency keywords
function checkEmergency(text) {
  const lowerText = text.toLowerCase();
  for (const keyword of EMERGENCY_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      return { emergency: true, keyword };
    }
  }
  return { emergency: false };
}

// Helper: Determine recommended specialty based on symptoms
function recommendSpecialty(bodySystem, symptoms) {
  const specialtyMap = {
    'head': 'Neurology',
    'chest': 'Cardiology',
    'abdomen': 'General Medicine',
    'back': 'Orthopedics',
    'limbs': 'Orthopedics',
    'skin': 'Dermatology',
    'mental': 'Psychiatry',
    'general': 'General Medicine'
  };
  return specialtyMap[bodySystem] || 'General Medicine';
}

// Helper: Determine urgency level
function determineUrgency(severity, emergencyFlag, duration) {
  if (emergencyFlag) return 'emergency';
  if (severity >= 8) return 'urgent';
  if (severity >= 5) return 'urgent';
  if (duration === 'minutes' || duration === 'hours') return 'urgent';
  return 'routine';
}

// Start a new symptom assessment session
router.post('/start', (req, res) => {
  try {
    const user = req.user;
    const { appointment_id } = req.body;

    // Only patients can start assessments for themselves
    if (user.role !== 'patient') {
      return res.status(403).json({ error: 'Only patients can start symptom assessments' });
    }

    // Validate appointment if provided
    let appointmentId = null;
    if (appointment_id) {
      const appointment = queries.getAppointmentById.get(parseInt(appointment_id));
      if (!appointment || appointment.patient_id !== user.id) {
        return res.status(403).json({ error: 'Invalid appointment' });
      }
      appointmentId = appointment.id;
    }

    const sessionId = crypto.randomUUID();

    // Create assessment record
    const result = queries.createSymptomAssessment.run(
      user.id,
      appointmentId,
      sessionId,
      null, // chief_complaint
      null, // symptoms_json
      null, // severity_score
      'routine', // urgency_level
      0, // emergency_flag
      null, // emergency_reason
      null, // summary_for_doctor
      'in_progress'
    );

    const assessment = queries.getSymptomAssessmentById.get(result.lastInsertRowid);

    // Return first question
    const firstQuestion = QUESTION_FLOW[0];

    publishToPatient(user.id, { type: 'symptom-assessment-started', assessment, currentQuestion: firstQuestion });

    res.status(201).json({
      message: 'Symptom assessment started',
      assessment,
      currentQuestion: firstQuestion,
      questionIndex: 0,
      totalQuestions: QUESTION_FLOW.length
    });
  } catch (error) {
    console.error('Start symptom assessment error:', error);
    res.status(500).json({ error: 'Failed to start symptom assessment' });
  }
});

// Submit answer and get next question
router.post('/:sessionId/answer', (req, res) => {
  try {
    const user = req.user;
    const { sessionId } = req.params;
    const { answer, questionId } = req.body;

    const assessment = queries.getSymptomAssessmentBySessionId.get(sessionId);
    if (!assessment) {
      return res.status(404).json({ error: 'Assessment session not found' });
    }

    // Authorization
    if (assessment.patient_id !== user.id && user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (assessment.status !== 'in_progress') {
      return res.status(400).json({ error: 'Assessment already completed or abandoned' });
    }

    // Find current question index
    let questionIndex = QUESTION_FLOW.findIndex(q => q.id === questionId);
    if (questionIndex === -1) questionIndex = 0;

    // Store answer
    let symptoms = [];
    try {
      symptoms = JSON.parse(assessment.symptoms_json || '[]');
    } catch (e) {
      symptoms = [];
    }

    symptoms.push({ questionId, answer, timestamp: new Date().toISOString() });

    // Check for emergency keywords in text answers
    let emergencyFlag = assessment.emergency_flag;
    let emergencyReason = assessment.emergency_reason;
    if (typeof answer === 'string') {
      const emergencyCheck = checkEmergency(answer);
      if (emergencyCheck.emergency) {
        emergencyFlag = 1;
        emergencyReason = `Emergency keyword detected: "${emergencyCheck.keyword}"`;
      }
    }

    // Update assessment with accumulated data
    const updates = {
      symptoms_json: JSON.stringify(symptoms)
    };

    // Update specific fields based on question
    if (questionId === 'chief_complaint') {
      updates.chief_complaint = answer;
    } else if (questionId === 'severity') {
      updates.severity_score = parseInt(answer);
    } else if (questionId === 'duration') {
      updates.duration = answer; // We'll store in symptoms_json
    }

    if (emergencyFlag) {
      updates.emergency_flag = 1;
      updates.emergency_reason = emergencyReason;
    }

    // Build dynamic update query
    const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), assessment.id];
    getDatabase().prepare(`UPDATE symptom_assessments SET ${setClause} WHERE id = ?`).run(...values);

    // Get next question
    const nextIndex = questionIndex + 1;
    if (nextIndex < QUESTION_FLOW.length) {
      const nextQuestion = QUESTION_FLOW[nextIndex];
      const updatedAssessment = queries.getSymptomAssessmentById.get(assessment.id);

      publishToPatient(user.id, { type: 'symptom-assessment-progress', assessment: updatedAssessment, currentQuestion: nextQuestion, questionIndex: nextIndex });

      return res.json({
        assessment: updatedAssessment,
        currentQuestion: nextQuestion,
        questionIndex: nextIndex,
        totalQuestions: QUESTION_FLOW.length,
        isComplete: false
      });
    } else {
      // Assessment complete - generate summary
      return completeAssessment(assessment.id, user, res);
    }
  } catch (error) {
    console.error('Submit symptom answer error:', error);
    res.status(500).json({ error: 'Failed to process answer' });
  }
});

// Complete assessment and generate summary
function completeAssessment(assessmentId, user, res) {
  try {
    const assessment = queries.getSymptomAssessmentById.get(assessmentId);
    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    const symptoms = JSON.parse(assessment.symptoms_json || '[]');
    const symptomMap = {};
    symptoms.forEach(s => { symptomMap[s.questionId] = s.answer; });

    const severity = assessment.severity_score || symptomMap.severity || 5;
    const bodySystem = symptomMap.body_system || 'general';
    const chiefComplaint = assessment.chief_complaint || symptomMap.chief_complaint || 'Symptom assessment';
    const duration = symptomMap.duration || 'unknown';
    const associated = symptomMap.associated || [];
    const medications = symptomMap.medications || '';
    const allergies = symptomMap.allergies || '';
    const pastHistory = symptomMap.past_history || '';

    // Determine urgency
    const urgencyLevel = determineUrgency(severity, assessment.emergency_flag, duration);

    // Build summary for doctor
    let summary = `**Chief Complaint:** ${chiefComplaint}\n\n`;
    summary += `**Body System:** ${bodySystem}\n`;
    summary += `**Severity:** ${severity}/10\n`;
    summary += `**Duration:** ${duration}\n`;
    summary += `**Urgency Level:** ${urgencyLevel.toUpperCase()}\n`;
    if (assessment.emergency_flag) {
      summary += `**⚠️ EMERGENCY FLAG:** ${assessment.emergency_reason}\n`;
    }
    summary += `\n**Symptoms:** ${symptomMap.specific_symptoms || 'Not specified'}\n`;
    if (associated.length > 0 && !associated.includes('none')) {
      summary += `\n**Associated Symptoms:** ${associated.join(', ')}\n`;
    }
    if (medications) summary += `\n**Current Medications:** ${medications}\n`;
    if (allergies) summary += `\n**Allergies:** ${allergies}\n`;
    if (pastHistory) summary += `\n**Past Medical History:** ${pastHistory}\n`;
    summary += `\n**Recommended Specialty:** ${recommendSpecialty(bodySystem, symptoms)}\n`;
    summary += `\n*This is an AI-assisted symptom summary for clinical reference only. Not a diagnosis.*`;

    // Update assessment
    queries.updateSymptomAssessment.run(
      assessment.chief_complaint,
      assessment.symptoms_json,
      severity,
      urgencyLevel,
      assessment.emergency_flag,
      assessment.emergency_reason,
      summary,
      'completed',
      'completed',
      assessment.id
    );

    const completedAssessment = queries.getSymptomAssessmentById.get(assessmentId);

    // SSE notifications
    const patient = queries.findUserById.get(assessment.patient_id);
    publishToPatient(assessment.patient_id, { type: 'symptom-assessment-completed', assessment: completedAssessment });
    if (assessment.appointment_id) {
      publishToAppointment(assessment.appointment_id, { type: 'symptom-assessment-completed', assessment: completedAssessment });
      const appointment = queries.getAppointmentById.get(assessment.appointment_id);
      if (appointment) {
        publishToDoctor(appointment.doctor_id, { type: 'symptom-assessment-completed', assessment: completedAssessment });
      }
    }
    publishToAllAdmins({ type: 'symptom-assessment-completed', assessment: completedAssessment, userName: patient?.full_name || 'Unknown' });

    // Return completion with emergency guidance if flagged
    const response = {
      message: 'Symptom assessment completed',
      assessment: completedAssessment,
      summary,
      isComplete: true,
      emergencyGuidance: assessment.emergency_flag ? {
        message: 'Based on your responses, this may require urgent medical attention.',
        recommendation: 'Please seek immediate care at the nearest emergency department or call emergency services (112/108 in India).',
        disclaimer: 'This is not a medical diagnosis. Always consult a healthcare professional for proper evaluation.'
      } : null
    };

    res.json(response);
  } catch (error) {
    console.error('Complete assessment error:', error);
    res.status(500).json({ error: 'Failed to complete assessment' });
  }
}

// Manually complete assessment
router.post('/:sessionId/complete', (req, res) => {
  const { sessionId } = req.params;
  const assessment = queries.getSymptomAssessmentBySessionId.get(sessionId);
  if (!assessment) {
    return res.status(404).json({ error: 'Assessment not found' });
  }
  completeAssessment(assessment.id, req.user, res);
});

// Get assessment by session ID
router.get('/:sessionId', (req, res) => {
  try {
    const user = req.user;
    const { sessionId } = req.params;

    const assessment = queries.getSymptomAssessmentBySessionId.get(sessionId);
    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    // Authorization
    if (user.role === 'patient' && assessment.patient_id !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (user.role === 'doctor') {
      const doctorProfile = queries.getDoctorByUserId.get(user.id);
      if (!doctorProfile) {
        return res.status(403).json({ error: 'Doctor profile not found' });
      }
      const hasAppointment = getDatabase().prepare(`
        SELECT 1 FROM appointments WHERE doctor_id = ? AND patient_id = ? LIMIT 1
      `).get(doctorProfile.id, assessment.patient_id);
      if (!hasAppointment) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Determine current question if in progress
    let currentQuestion = null;
    let questionIndex = 0;
    if (assessment.status === 'in_progress') {
      const symptoms = JSON.parse(assessment.symptoms_json || '[]');
      questionIndex = symptoms.length;
      if (questionIndex < QUESTION_FLOW.length) {
        currentQuestion = QUESTION_FLOW[questionIndex];
      }
    }

    res.json({
      assessment,
      currentQuestion,
      questionIndex,
      totalQuestions: QUESTION_FLOW.length
    });
  } catch (error) {
    console.error('Get assessment error:', error);
    res.status(500).json({ error: 'Failed to fetch assessment' });
  }
});

// Get all assessments for a patient (doctor/admin access)
router.get('/patient/:patientId', (req, res) => {
  try {
    const user = req.user;
    const patientId = parseInt(req.params.patientId);

    // Authorization
    if (user.role === 'patient' && user.id !== patientId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (user.role === 'doctor') {
      const doctorProfile = queries.getDoctorByUserId.get(user.id);
      if (!doctorProfile) {
        return res.status(403).json({ error: 'Doctor profile not found' });
      }
      const hasAppointment = getDatabase().prepare(`
        SELECT 1 FROM appointments WHERE doctor_id = ? AND patient_id = ? LIMIT 1
      `).get(doctorProfile.id, patientId);
      if (!hasAppointment) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const assessments = queries.getSymptomAssessmentsByPatient.all(patientId);
    res.json({ assessments });
  } catch (error) {
    console.error('Get patient assessments error:', error);
    res.status(500).json({ error: 'Failed to fetch assessments' });
  }
});

// Get assessments for an appointment
router.get('/appointment/:appointmentId', (req, res) => {
  try {
    const user = req.user;
    const appointmentId = parseInt(req.params.appointmentId);

    const appointment = queries.getAppointmentById.get(appointmentId);
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    // Authorization
    if (user.role === 'patient' && appointment.patient_id !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (user.role === 'doctor') {
      const doctorProfile = queries.getDoctorByUserId.get(user.id);
      if (!doctorProfile || appointment.doctor_id !== doctorProfile.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const assessments = queries.getSymptomAssessmentsByAppointment.all(appointmentId);
    res.json({ assessments });
  } catch (error) {
    console.error('Get appointment assessments error:', error);
    res.status(500).json({ error: 'Failed to fetch assessments' });
  }
});

// Admin: Get all assessments
router.get('/admin/all', authorizeRoles('admin'), (req, res) => {
  try {
    const db = getDatabase();
    const assessments = db.prepare(`
      SELECT sa.*, p.full_name as patient_name, p.email as patient_email
      FROM symptom_assessments sa
      JOIN users p ON sa.patient_id = p.id
      ORDER BY sa.started_at DESC
    `).all();
    res.json({ assessments });
  } catch (error) {
    console.error('Admin get all assessments error:', error);
    res.status(500).json({ error: 'Failed to fetch assessments' });
  }
});

module.exports = router;