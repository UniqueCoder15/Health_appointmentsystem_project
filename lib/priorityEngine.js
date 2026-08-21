/* ============================================================================
 * Swasthya Saarthi — Priority Queue Engine
 * Computes deterministic, fair priority scores based on medical acuity and wait time.
 * Priority Levels:
 *   1 = 🔴 Critical / Emergency (Highest)
 *   2 = 🟠 High Priority (Serious)
 *   3 = 🟡 Medium Priority (Moderate)
 *   4 = 🟢 Normal Priority (Routine)
 * ========================================================================== */

const PRIORITY_LEVELS = {
  1: { level: 1, name: 'Critical', badge: '🔴 Critical', color: '#ef4444', icon: '🚨', weight: 0 },
  2: { level: 2, name: 'Urgent', badge: '🟠 Urgent', color: '#f97316', icon: '⚡', weight: 1 },
  3: { level: 3, name: 'Normal', badge: '🟡 Normal', color: '#eab308', icon: '🟡', weight: 2 },
  4: { level: 4, name: 'Low', badge: '🔵 Low', color: '#3b82f6', icon: '🔵', weight: 3 },
  5: { level: 5, name: 'Routine', badge: '⚪ Routine', color: '#64748b', icon: '⚪', weight: 4 }
};

const MEDICAL_DISCLAIMER = 'Priority is assigned according to configured medical urgency rules and may be reviewed by authorized medical staff.';

function getPriorityMeta(level) {
  return PRIORITY_LEVELS[level] || PRIORITY_LEVELS[3];
}

function evaluateConditionPriority(conditionText = '') {
  const text = (conditionText || '').toLowerCase();
  
  if (/(chest pain|cardiac|heart attack|stroke|breathing|unconscious|severe bleeding|emergency|seizure)/i.test(text)) {
    return { level: 1, reason: 'High-risk emergency symptoms indicated' };
  }
  if (/(high fever|fracture|severe pain|acute|trauma|asthma attack|deep wound|infection)/i.test(text)) {
    return { level: 2, reason: 'Acute condition requiring urgent evaluation' };
  }
  if (/(moderate pain|rash|migraine|vomiting|stomach pain|allergy|cough|flu)/i.test(text)) {
    return { level: 3, reason: 'Moderate symptomatic condition' };
  }
  return { level: 3, reason: 'Routine / non-urgent consultation' };
}

function computePriorityScore({ priority_level = 4, bookedAt = new Date(), acuityBonus = 0, queueNumber = 1 }) {
  const level = Math.min(5, Math.max(1, priority_level));
  const base = 1000 - ((level - 1) * 150);
  const now = new Date();
  const waitedMin = Math.max(0, Math.floor((now - new Date(bookedAt)) / 60000));
  const waitBonus = Math.min(waitedMin * 0.5, 200); // Wait time bonus for fairness
  const fairness = -queueNumber * 2;
  const score = base + waitBonus + acuityBonus + fairness;
  return Math.round(score * 100) / 100;
}

function priorityReasonText(level, acuityNote) {
  const meta = getPriorityMeta(level);
  if (acuityNote) return `${meta.name} priority — ${acuityNote}`;
  return `${meta.name} priority`;
}

module.exports = {
  PRIORITY_LEVELS,
  MEDICAL_DISCLAIMER,
  getPriorityMeta,
  evaluateConditionPriority,
  computePriorityScore,
  priorityReasonText
};
