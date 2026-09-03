// Swasthya Saarthi Doctor Portal Application Logic

let state = {
  token: localStorage.getItem('mo_doctor_token') || null,
  doctor: null,
  queue: [],
  activeAppointment: null,
  currentRxAppointment: null
};

let queueEventSource = null;

function startQueueStream() {
  if (!state.token) return;
  stopQueueStream();
  const url = `/api/doctors/queue/today/stream?token=${encodeURIComponent(state.token)}`;
  queueEventSource = new EventSource(url);

  queueEventSource.addEventListener('queue-update', (e) => {
    try {
      const data = JSON.parse(e.data);
      state.queue = data.queue || [];
      renderQueueList();
    } catch (err) {
      console.error('Queue SSE parse error:', err);
    }
  });

  queueEventSource.onerror = () => {
    // Auto-reconnect via retry: 3000 in response header
  };
}

function stopQueueStream() {
  if (queueEventSource) {
    queueEventSource.close();
    queueEventSource = null;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initDoctor();
});

async function initDoctor() {
  if (state.token) {
    await fetchDoctorProfile();
    await fetchTodayQueue();
    startQueueStream();
  } else {
    openDocLoginModal();
  }
}

async function fetchDoctorProfile() {
  try {
    const res = await fetch('/api/doctors/profile/me', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      state.doctor = data.doctor;
      updateDoctorHeader();
    } else {
      logoutDoctor();
    }
  } catch (err) {
    console.error('Fetch doctor profile error:', err);
  }
}

function updateDoctorHeader() {
  if (!state.doctor) return;
  const name = state.doctor.full_name;
  const spec = state.doctor.specialty_name;

  document.getElementById('doc-name-text').textContent = name;
  document.getElementById('sidebar-doc-name').textContent = name;
  document.getElementById('sidebar-doc-spec').textContent = spec;
}

async function fetchTodayQueue() {
  if (!state.token) return;
  try {
    const res = await fetch('/api/doctors/queue/today', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      state.queue = data.queue || [];
      renderQueueList();
    }
  } catch (err) {
    console.error('Fetch queue error:', err);
  }
}

function getPriorityBadge(level) {
  const badges = {
    1: { class: 'badge-priority-critical', text: '🚨 Critical' },
    2: { class: 'badge-priority-urgent', text: '⚡ Urgent' },
    3: { class: 'badge-priority-normal', text: '🟢 Normal' },
    4: { class: 'badge-priority-low', text: '🔵 Low' },
    5: { class: 'badge-priority-routine', text: '⚪ Routine' }
  };
  return badges[level] || badges[3];
}

function renderQueueList() {
  const container = document.getElementById('doc-queue-list');
  const countBadge = document.getElementById('doc-queue-count-badge');
  if (!container) return;

  const waitingList = state.queue.filter(a => a.status === 'scheduled' || a.queue_status === 'in-consultation');
  if (countBadge) countBadge.textContent = `${waitingList.length} Patients Waiting`;

  const active = state.queue.find(a => a.queue_status === 'in-consultation') || state.queue[0];
  if (active) {
    state.activeAppointment = active;
    document.getElementById('current-patient-name').textContent = active.patient_name || 'No Patient';
    const priorityBadge = getPriorityBadge(active.priority_level || 3);
    document.getElementById('current-patient-sub').innerHTML = `Appointment Time: ${active.appointment_time} • Queue #${active.queue_number || 1} <span class="badge ${priorityBadge.class}" style="margin-left: 0.5rem;">${priorityBadge.text}</span>`;
  }

  container.innerHTML = state.queue.map(a => {
    let badgeClass = 'badge-waiting';
    let statusTxt = 'Waiting';
    if (a.queue_status === 'in-consultation') {
      badgeClass = 'badge-confirmed';
      statusTxt = 'In Consultation';
    } else if (a.status === 'completed') {
      badgeClass = 'badge-completed';
      statusTxt = 'Completed';
    }

    const priority = a.priority_level || 3;
    const priorityMeta = a.priority_meta || {};
    const priorityBadge = getPriorityBadge(priorityMeta.level || priority);

    return `
      <div class="appt-item-row" style="animation: fadeInUp 0.3s ease;">
        <div class="appt-item-left">
          <div class="row-doc-avatar">${a.patient_avatar || 'AJ'}</div>
          <div>
            <div class="row-doc-name">${a.patient_name}</div>
            <div class="row-doc-spec">Phone: ${a.patient_phone || '+1-555-1001'}</div>
          </div>
        </div>

        <div class="appt-item-middle">
          <span>⏰ ${a.appointment_time}</span>
          <span>🔢 Queue #${a.queue_number || 1}</span>
          <span class="badge ${priorityBadge.class}">${priorityBadge.text}</span>
        </div>

        <div class="appt-item-right">
          <span class="badge ${badgeClass}">${statusTxt}</span>
          <button class="btn btn-outline btn-sm" onclick="callPatientInQueue(${a.id})">Call Patient</button>
          <button class="btn btn-primary btn-sm" onclick="openPrescriptionForAppt(${a.id}, '${a.patient_name}')">Prescribe & Complete</button>
        </div>
      </div>
    `;
  }).join('') || '<div style="padding:2rem; text-align:center; color:#64748b;">No queue items today.</div>';
}

async function callPatientInQueue(apptId) {
  try {
    const res = await fetch('/api/doctors/queue/status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({
        appointment_id: apptId,
        queue_status: 'in-consultation',
        status: 'in-progress'
      })
    });
    if (res.ok) {
      await fetchTodayQueue();
    }
  } catch (err) {
    console.error('Call patient error:', err);
  }
}

function openPrescriptionModal() {
  if (state.activeAppointment) {
    openPrescriptionForAppt(state.activeAppointment.id, state.activeAppointment.patient_name);
  }
}

async function openPrescriptionForAppt(apptId, patientName) {
  state.currentRxAppointment = apptId;
  document.getElementById('rx-appt-id').value = apptId;

  // Fetch appointment details to get patient info
  try {
    const res = await fetch(`/api/appointments/${apptId}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      const appt = data.appointment;
      if (appt) {
        document.getElementById('rx-patient-name').value = appt.patient_name;
        document.getElementById('rx-patient-avatar').textContent = getInitials(appt.patient_name);

        // Priority badge
        const priorityBadge = getPriorityBadge(appt.priority_level || 3);
        const priorityEl = document.getElementById('rx-patient-priority');
        priorityEl.className = `badge ${priorityBadge.class}`;
        priorityEl.textContent = priorityBadge.text;

        // Patient meta (phone, ABHA)
        document.getElementById('rx-patient-meta').innerHTML = `
          <span>Phone: ${appt.patient_phone || 'N/A'}</span>
          <span id="rx-patient-abha" style="display: ${appt.patient_abha_id ? 'inline' : 'none'};">
            ABHA: <span id="rx-abha-value">${appt.patient_abha_id || ''}</span>
          </span>
        `;

        // Load reports and symptoms for this patient
        await loadPatientReportsForDoctor(appt.patient_id);
        await loadSymptomAssessmentForDoctor(appt.patient_id, appt.id);
      }
    }
  } catch (err) {
    console.error('Fetch appointment details error:', err);
    document.getElementById('rx-patient-name').value = patientName;
  }

  // Hide dynamic sections
  document.getElementById('rx-reports-section').style.display = 'none';
  document.getElementById('rx-symptoms-section').style.display = 'none';

  document.getElementById('rx-modal').classList.add('active');
}

function closePrescriptionModal() {
  document.getElementById('rx-modal').classList.remove('active');
  state.currentRxAppointment = null;
  document.getElementById('rx-reports-section').style.display = 'none';
  document.getElementById('rx-symptoms-section').style.display = 'none';
  document.getElementById('rx-reports-grid').innerHTML = '';
  document.getElementById('rx-symptoms-content').innerHTML = '';
}

async function loadPatientReportsForDoctor(patientId) {
  try {
    const res = await fetch(`/api/reports?patient_id=${patientId}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      state.patientReports = data.reports || [];
    }
  } catch (err) {
    console.error('Load patient reports error:', err);
  }
}

async function loadSymptomAssessmentForDoctor(patientId, appointmentId) {
  try {
    const res = await fetch(`/api/symptoms/patient/${patientId}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      state.patientSymptoms = data.assessments || [];
    }
  } catch (err) {
    console.error('Load symptom assessment error:', err);
  }
}

function viewPatientReports() {
  const reports = state.patientReports || [];
  const container = document.getElementById('rx-reports-grid');

  if (reports.length === 0) {
    container.innerHTML = '<div style="padding: 1rem; text-align: center; color: #64748b;">No medical reports found for this patient.</div>';
  } else {
    container.innerHTML = reports.map(r => `
      <div class="report-card" onclick="downloadReport(${r.id})" style="cursor: pointer;">
        <div class="report-icon">${getReportIcon(r.mime_type)}</div>
        <div class="report-info">
          <div class="report-name">${r.original_name}</div>
          <div class="report-meta">${r.document_type || 'Document'} • ${formatFileSize(r.file_size)} • ${formatDate(r.created_at)}</div>
          ${r.description ? `<div class="report-desc">${r.description}</div>` : ''}
        </div>
        <div class="report-actions">
          <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); downloadReport(${r.id})">⬇️ Download</button>
        </div>
      </div>
    `).join('');
  }

  document.getElementById('rx-reports-section').style.display = 'block';
  document.getElementById('rx-symptoms-section').style.display = 'none';
  document.getElementById('rx-view-reports-btn').classList.add('btn-primary');
  document.getElementById('rx-view-reports-btn').classList.remove('btn-outline');
  document.getElementById('rx-view-symptoms-btn').classList.remove('btn-primary');
  document.getElementById('rx-view-symptoms-btn').classList.add('btn-outline');
}

function viewSymptomAssessment() {
  const assessments = state.patientSymptoms || [];
  const container = document.getElementById('rx-symptoms-content');

  if (assessments.length === 0) {
    container.innerHTML = '<div style="padding: 1rem; text-align: center; color: #64748b;">No symptom assessments found for this patient.</div>';
  } else {
    // Show the most recent completed assessment
    const latest = assessments.find(a => a.status === 'completed') || assessments[0];

    container.innerHTML = `
      <div class="symptom-assessment-detail">
        <div class="assessment-header">
          <span class="badge ${latest.emergency_flag ? 'badge-priority-critical' : 'badge-waiting'}">
            ${latest.emergency_flag ? '🚨 Emergency Detected' : '✅ Completed'}
          </span>
          <span class="assessment-date">${formatDateTime(latest.started_at)}</span>
        </div>

        ${latest.chief_complaint ? `
        <div class="assessment-section">
          <h5>Chief Complaint</h5>
          <p>${latest.chief_complaint}</p>
        </div>
        ` : ''}

        ${latest.symptoms_json ? `
        <div class="assessment-section">
          <h5>Symptoms Reported</h5>
          <ul class="symptom-list">
            ${JSON.parse(latest.symptoms_json).map(s => `<li>${s.name}${s.severity ? ` (Severity: ${s.severity}/10)` : ''}${s.duration ? ` - ${s.duration}` : ''}</li>`).join('')}
          </ul>
        </div>
        ` : ''}

        ${latest.severity_score ? `
        <div class="assessment-section">
          <h5>Severity Score</h5>
          <div class="severity-display">
            <span class="severity-score">${latest.severity_score}/10</span>
            <span class="severity-level severity-${latest.urgency_level || 'routine'}">${latest.urgency_level || 'routine'}</span>
          </div>
        </div>
        ` : ''}

        ${latest.summary_for_doctor ? `
        <div class="assessment-section summary-box">
          <h5>📋 Summary for Doctor</h5>
          <pre style="white-space: pre-wrap; font-family: inherit; background: #f8fafc; padding: 1rem; border-radius: 8px;">${latest.summary_for_doctor}</pre>
        </div>
        ` : ''}

        ${latest.emergency_flag && latest.emergency_reason ? `
        <div class="assessment-section emergency-box" style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 1rem;">
          <h5 style="color: #dc2626;">🚨 Emergency Flags Detected</h5>
          <p style="color: #dc2626;">${latest.emergency_reason}</p>
        </div>
        ` : ''}
      </div>
    `;
  }

  document.getElementById('rx-symptoms-section').style.display = 'block';
  document.getElementById('rx-reports-section').style.display = 'none';
  document.getElementById('rx-view-symptoms-btn').classList.add('btn-primary');
  document.getElementById('rx-view-symptoms-btn').classList.remove('btn-outline');
  document.getElementById('rx-view-reports-btn').classList.remove('btn-primary');
  document.getElementById('rx-view-reports-btn').classList.add('btn-outline');
}

function downloadReport(reportId) {
  window.open(`/api/reports/${reportId}/download`, '_blank');
}

function getReportIcon(mimeType) {
  if (mimeType === 'application/pdf') return '📄';
  if (mimeType.startsWith('image/')) return '🖼️';
  return '📎';
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getInitials(name) {
  if (!name) return 'AJ';
  const parts = name.trim().split(' ');
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

async function saveConsultationNotes() {
  const apptId = document.getElementById('rx-appt-id').value;
  const diagnosis = document.getElementById('rx-diagnosis').value;
  const prescription = document.getElementById('rx-prescription').value;
  const notes = document.getElementById('rx-notes').value;

  try {
    const res = await fetch('/api/doctors/queue/status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({
        appointment_id: apptId,
        queue_status: 'completed',
        status: 'completed',
        diagnosis,
        prescription,
        notes
      })
    });

    if (res.ok) {
      alert('✅ Patient consultation completed & prescription recorded!');
      closePrescriptionModal();
      await fetchTodayQueue();
    }
  } catch (err) {
    console.error('Save consultation error:', err);
  }
}

function switchDocTab(tabId) {
  document.querySelectorAll('.dash-tab-content').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  if (event && event.currentTarget) event.currentTarget.classList.add('active');

  if (tabId === 'doc-queue') {
    document.getElementById('tab-doc-queue').style.display = 'block';
  } else if (tabId === 'doc-patients') {
    document.getElementById('tab-doc-patients').style.display = 'block';
  } else if (tabId === 'doc-schedule') {
    document.getElementById('tab-doc-schedule').style.display = 'block';
  }
}

function openDocLoginModal() {
  document.getElementById('doc-login-modal').classList.add('active');
}

async function handleDoctorLogin(e) {
  e.preventDefault();
  const email = document.getElementById('doc-login-email').value;
  const password = document.getElementById('doc-login-password').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (res.ok && data.token) {
      state.token = data.token;
      localStorage.setItem('mo_doctor_token', data.token);
      document.getElementById('doc-login-modal').classList.remove('active');
      await fetchDoctorProfile();
      await fetchTodayQueue();
    } else {
      alert(data.error || 'Doctor sign in failed.');
    }
  } catch (err) {
    alert('Server error logging in.');
  }
}

async function quickLoginDoc(email, password) {
  document.getElementById('doc-login-email').value = email;
  document.getElementById('doc-login-password').value = password;
  const fakeEvent = { preventDefault: () => {} };
  await handleDoctorLogin(fakeEvent);
}

function logoutDoctor() {
  state.token = null;
  localStorage.removeItem('mo_doctor_token');
  openDocLoginModal();
}