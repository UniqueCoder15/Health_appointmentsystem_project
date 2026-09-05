const express = require('express');
const { queries, getDatabase } = require('../database/db');
const { authenticateToken, authenticateTokenOrQuery } = require('../middleware/auth');
const { publishToPatient } = require('../lib/sseManager');
const { GoogleGenAI } = require('@google/genai');

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Emergency keywords for safety detection
const EMERGENCY_KEYWORDS = [
  'chest pain', 'difficulty breathing', 'shortness of breath', 'cannot breathe',
  'severe bleeding', 'unconscious', 'unresponsive', 'stroke', 'heart attack',
  'suicidal', 'suicide', 'overdose', 'seizure', 'convulsion',
  'severe abdominal pain', 'coughing blood', 'vomiting blood',
  'sudden weakness', 'numbness', 'slurred speech', 'vision loss',
  'severe headache', 'worst headache', 'thunderclap headache'
];

// System prompt for healthcare AI
function buildSystemPrompt(user) {
  const currentDate = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return `You are Swasthya Saarthi's AI Health Assistant — a helpful, empathetic guide for patients navigating their healthcare journey on the Swasthya Saarthi Smart Healthcare & Priority Queue Platform.

IMPORTANT SAFETY RULES:
1. You are NOT a doctor and do NOT provide medical diagnoses or prescribe medications.
2. For ANY emergency or severe symptoms (e.g. severe chest pain, inability to breathe, stroke signs), ALWAYS advise immediate emergency care: "Please call 112/108 (India Emergency) or visit the nearest emergency room immediately."
3. Always encourage patients to consult qualified healthcare professionals.
4. Be clear, concise, and structured (use bullet points and bold headers for readability).

YOUR CAPABILITIES & SWASTHYA SAARTHI PLATFORM FEATURES:
- Answer health questions, symptom explanations, and clarify medical terminology.
- Guide patients to appropriate medical specialties available on Swasthya Saarthi (Cardiology, Neurology, Orthopedics, Pediatrics, Dermatology, Pulmonology, General Medicine, Psychiatry, Ophthalmology, ENT).
- Explain Swasthya Saarthi platform features:
  - Real-time priority queue tracking and estimated wait times
  - Appointment booking with specialists
  - ABHA ID integration (14-digit Ayushman Bharat Health Account)
  - Symptom Checker tool for organizing doctor visit details
  - Uploading and viewing medical reports (PDF, images)
- Help organize symptoms before a doctor appointment.

PATIENT CONTEXT:
- Name: ${user.full_name || 'Patient'}
- Role: ${user.role || 'patient'}
- Date: ${currentDate}
- ABHA ID: ${user.abha_id || 'Not linked'}

ALWAYS END HEALTH-RELATED ADVICE WITH THIS DISCLAIMER:
"⚠️ I am an AI assistant, not a doctor. This information is for educational purposes only. Please consult a healthcare professional for medical advice, diagnosis, or treatment."
`;
}

// Check for emergency keywords in user message
function checkEmergency(message) {
  const lowerMessage = message.toLowerCase();
  for (const keyword of EMERGENCY_KEYWORDS) {
    if (lowerMessage.includes(keyword)) {
      return { emergency: true, keyword };
    }
  }
  return { emergency: false };
}

// Intelligent rule-based fallback response engine
function generateRuleBasedResponse(userMessage, user) {
  const lowerMsg = userMessage.toLowerCase().trim();

  // 1. Doctor & Appointment / Queue Lookup
  if (lowerMsg.includes('appointment') || lowerMsg.includes('queue') || lowerMsg.includes('booking') || lowerMsg.includes('slot') || lowerMsg.includes('wait') || lowerMsg.includes('doctor') || lowerMsg.includes('dr.')) {
    let matchedDoc = '';
    if (lowerMsg.includes('patel') || lowerMsg.includes('rajesh')) matchedDoc = 'Dr. Rajesh Patel (Orthopedics)';
    else if (lowerMsg.includes('sharma')) matchedDoc = 'Dr. Anita Sharma (Cardiology)';
    else if (lowerMsg.includes('verma')) matchedDoc = 'Dr. Vikram Verma (Neurology)';

    return {
      response: `### 📅 Appointment & Queue Assistance

${matchedDoc ? `**Doctor Reference**: ${matchedDoc}\n` : ''}
To manage your appointments or check your live queue status on Swasthya Saarthi:

1. **Live Queue Tracking**: Go to **Queue Tracking** in your dashboard to view your exact token position, estimated wait time, and room number.
2. **Book Appointment**: Click **Book Appointment** to select a doctor by specialty, view open calendar slots, and confirm your visit.
3. **Clinical Priority Queue**: Our smart triage system automatically prioritizes urgent cases based on clinical severity.

Do you need help navigating to a specific doctor or managing an upcoming booking?

---
⚠️ I am an AI assistant, not a doctor. For urgent health matters, please consult your clinic staff directly.`,
      emergency: false
    };
  }

  // 2. Specialty & Department Guidance
  if (lowerMsg.includes('specialist') || lowerMsg.includes('specialty') || lowerMsg.includes('which doctor') || lowerMsg.includes('what kind of doctor') || lowerMsg.includes('department')) {
    return {
      response: `### 🩺 Specialist Referral Guidance

Based on your query, here is how Swasthya Saarthi departments match common conditions:

- **🩺 Cardiology**: High BP, chest tightness, palpitations, heart health
- **🧠 Neurology**: Chronic headaches, migraines, numbness, nerve pain
- **🦴 Orthopedics**: Joint pain, bone injuries, arthritis, back/neck stiffness
- **👶 Pediatrics**: Infant & child health, vaccinations, growth milestones
- **🔬 Dermatology**: Skin rashes, acne, eczema, hair loss, skin lesions
- **🫁 Pulmonology**: Persistent cough, asthma, shortness of breath
- **🩺 General Medicine**: Fever, general fatigue, viral infections, multi-symptom evaluations
- **🧠 Psychiatry**: Anxiety, depression, sleep disorders, stress management
- **👁️ Ophthalmology**: Vision changes, eye strain, red eye, infections
- **👂 ENT**: Ear pain, sinus congestion, sore throat, tinnitus

*You can book a direct consultation with any of these specialists from your **Book Appointment** tab.*

---
⚠️ I am an AI assistant, not a doctor. This guidance is for reference only.`,
      emergency: false
    };
  }

  // 3. Symptoms, Body Parts & Triage (stomach, head, joint, fever, skin, eye, etc.)
  const symptomKeywords = ['symptom', 'pain', 'ache', 'fever', 'cough', 'headache', 'stomach', 'back', 'joint', 'skin', 'eye', 'throat', 'nausea', 'vomit', 'dizzy', 'fatigue', 'tired', 'swelling', 'infection', 'cold', 'flu', 'bp', 'sugar', 'blood pressure'];
  if (symptomKeywords.some(kw => lowerMsg.includes(kw))) {
    // Extract main symptom highlight
    let symptomCategory = 'General Symptoms';
    if (lowerMsg.includes('stomach') || lowerMsg.includes('abdomen') || lowerMsg.includes('acidity') || lowerMsg.includes('nausea')) symptomCategory = 'Gastrointestinal / Abdominal Concerns';
    else if (lowerMsg.includes('head') || lowerMsg.includes('headache') || lowerMsg.includes('migraine')) symptomCategory = 'Neurological / Headache Concerns';
    else if (lowerMsg.includes('joint') || lowerMsg.includes('back') || lowerMsg.includes('knee') || lowerMsg.includes('bone')) symptomCategory = 'Musculoskeletal / Joint Concerns';
    else if (lowerMsg.includes('skin') || lowerMsg.includes('rash') || lowerMsg.includes('itching')) symptomCategory = 'Dermatological / Skin Concerns';
    else if (lowerMsg.includes('eye') || lowerMsg.includes('vision')) symptomCategory = 'Ophthalmic / Eye Concerns';
    else if (lowerMsg.includes('throat') || lowerMsg.includes('cough') || lowerMsg.includes('cold') || lowerMsg.includes('fever')) symptomCategory = 'ENT / Respiratory Concerns';

    return {
      response: `### 📝 Symptom Assessment Guidance: ${symptomCategory}

Thank you for providing your symptom details ("${userMessage}").

**Key Details to Note for Your Doctor:**
- **Duration**: How many hours or days have you felt this?
- **Severity**: Is the intensity mild, moderate, or severe (1-10)?
- **Triggers**: Does eating, moving, or resting make it better or worse?
- **Associated Symptoms**: Any fever, chills, dizziness, or weakness?

**Next Steps on Swasthya Saarthi:**
1. Open the **Symptom Checker** tool in your patient portal to complete a guided clinical summary.
2. The summary will automatically be attached to your appointment record so your doctor has complete context before your visit.

---
⚠️ I am an AI assistant, not a doctor. Please consult a qualified physician for an accurate medical diagnosis.`,
      emergency: false
    };
  }

  // 4. Lab Tests, Reports & Medical Terms (HbA1c, CBC, Blood test, MRI, CT, X-ray, Biopsy, etc.)
  if (lowerMsg.includes('test') || lowerMsg.includes('report') || lowerMsg.includes('hba1c') || lowerMsg.includes('cbc') || lowerMsg.includes('mri') || lowerMsg.includes('ct') || lowerMsg.includes('x-ray') || lowerMsg.includes('xray') || lowerMsg.includes('biopsy') || lowerMsg.includes('sugar') || lowerMsg.includes('thyroid') || lowerMsg.includes('what is') || lowerMsg.includes('meaning') || lowerMsg.includes('explain')) {
    return {
      response: `### 🔬 Medical Terms & Diagnostic Reports

**Common Clinical Terms Explained:**
- **HbA1c**: Reflects average blood glucose over the past 2-3 months (Normal: <5.7%, Prediabetes: 5.7-6.4%, Diabetes: ≥6.5%).
- **CBC (Complete Blood Count)**: Evaluates red blood cells (anemia), white blood cells (infection), and platelets (clotting).
- **Lipid Profile**: Measures cholesterol (LDL, HDL) and triglycerides for cardiovascular risk assessment.
- **LFT / KFT**: Liver and Kidney function panel screening.
- **MRI / CT / X-Ray**: Medical imaging used to examine internal organs, soft tissues, and bone structures.

**Managing Reports on Swasthya Saarthi:**
- Navigate to **My Reports** in your dashboard to securely upload, organize, and view PDF or image lab results.

---
⚠️ I am an AI assistant, not a doctor. Always review diagnostic report results directly with your ordering physician.`,
      emergency: false
    };
  }

  // 5. Wellness, Diet, Lifestyle & Prevention
  if (lowerMsg.includes('diet') || lowerMsg.includes('exercise') || lowerMsg.includes('sleep') || lowerMsg.includes('wellness') || lowerMsg.includes('healthy') || lowerMsg.includes('weight') || lowerMsg.includes('water') || lowerMsg.includes('nutrition')) {
    return {
      response: `### 🥗 Health & Wellness Recommendations

**Core Pillars of Health:**
- **Hydration**: Drink 2.5–3 liters of water daily.
- **Balanced Nutrition**: Focus on whole foods, fiber, fresh vegetables, lean protein, and reduced refined sugars.
- **Physical Activity**: Aim for 150 minutes of moderate aerobic exercise (brisk walking, cycling) per week.
- **Rest & Sleep**: Prioritize 7-9 hours of restful sleep every night for cellular repair and mental clarity.
- **Routine Screenings**: Undergo annual health checkups and blood screenings as advised by your GP.

---
⚠️ I am an AI assistant, not a doctor. Consult a registered dietitian or doctor for personalized health plans.`,
      emergency: false
    };
  }

  // 6. Platform Features & ABHA ID
  if (lowerMsg.includes('abha') || lowerMsg.includes('how to') || lowerMsg.includes('how do i') || lowerMsg.includes('help') || lowerMsg.includes('portal') || lowerMsg.includes('feature')) {
    return {
      response: `### 🏥 Swasthya Saarthi Platform Guide

**Key Features Available to You:**
- 📊 **Priority Queue Tracking**: Real-time position tracking with live room notifications.
- 📅 **Easy Booking**: Search specialists and pick convenient appointment slots.
- 🆔 **ABHA Integration**: Link your 14-digit Ayushman Bharat Health Account under **Profile** for unified health records.
- 📋 **Symptom Checker**: Pre-appointment structured questionnaire to assist your doctor.
- 📁 **Medical Records**: Upload and store blood test reports, prescriptions, and scans under **My Reports**.

How can I help you further with your healthcare account?

---
⚠️ I am an AI assistant. For technical support, please contact clinic administration.`,
      emergency: false
    };
  }

  // 7. Dynamic Tailored Response for Any Other Query
  const cleanTopic = userMessage.length > 50 ? userMessage.substring(0, 47) + '...' : userMessage;

  return {
    response: `### 🩺 Information Regarding: "${cleanTopic}"

Thank you for your inquiry regarding **"${cleanTopic}"**.

As your **Swasthya Saarthi Health Assistant**, I can assist you with:
- **Clinical Triage & Symptoms**: Detail your symptoms so we can help you prepare for a doctor visit.
- **Specialist Referrals**: Guidance on selecting between Cardiology, Neurology, Orthopedics, Pediatrics, Dermatology, Pulmonology, and General Medicine.
- **Swasthya Saarthi Services**: Queue token tracking, appointment scheduling, report uploads, and ABHA ID linking.

Please let me know if you would like specific guidance on any of the above topics!

---
⚠️ I am an AI assistant, not a doctor. This information is for educational purposes only. Please consult a healthcare professional for medical advice, diagnosis, or treatment.`,
    emergency: false
  };
}

// Generate AI response (using Gemini API if GEMINI_API_KEY is present, else rule-based)
async function generateAIResponse(userMessage, user, conversationHistory = []) {
  const emergencyCheck = checkEmergency(userMessage);

  // If emergency detected, return immediate safety response
  if (emergencyCheck.emergency) {
    return {
      response: `🚨 **This sounds like it could be a medical emergency.**

Based on what you've mentioned ("${emergencyCheck.keyword}"), I strongly advise you to:
- **Call emergency services immediately: 112 or 108 (India)**
- **Go to the nearest emergency department**
- **Do not wait for an appointment**

Your safety is the priority. Please seek immediate professional medical care.

---
⚠️ I am an AI assistant, not a doctor. This is not medical advice. For emergencies, always contact emergency services or visit the nearest ER.`,
      emergency: true
    };
  }

  // Try Gemini API if key is available
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey && apiKey.trim()) {
    try {
      const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
      const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

      // Format conversation history into Gemini format
      const contents = [];
      if (Array.isArray(conversationHistory)) {
        for (const msg of conversationHistory) {
          const role = (msg.role === 'user') ? 'user' : 'model';
          const text = msg.content || msg.text || '';
          if (text) {
            contents.push({ role, parts: [{ text }] });
          }
        }
      }

      // Append current user message
      contents.push({ role: 'user', parts: [{ text: userMessage }] });

      const response = await ai.models.generateContent({
        model: modelName,
        contents,
        config: {
          systemInstruction: buildSystemPrompt(user),
          temperature: 0.7
        }
      });

      if (response && response.text) {
        let textResponse = response.text.trim();

        // Ensure health disclaimer is present
        const disclaimer = "⚠️ I am an AI assistant, not a doctor. This information is for educational purposes only. Please consult a healthcare professional for medical advice, diagnosis, or treatment.";
        if (!textResponse.includes("⚠️ I am an AI assistant")) {
          textResponse += `\n\n---\n${disclaimer}`;
        }

        return {
          response: textResponse,
          emergency: false,
          provider: 'gemini'
        };
      }
    } catch (geminiError) {
      console.warn('Gemini API call error (falling back to rule engine):', geminiError.message || geminiError);
    }
  }

  // Fallback to rule engine
  const fallbackResult = generateRuleBasedResponse(userMessage, user);
  fallbackResult.provider = 'rule_engine';
  return fallbackResult;
}

// POST /api/chatbot/message - Send message to chatbot
router.post('/message', async (req, res) => {
  try {
    const user = req.user;
    const { message, conversationHistory = [] } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Generate AI response
    const result = await generateAIResponse(message.trim(), user, conversationHistory);

    // Log conversation
    console.log(`Chatbot [${user.id}] (${result.provider || 'default'}): User: "${message.substring(0, 50)}..." | Emergency: ${result.emergency}`);

    res.json({
      response: result.response,
      emergency: result.emergency,
      provider: result.provider || 'default',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Chatbot error:', error);
    res.status(500).json({
      error: 'Failed to get response',
      response: 'I\'m having trouble connecting right now. Please try again in a moment, or contact support if the issue persists.'
    });
  }
});

// GET /api/chatbot/history - Get conversation history (placeholder for future)
router.get('/history', (req, res) => {
  res.json({ messages: [] });
});

// POST /api/chatbot/clear - Clear conversation history (placeholder)
router.post('/clear', (req, res) => {
  res.json({ message: 'Conversation cleared (client-side only in prototype)' });
});

module.exports = router;