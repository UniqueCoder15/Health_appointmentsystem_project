const express = require('express');
const { queries, getDatabase } = require('../database/db');
const { authenticateToken, authenticateTokenOrQuery } = require('../middleware/auth');
const { publishToPatient } = require('../lib/sseManager');

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

  return `You are Swasthya Saarthi's AI Health Assistant — a helpful, empathetic guide for patients navigating their healthcare journey.

IMPORTANT SAFETY RULES:
1. You are NOT a doctor and do NOT provide medical diagnoses.
2. For ANY emergency or severe symptoms, ALWAYS advise: "This sounds serious. Please seek immediate medical attention at the nearest emergency department or call 112/108 (India emergency services)."
3. Never prescribe medication or suggest specific treatments.
4. Encourage patients to consult qualified healthcare professionals for proper evaluation.
5. Be clear about your limitations as an AI assistant.

YOUR CAPABILITIES:
- Answer general health questions and explain medical terms
- Help patients understand their appointment/queue status (if they provide context)
- Guide patients to appropriate specialties based on symptoms described
- Explain how to use Swasthya Saarthi platform features
- Provide general wellness and preventive care information
- Help organize symptoms for doctor visits

PATIENT CONTEXT:
- Name: ${user.full_name || 'Patient'}
- Role: ${user.role}
- Date: ${currentDate}
- ABHA ID: ${user.abha_id || 'Not linked'}

RESPONSE STYLE:
- Warm, professional, and empathetic
- Clear and concise (avoid long paragraphs)
- Use bullet points for readability
- Always include the disclaimer for health-related responses
- For appointment/queue questions, ask for their appointment details if needed

DISCLAIMER TO INCLUDE IN HEALTH-RELATED RESPONSES:
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

// Generate AI response (mock for prototype - can integrate with real AI API later)
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

  // For prototype: generate contextual responses based on keywords
  const lowerMsg = userMessage.toLowerCase();

  // Appointment/queue related
  if (lowerMsg.includes('appointment') || lowerMsg.includes('queue') || lowerMsg.includes('booking') || lowerMsg.includes('slot') || lowerMsg.includes('wait')) {
    return {
      response: `I can help with appointment and queue questions!

To give you specific information about your queue position or appointment, I'd need to know:
- Which doctor you're seeing
- Your appointment date/time

**General guidance:**
- **Track your queue**: Use the "Queue Tracking" feature in your dashboard for real-time updates
- **Booking**: Use "Book Appointment" to find available slots with specialists
- **Cancellations**: You can cancel appointments from "My Appointments" tab

**Swasthya Saarthi features:**
- 📊 Real-time queue tracking with estimated wait times
- 🎯 Clinical priority queue (critical patients seen first)
- 🔔 Live notifications for queue updates
- 📅 Easy booking with available time slots

Would you like help with something specific about your appointment?

---
⚠️ I am an AI assistant, not a doctor. For medical concerns, please consult your healthcare provider.`,
      emergency: false
    };
  }

  // Specialty guidance
  if (lowerMsg.includes('specialist') || lowerMsg.includes('specialty') || lowerMsg.includes('which doctor') || lowerMsg.includes('what kind of doctor')) {
    return {
      response: `I can help guide you to the right specialty! Here are the main specialties available on Swasthya Saarthi:

**🩺 Cardiology** — Heart, chest pain, blood pressure, palpitations
**🧠 Neurology** — Headaches, migraines, seizures, numbness, memory issues
**🦴 Orthopedics** — Joint pain, fractures, sports injuries, back/neck pain
**👶 Pediatrics** — Child health, vaccinations, growth concerns
**🔬 Dermatology** — Skin conditions, rashes, acne, hair loss
**🫁 Pulmonology** — Breathing issues, asthma, chronic cough
**🩺 General Medicine** — Fevers, infections, general checkups, multiple symptoms
**🧠 Psychiatry** — Anxiety, depression, sleep issues, mental wellness
**👁️ Ophthalmology** — Eye problems, vision changes, eye pain
**👂 ENT** — Ear infections, sinus issues, throat problems

**To find the best match:**
1. Tell me your main symptoms
2. I'll suggest relevant specialties
3. You can then browse doctors in that specialty

What symptoms are you experiencing?

---
⚠️ I am an AI assistant, not a doctor. This guidance is for reference only. A healthcare professional should determine the appropriate specialty for your condition.`,
      emergency: false
    };
  }

  // Symptom-related (but not emergency)
  if (lowerMsg.includes('symptom') || lowerMsg.includes('pain') || lowerMsg.includes('ache') || lowerMsg.includes('feel') || lowerMsg.includes('sick') || lowerMsg.includes('fever') || lowerMsg.includes('cough') || lowerMsg.includes('headache') || lowerMsg.includes('nausea') || lowerMsg.includes('dizzy') || lowerMsg.includes('tired') || lowerMsg.includes('fatigue')) {
    return {
      response: `Thank you for sharing your symptoms. I can help you organize this information for your doctor visit.

**For your appointment, it's helpful to note:**
1. **Main symptom** — What's bothering you most?
2. **Location** — Where exactly do you feel it?
3. **Severity** — On a scale of 1-10, how bad is it?
4. **Duration** — How long have you had this?
5. **Triggers** — What makes it better or worse?
5. **Associated symptoms** — Fever, nausea, dizziness, etc.
6. **Medications** — Any current medications or allergies?

**Swasthya Saarthi's Symptom Checker** (in your dashboard) guides you through these questions and creates a structured summary for your doctor.

Would you like me to:
- Help you prepare for your doctor visit?
- Explain what a specific symptom might generally indicate (not a diagnosis)?
- Guide you to start a formal symptom assessment?

---
⚠️ I am an AI assistant, not a doctor. Symptoms can have many causes. Please discuss all concerns with your healthcare provider for proper evaluation.`,
      emergency: false
    };
  }

  // Platform help
  if (lowerMsg.includes('how to') || lowerMsg.includes('how do i') || lowerMsg.includes('help') || lowerMsg.includes('use') || lowerMsg.includes('feature') || lowerMsg.includes('portal') || lowerMsg.includes('dashboard')) {
    return {
      response: `I'd be happy to help you use Swasthya Saarthi! Here's a quick guide:

**🏠 Patient Dashboard Tabs:**
- **Dashboard** — Your next appointment, queue position, quick stats
- **My Appointments** — View all past/upcoming appointments
- **Queue Tracking** — Real-time queue position with live updates
- **Notifications** — Appointment confirmations, queue updates
- **My Reports** — Upload/view medical documents (PDF, JPG, PNG)
- **Symptom Checker** — Guided symptom assessment for doctor visits
- **Profile** — Update info, link ABHA ID

**🔑 Key Features:**
- **Booking**: Click "Book Appointment" → Choose specialty → Pick doctor → Select slot → Confirm
- **Queue**: Real-time position, estimated wait, priority level
- **Reports**: Drag-drop upload, organized by type, download anytime
- **ABHA**: Link your 14-digit ABHA ID in Profile for unified health records
- **SSE**: Live updates work automatically when logged in

**💡 Pro Tips:**
- Enable notifications for queue updates
- Use Symptom Checker before appointments
- Link ABHA ID for seamless record sharing

What specific feature would you like help with?

---
⚠️ I am an AI assistant. For medical questions, please consult your doctor.`,
      emergency: false
    };
  }

  // Medical term explanation
  if (lowerMsg.includes('what is') || lowerMsg.includes('what does') || lowerMsg.includes('meaning of') || lowerMsg.includes('define') || lowerMsg.includes('explain')) {
    return {
      response: `I can help explain medical terms! What term would you like me to clarify?

**Common terms patients ask about:**
- **Hypertension** = High blood pressure
- **Tachycardia** = Fast heart rate (>100 bpm)
- **Dyspnea** = Shortness of breath
- **HbA1c** = 3-month average blood sugar (diabetes marker)
- **CBC** = Complete Blood Count (standard blood test)
- **MRI/CT/X-ray** = Different imaging types
- **Biopsy** = Tissue sample for testing
- **Prognosis** = Expected outcome of a condition

Just tell me the term, and I'll explain it in plain language.

---
⚠️ I am an AI assistant, not a doctor. Medical terminology can be complex — always confirm with your healthcare provider.`,
      emergency: false
    };
  }

  // General health/wellness
  if (lowerMsg.includes('healthy') || lowerMsg.includes('diet') || lowerMsg.includes('exercise') || lowerMsg.includes('sleep') || lowerMsg.includes('stress') || lowerMsg.includes('wellness') || lowerMsg.includes('prevent')) {
    return {
      response: `Great question! Here are some general wellness tips:

**🥗 Nutrition:** Eat a balanced diet with fruits, vegetables, whole grains, lean proteins. Stay hydrated.
**🏃 Exercise:** Aim for 150 min/week moderate activity (walking, cycling, swimming).
**😴 Sleep:** 7-9 hours/night. Consistent schedule helps.
**🧘 Stress:** Try deep breathing, meditation, hobbies, or talking to someone.
**🩺 Prevention:** Regular checkups, vaccinations, screenings per your doctor's advice.

**Remember:** Everyone's needs differ based on age, conditions, medications. Your doctor can give personalized guidance.

Would you like information on a specific topic like managing a condition, understanding test results, or preparing for a checkup?

---
⚠️ I am an AI assistant, not a doctor. Wellness advice is general. Consult a healthcare professional for personalized recommendations.`,
      emergency: false
    };
  }

  // Default fallback
  return {
    response: `Hello! I'm your Swasthya Saarthi Health Assistant. 👋

I can help you with:
- **General health questions** & medical term explanations
- **Finding the right specialist** for your symptoms
- **Using Swasthya Saarthi** (booking, queue tracking, reports, etc.)
- **Preparing for doctor visits** (organizing symptoms)
- **Wellness & prevention** tips

**For appointment/queue specifics**, I'll need your appointment details.

**For health concerns**, please remember: I'm an AI assistant, not a doctor. I cannot diagnose or prescribe.

What would you like help with today?

---
⚠️ I am an AI assistant, not a doctor. This information is for educational purposes only. Please consult a healthcare professional for medical advice, diagnosis, or treatment.`,
    emergency: false
  };
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

    // Log conversation (optional - could store in DB)
    console.log(`Chatbot [${user.id}]: User: "${message.substring(0, 50)}..." | Emergency: ${result.emergency}`);

    res.json({
      response: result.response,
      emergency: result.emergency,
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
  // For prototype, we don't persist history server-side
  // Frontend maintains session history in memory
  res.json({ messages: [] });
});

// POST /api/chatbot/clear - Clear conversation history (placeholder)
router.post('/clear', (req, res) => {
  res.json({ message: 'Conversation cleared (client-side only in prototype)' });
});

module.exports = router;