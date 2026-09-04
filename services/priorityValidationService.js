/**
 * Swasthya Saarthi — AI Priority Validation & Clinical Triage Support Service
 * Performs non-diagnostic queue triage validation with adapter pattern, confidence scoring, and fallback.
 */

const { evaluateConditionPriority, computePriorityScore, getPriorityMeta } = require('../lib/priorityEngine');

class AIPriorityAdapter {
  async evaluate(context) {
    throw new Error('Method not implemented');
  }
}

class MockAIPriorityAdapter extends AIPriorityAdapter {
  constructor() {
    super();
    this.modelVersion = 'v1.0-triage-sandbox';
    this.confidenceThreshold = 0.85;
  }

  async evaluate(context) {
    const { symptoms = '', severity = 5, existingPriority = 3, recordCount = 0, patientAge = 30 } = context;
    const text = (symptoms || '').toLowerCase();

    let recPriority = existingPriority;
    let confidence = 0.90;
    let reasonCodes = [];
    let action = 'KEEP';

    // Emergency / Critical triage signals
    if (/(chest pain|cardiac|stroke|unconscious|severe bleeding|seizure|gasping|heart attack)/i.test(text)) {
      recPriority = 1;
      confidence = 0.94;
      reasonCodes.push('high_risk_cardiovascular_symptom', 'acute_triage_signal');
      action = existingPriority > 1 ? 'ESCALATE' : 'KEEP';
    }
    // High / Urgent triage signals
    else if (/(high fever|fracture|severe pain|asthma attack|deep wound|breathlessness)/i.test(text) || severity >= 8) {
      recPriority = 2;
      confidence = 0.88;
      reasonCodes.push('urgent_clinical_acuity', 'elevated_severity_score');
      action = existingPriority > 2 ? 'ESCALATE' : (existingPriority < 2 ? 'DOWNGRADE' : 'KEEP');
    }
    // Moderate triage signals
    else if (/(moderate pain|migraine|vomiting|stomach pain|flu|cough)/i.test(text) || severity >= 5) {
      recPriority = 3;
      confidence = 0.86;
      reasonCodes.push('standard_symptomatic_presentation');
      action = existingPriority > 3 ? 'ESCALATE' : (existingPriority < 3 ? 'DOWNGRADE' : 'KEEP');
    }
    // Routine / Low triage signals
    else if (/(follow-up|routine|checkup|annual|vaccination|prescription refill)/i.test(text) || severity <= 3) {
      recPriority = 4;
      confidence = 0.89;
      reasonCodes.push('routine_preventive_care');
      action = existingPriority < 4 ? 'DOWNGRADE' : 'KEEP';
    }

    // Adjust for uploaded lab reports / medical records presence
    if (recordCount > 0 && recPriority > 1) {
      confidence = Math.min(0.98, confidence + 0.05);
      reasonCodes.push('verified_medical_record_attached');
    }

    // Pediatric / Elderly safety offset
    if ((patientAge <= 5 || patientAge >= 70) && recPriority > 2) {
      recPriority = Math.max(1, recPriority - 1);
      reasonCodes.push('vulnerable_age_triage_adjustment');
      if (existingPriority !== recPriority) action = 'ESCALATE';
    }

    // Borderline confidence threshold rule
    const requiresHumanReview = confidence < this.confidenceThreshold || action === 'ESCALATE';

    return {
      original_priority: existingPriority,
      recommended_priority: recPriority,
      confidence: Math.round(confidence * 100) / 100,
      action: action,
      reason_codes: reasonCodes,
      requires_human_review: requiresHumanReview,
      model_version: this.modelVersion
    };
  }
}

class PriorityValidationService {
  constructor(adapter = new MockAIPriorityAdapter()) {
    this.adapter = adapter;
    this.confidenceThreshold = 0.85;
  }

  async validatePriority(context) {
    try {
      const result = await this.adapter.evaluate(context);
      return {
        success: true,
        fallback_used: false,
        ...result
      };
    } catch (error) {
      console.error('AI Priority Validation error (triggering deterministic fallback):', error);

      // Deterministic Fallback
      const fallbackEval = evaluateConditionPriority(context.symptoms || '');
      const fallbackPriority = fallbackEval.level;
      const existingPriority = context.existingPriority || 3;
      let action = 'KEEP';
      if (fallbackPriority < existingPriority) action = 'ESCALATE';
      if (fallbackPriority > existingPriority) action = 'DOWNGRADE';

      return {
        success: true,
        fallback_used: true,
        original_priority: existingPriority,
        recommended_priority: fallbackPriority,
        confidence: 0.75, // Lower confidence on fallback
        action: action,
        reason_codes: ['fallback_deterministic_engine', fallbackEval.reason],
        requires_human_review: true,
        model_version: 'deterministic-fallback-v1'
      };
    }
  }
}

module.exports = {
  priorityValidationService: new PriorityValidationService(),
  MockAIPriorityAdapter,
  PriorityValidationService
};
