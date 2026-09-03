// Swasthya Saarthi Patient Portal Application Logic

// Motion animation helper - uses window.Motion from UMD bundle
function animateMotion(element, keyframes, options = {}) {
  if (!element) return Promise.resolve();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    Object.assign(element.style, keyframes[keyframes.length - 1]);
    return Promise.resolve();
  }
  if (window.Motion && window.Motion.animate) {
    return window.Motion.animate(element, keyframes, {
      duration: options.duration || 300,
      easing: options.easing || 'cubic-bezier(0.16, 1, 0.3, 1)',
      ...options
    }).finished;
  }
  // Fallback: CSS animation
  return Promise.resolve();
}

let state = {
  user: null,
  token: localStorage.getItem('mo_patient_token') || null,
  specialties: [],
  doctors: [],
  appointments: [],
  nextAppointment: null,
  selectedDoctor: null,
  selectedDate: null,
  selectedSlot: null,
  reports: [],
  filteredReports: [],
  currentReportFilter: 'all',
  symptomSession: null,
  symptomQuestionIndex: 0,
  symptomAnswers: {},
  symptomSessionId: null
};

let heroEventSource = null;
let patientEventSource = null;

function startHeroStream() {
  stopHeroStream();
  if (!state.token || !state.nextAppointment) return;

  const url = `/api/appointments/${state.nextAppointment.id}/stream?token=${encodeURIComponent(state.token)}`;
  heroEventSource = new EventSource(url);

  heroEventSource.addEventListener('appointment-update', (e) => {
    try {
      const appointment = JSON.parse(e.data);
      state.nextAppointment = appointment;
      updateHeroQueueDisplay(appointment);
    } catch (err) {
      console.error('Hero SSE parse error:', err);
    }
  });
}

function stopHeroStream() {
  if (heroEventSource) {
    heroEventSource.close();
    heroEventSource = null;
  }
}

// Patient SSE for real-time notifications (suspension, reports, symptoms, ABHA)
function startPatientSSE() {
  stopPatientSSE();
  if (!state.token || !state.user) return;

  const url = `/api/patient/stream?token=${encodeURIComponent(state.token)}`;
  patientEventSource = new EventSource(url);

  patientEventSource.addEventListener('patient-update', (e) => {
    try {
      const data = JSON.parse(e.data);
      handlePatientNotification(data);
    } catch (err) {
      console.error('Patient SSE parse error:', err);
    }
  });

  patientEventSource.onerror = () => {
    // Auto-reconnect
  };
}

function stopPatientSSE() {
  if (patientEventSource) {
    patientEventSource.close();
    patientEventSource = null;
  }
}

function handlePatientNotification(data) {
  console.log('Patient notification:', data);

  switch (data.type) {
    case 'abha-linked':
      if (state.user) {
        state.user.abha_id = data.abhaId;
        updateABHAUI();
      }
      break;
    case 'user-suspended':
      showSuspensionBanner(data.suspension);
      break;
    case 'user-unsuspended':
      hideSuspensionBanner();
      break;
    case 'report-uploaded':
      fetchPatientReports();
      break;
    case 'report-deleted':
      fetchPatientReports();
      break;
    case 'symptom-assessment-completed':
      fetchPatientSymptomHistory();
      break;
    case 'abuse-flag-raised':
      showToast('Warning', 'Your account has been flagged for excessive cancellations/no-shows. Please contact admin.', 'warning');
      break;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  await fetchSpecialties();
  await fetchDoctors();
  renderLandingSpecialties();
  renderLandingDoctors();

  if (state.token) {
    await fetchPatientProfile();
    await fetchNextAppointment();
    await fetchPatientAppointments();
    await fetchPatientReports();
    await fetchPatientSymptomHistory();
    updateUIState(true);
    startPatientSSE();
  } else {
    updateUIState(false);
  }
}

function updateUIState(isLoggedIn) {
  const authBtns = document.getElementById('nav-auth-buttons');
  const userBadge = document.getElementById('nav-user-badge');
  const navAvatar = document.getElementById('nav-avatar');
  const dashUserAvatar = document.getElementById('dash-user-avatar');
  const dashUserName = document.getElementById('dash-user-name');

  if (isLoggedIn && state.user) {
    if (authBtns) authBtns.style.display = 'none';
    if (userBadge) userBadge.style.display = 'flex';

    const initials = getInitials(state.user.full_name);
    if (navAvatar) navAvatar.textContent = initials;
    if (dashUserAvatar) dashUserAvatar.textContent = initials;
    if (dashUserName) dashUserName.textContent = state.user.full_name;

    // Update ABHA UI if user has ABHA
    updateABHAUI();

    // Check for suspension
    checkSuspensionStatus();
  } else {
    if (authBtns) authBtns.style.display = 'flex';
    if (userBadge) userBadge.style.display = 'none';
  }
}

function updateABHAUI() {
  const abhaInput = document.getElementById('profile-abha');
  const abhaHint = document.getElementById('abha-hint');
  const abhaStatus = document.getElementById('abha-status');

  if (abhaInput && state.user) {
    if (state.user.abha_id) {
      abhaInput.value = state.user.abha_id;
      abhaHint.textContent = 'ABHA ID linked successfully ✓';
      abhaHint.style.color = '#22c55e';
      if (abhaStatus) {
        if (state.user.abha_verified) {
          abhaStatus.textContent = '✅ Verified on ' + new Date(state.user.abha_verified_at).toLocaleDateString();
          abhaStatus.style.color = '#22c55e';
        } else {
          abhaStatus.textContent = '⏳ Pending verification';
          abhaStatus.style.color = '#f59e0b';
        }
      }
    } else {
      abhaInput.value = '';
      abhaHint.textContent = '14-digit unique health ID (optional)';
      abhaHint.style.color = '#64748b';
      if (abhaStatus) abhaStatus.textContent = '';
    }
  }
}

// Toast Notifications
function showToast(title, message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${icons[type]}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
  `;

  container.appendChild(toast);

  // Animate in
  animateMotion(toast, [
    { opacity: 0, transform: 'translateX(100%)' },
    { opacity: 1, transform: 'translateX(0)' }
  ], { duration: 300 });

  // Auto-remove after 5 seconds
  setTimeout(() => {
    animateMotion(toast, [
      { opacity: 1, transform: 'translateX(0)' },
      { opacity: 0, transform: 'translateX(100%)' }
    ], { duration: 300 }).then(() => toast.remove());
  }, 5000);
}

function validateABHAId(abhaId) {
  // ABHA ID must be exactly 14 digits
  const abhaRegex = /^\d{14}$/;
  return abhaRegex.test(abhaId);
}

async function saveProfile() {
  const name = document.getElementById('profile-name').value.trim();
  const phone = document.getElementById('profile-phone').value.trim();
  const abhaId = document.getElementById('profile-abha').value.trim();

  if (!name) {
    showToast('Error', 'Name is required.', 'error');
    return;
  }

  if (abhaId && !validateABHAId(abhaId)) {
    showToast('Invalid ABHA ID', 'ABHA ID must be exactly 14 digits.', 'error');
    document.getElementById('profile-abha').focus();
    return;
  }

  try {
    const res = await fetch('/api/auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ full_name: name, phone, abha_id: abhaId || null })
    });

    const data = await res.json();
    if (res.ok) {
      state.user = data.user;
      showToast('Success', 'Profile updated successfully.', 'success');
      updateABHAUI();
    } else {
      showToast('Error', data.error || 'Failed to update profile.', 'error');
    }
  } catch (err) {
    console.error('Save profile error:', err);
    showToast('Error', 'Server error while saving.', 'error');
  }
}

async function checkSuspensionStatus() {
  try {
    const res = await fetch('/api/abuse/check/' + state.user.id, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.suspended && data.suspension) {
        showSuspensionBanner(data.suspension);
      } else {
        hideSuspensionBanner();
      }
    }
  } catch (err) {
    console.error('Check suspension error:', err);
  }
}

function showSuspensionBanner(suspension) {
  const banner = document.getElementById('suspension-banner');
  const title = document.getElementById('suspension-title');
  const message = document.getElementById('suspension-message');

  if (banner && title && message) {
    const typeLabels = {
      'warning': '⚠️ Account Warning',
      'temporary': '🚫 Account Temporarily Suspended',
      'permanent': '🛑 Account Permanently Suspended'
    };
    title.textContent = typeLabels[suspension.suspension_type] || 'Account Suspended';

    let msg = suspension.reason;
    if (suspension.expires_at) {
      msg += ' Expires: ' + new Date(suspension.expires_at).toLocaleString();
    }
    message.textContent = msg;

    banner.style.display = 'flex';
  }
}

function hideSuspensionBanner() {
  const banner = document.getElementById('suspension-banner');
  if (banner) banner.style.display = 'none';
}

function getInitials(name) {
  if (!name) return 'AJ';
  const parts = name.trim().split(' ');
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

/* API Calls */
async function fetchSpecialties() {
  try {
    const res = await fetch('/api/specialties');
    const data = await res.json();
    state.specialties = data.specialties || [];
  } catch (err) {
    console.error('Fetch specialties error:', err);
  }
}

async function fetchDoctors() {
  try {
    const res = await fetch('/api/doctors');
    const data = await res.json();
    state.doctors = data.doctors || [];
  } catch (err) {
    console.error('Fetch doctors error:', err);
  }
}

async function fetchPatientProfile() {
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      state.user = data.user;
    } else {
      logoutPatient();
    }
  } catch (err) {
    console.error('Profile fetch error:', err);
  }
}

async function fetchNextAppointment() {
  if (!state.token) return;
  try {
    const res = await fetch('/api/appointments/next', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      state.nextAppointment = data.appointment;
      renderNextAppointmentHero();
      if (state.nextAppointment) startHeroStream();
    }
  } catch (err) {
    console.error('Fetch next appt error:', err);
  }
}

async function fetchPatientAppointments() {
  if (!state.token) return;
  try {
    const res = await fetch('/api/appointments/my', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      state.appointments = data.appointments || [];
      renderAppointmentsList();
      renderDashboardStats();
    }
  } catch (err) {
    console.error('Fetch appts error:', err);
  }
}

// Reports Functions
async function fetchPatientReports() {
  if (!state.token) return;
  try {
    const res = await fetch('/api/reports', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      state.reports = data.reports || [];
      filterReports(state.currentReportFilter);
    }
  } catch (err) {
    console.error('Fetch reports error:', err);
  }
}

function filterReports(filter) {
  state.currentReportFilter = filter;

  document.querySelectorAll('#tab-dash-reports .filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.onclick && btn.onclick.toString().includes(filter));
  });

  if (filter === 'all') {
    state.filteredReports = [...state.reports];
  } else {
    state.filteredReports = state.reports.filter(r => r.document_type === filter);
  }

  renderReportsGrid();
}

function renderReportsGrid() {
  const grid = document.getElementById('reports-grid');
  const empty = document.getElementById('reports-empty');

  if (!grid) return;

  if (state.filteredReports.length === 0) {
    grid.style.display = 'none';
    if (empty) empty.style.display = 'block';
    return;
  }

  grid.style.display = 'grid';
  if (empty) empty.style.display = 'none';

  const typeIcons = {
    'lab_result': '🧪',
    'prescription': '💊',
    'imaging': '🖼️',
    'discharge_summary': '🏥',
    'other': '📄'
  };

  const typeLabels = {
    'lab_result': 'Lab Result',
    'prescription': 'Prescription',
    'imaging': 'Imaging',
    'discharge_summary': 'Discharge Summary',
    'other': 'Other'
  };

  grid.innerHTML = state.filteredReports.map(report => `
    <div class="report-card" onclick="viewReport(${report.id})">
      <div class="report-card-header">
        <span class="report-type-icon">${typeIcons[report.document_type] || '📄'}</span>
        <span class="report-type-badge">${typeLabels[report.document_type] || 'Document'}</span>
      </div>
      <div class="report-card-body">
        <h4 class="report-title">${report.original_name}</h4>
        <div class="report-meta">
          <span>${formatDate(report.created_at)}</span>
          <span>${formatFileSize(report.file_size)}</span>
          ${report.appointment_id ? `<span>Appt #${report.appointment_id}</span>` : ''}
        </div>
        ${report.description ? `<p class="report-desc">${report.description}</p>` : ''}
      </div>
      <div class="report-card-footer">
        <button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); downloadReport(${report.id})">⬇️ Download</button>
        <button class="btn btn-outline btn-sm" style="color: #ef4444;" onclick="event.stopPropagation(); deleteReport(${report.id})">🗑️ Delete</button>
      </div>
    </div>
  `).join('');
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Upload Report Modal
function openUploadReportModal() {
  document.getElementById('upload-report-modal').classList.add('active');
  populateReportAppointmentDropdown();
  resetUploadForm();
}

function closeUploadReportModal() {
  document.getElementById('upload-report-modal').classList.remove('active');
  resetUploadForm();
}

function resetUploadForm() {
  document.getElementById('upload-report-form').reset();
  document.getElementById('file-preview').style.display = 'none';
  document.getElementById('file-preview').innerHTML = '';
  document.getElementById('upload-report-submit').disabled = true;
  document.getElementById('file-drop-zone').classList.remove('has-file');
  document.querySelector('#file-drop-zone .drop-zone-text').textContent = 'Drag & drop a PDF, JPG, or PNG file here';
}

function populateReportAppointmentDropdown() {
  const select = document.getElementById('report-appointment');
  if (!select) return;

  const upcoming = state.appointments.filter(a => a.status === 'scheduled' || a.status === 'completed');
  select.innerHTML = '<option value="">No appointment linked</option>' +
    upcoming.map(a => `<option value="${a.id}">${a.doctor_name} - ${a.appointment_date} ${a.appointment_time}</option>`).join('');
}

// File drop zone handling
document.addEventListener('DOMContentLoaded', () => {
  // File drop zone
  const dropZone = document.getElementById('file-drop-zone');
  const fileInput = document.getElementById('report-file');

  if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
      handleFileSelect(e.target.files[0]);
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) {
        fileInput.files = e.dataTransfer.files;
        handleFileSelect(file);
      }
    });
  }
});

function handleFileSelect(file) {
  if (!file) return;

  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
  const maxSize = 10 * 1024 * 1024; // 10MB

  if (!allowedTypes.includes(file.type)) {
    showToast('Invalid File', 'Only PDF, JPG, and PNG files are allowed.', 'error');
    return;
  }

  if (file.size > maxSize) {
    showToast('File Too Large', 'Maximum file size is 10MB.', 'error');
    return;
  }

  const preview = document.getElementById('file-preview');
  const icon = file.type === 'application/pdf' ? '📄' : '🖼️';

  preview.innerHTML = `
    <div class="preview-file">
      <span class="preview-icon">${icon}</span>
      <div class="preview-info">
        <div class="preview-name">${file.name}</div>
        <div class="preview-size">${formatFileSize(file.size)}</div>
      </div>
      <button type="button" class="preview-remove" onclick="clearFileSelection()">×</button>
    </div>
  `;
  preview.style.display = 'block';
  document.getElementById('file-drop-zone').classList.add('has-file');
  document.querySelector('#file-drop-zone .drop-zone-text').textContent = file.name;
  document.getElementById('upload-report-submit').disabled = false;
}

function clearFileSelection() {
  document.getElementById('report-file').value = '';
  resetUploadForm();
}

async function submitReportUpload() {
  const fileInput = document.getElementById('report-file');
  const docType = document.getElementById('report-doc-type').value;
  const description = document.getElementById('report-description').value;
  const appointmentId = document.getElementById('report-appointment').value;

  if (!fileInput.files[0] || !docType) {
    showToast('Missing Fields', 'Please select a file and document type.', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('document_type', docType);
  if (description) formData.append('description', description);
  if (appointmentId) formData.append('appointment_id', appointmentId);

  showLoading(true, 'Uploading report...');

  try {
    const res = await fetch('/api/reports', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`
      },
      body: formData
    });

    const data = await res.json();
    showLoading(false);

    if (res.ok) {
      showToast('Success', 'Report uploaded successfully!', 'success');
      closeUploadReportModal();
      fetchPatientReports();
    } else {
      showToast('Error', data.error || 'Failed to upload report.', 'error');
    }
  } catch (err) {
    showLoading(false);
    console.error('Upload error:', err);
    showToast('Error', 'Server error while uploading.', 'error');
  }
}

// View Report Modal
function viewReport(reportId) {
  const report = state.reports.find(r => r.id === reportId);
  if (!report) return;

  const modal = document.getElementById('view-report-modal');
  const title = document.getElementById('view-report-title');
  const content = document.getElementById('view-report-content');
  const downloadBtn = document.getElementById('download-report-btn');

  if (modal && title && content) {
    title.textContent = report.original_name;
    downloadBtn.dataset.reportId = reportId;

    const typeIcons = {
      'lab_result': '🧪',
      'prescription': '💊',
      'imaging': '🖼️',
      'discharge_summary': '🏥',
      'other': '📄'
    };

    const typeLabels = {
      'lab_result': 'Lab Result',
      'prescription': 'Prescription',
      'imaging': 'Imaging',
      'discharge_summary': 'Discharge Summary',
      'other': 'Other'
    };

    const isImage = report.mime_type.startsWith('image/');

    content.innerHTML = `
      <div class="report-view">
        <div class="report-view-header">
          <span class="report-view-type-icon">${typeIcons[report.document_type] || '📄'}</span>
          <div class="report-view-type-info">
            <div class="report-view-type">${typeLabels[report.document_type] || 'Document'}</div>
            <div class="report-view-meta">
              Uploaded: ${formatDate(report.created_at)} • ${formatFileSize(report.file_size)} • ${report.mime_type}
            </div>
          </div>
        </div>
        ${report.description ? `<div class="report-view-desc">${report.description}</div>` : ''}
        <div class="report-view-preview">
          ${isImage
            ? `<img src="/api/reports/${report.id}/download" alt="${report.original_name}" style="max-width: 100%; max-height: 500px;">`
            : `<div class="pdf-placeholder">
                <span class="pdf-icon">📄</span>
                <p>PDF Preview not available in browser</p>
                <button class="btn btn-primary" onclick="downloadReport(${report.id})">⬇️ Download to View</button>
              </div>`
          }
        </div>
      </div>
    `;

    modal.classList.add('active');
  }
}

function closeViewReportModal() {
  document.getElementById('view-report-modal').classList.remove('active');
}

async function downloadReport(reportId) {
  try {
    const res = await fetch(`/api/reports/${reportId}/download`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    if (res.ok) {
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } else {
      const data = await res.json();
      showToast('Error', data.error || 'Failed to download report.', 'error');
    }
  } catch (err) {
    console.error('Download error:', err);
    showToast('Error', 'Server error while downloading.', 'error');
  }
}

async function deleteReport(reportId) {
  if (!confirm('Are you sure you want to delete this report?')) return;

  try {
    const res = await fetch(`/api/reports/${reportId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    if (res.ok) {
      showToast('Success', 'Report deleted successfully.', 'success');
      fetchPatientReports();
    } else {
      const data = await res.json();
      showToast('Error', data.error || 'Failed to delete report.', 'error');
    }
  } catch (err) {
    console.error('Delete error:', err);
    showToast('Error', 'Server error while deleting.', 'error');
  }
}

/* Symptom Checker (AI-Assisted guided flow) */
const symptomFlow = {
  sessionId: null,
  questionIndex: 0,
  totalQuestions: 0,
  currentQuestion: null,
  lastSummary: null,
  lastEmergency: null
};

// Element lookup: tab uses baseId, modal uses 'modal-' + baseId
function symptomEl(mode, baseId) {
  return document.getElementById((mode === 'modal' ? 'modal-' : '') + baseId);
}

// Wrappers bound by the HTML buttons
function startSymptomAssessment() { startSymptomAssessmentFlow('tab'); }
function startSymptomAssessmentModal() { startSymptomAssessmentFlow('modal'); }

async function startSymptomAssessmentFlow(mode) {
  if (!state.token) {
    openLoginModal();
    return;
  }

  try {
    const res = await fetch('/api/symptoms/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({})
    });
    const data = await res.json();

    if (!res.ok) {
      showToast('Error', data.error || 'Failed to start assessment.', 'error');
      return;
    }

    symptomFlow.sessionId = data.assessment.session_id;
    symptomFlow.questionIndex = data.questionIndex;
    symptomFlow.totalQuestions = data.totalQuestions;
    symptomFlow.currentQuestion = data.currentQuestion;

    // Switch UI from welcome to chat
    symptomEl(mode, 'symptom-welcome').style.display = 'none';
    symptomEl(mode, 'symptom-summary').style.display = 'none';
    const chatEl = symptomEl(mode, 'symptom-chat');
    chatEl.style.display = 'block';
    symptomEl(mode, 'symptom-chat-messages').innerHTML = '';
    updateSymptomProgress(mode);

    addBotMessage(mode, '👋 Hello! I\'ll ask you a few questions to understand your symptoms. This helps your doctor get context before your visit.');
    setTimeout(() => {
      addBotMessage(mode, data.currentQuestion.question);
      renderSymptomInput(mode, data.currentQuestion);
    }, 350);
  } catch (err) {
    console.error('Start symptom error:', err);
    showToast('Error', 'Server error starting assessment.', 'error');
  }
}

function updateSymptomProgress(mode) {
  const fill = symptomEl(mode, 'symptom-progress-fill');
  const text = symptomEl(mode, 'symptom-progress-text');
  if (fill) {
    const pct = Math.round((symptomFlow.questionIndex / symptomFlow.totalQuestions) * 100);
    fill.style.width = `${Math.min(100, pct)}%`;
  }
  if (text) {
    text.textContent = `Question ${Math.min(symptomFlow.questionIndex + 1, symptomFlow.totalQuestions)} of ${symptomFlow.totalQuestions}`;
  }
}

function addBotMessage(mode, text) {
  const container = symptomEl(mode, 'symptom-chat-messages');
  const msg = document.createElement('div');
  msg.className = 'symptom-msg symptom-msg-bot';
  msg.innerHTML = `<span class="symptom-msg-bubble">${text}</span>`;
  container.appendChild(msg);
  scrollSymptomChat(mode);
}

function addUserMessage(mode, text) {
  const container = symptomEl(mode, 'symptom-chat-messages');
  const msg = document.createElement('div');
  msg.className = 'symptom-msg symptom-msg-user';
  msg.innerHTML = `<span class="symptom-msg-bubble">${text}</span>`;
  container.appendChild(msg);
  scrollSymptomChat(mode);
}

function scrollSymptomChat(mode) {
  const container = symptomEl(mode, 'symptom-chat-messages');
  if (container) container.scrollTop = container.scrollHeight;
}

function renderSymptomInput(mode, question) {
  const area = symptomEl(mode, 'symptom-input-area');
  if (!area) return;
  symptomFlow.currentQuestion = question;

  let html = '';
  if (question.type === 'select' || question.type === 'multiselect') {
    const multi = question.type === 'multiselect';
    html = `
      <div class="symptom-options">
        ${question.options.map(opt => `
          <button type="button" class="symptom-option-btn ${multi ? 'multi' : ''}" data-value="${opt.value}" onclick="selectSymptomOption('${mode}', '${opt.value}', this, ${multi})">
            ${opt.label}
          </button>
        `).join('')}
      </div>
      <button type="button" class="btn btn-primary btn-block" style="margin-top:0.75rem;" onclick="submitSymptomAnswer('${mode}')">Continue →</button>
    `;
  } else if (question.type === 'number') {
    html = `
      <div class="symptom-input-row">
        <input type="number" id="symptom-answer-input" min="${question.min || 1}" max="${question.max || 10}" value="5" class="form-input" style="flex:1;">
        <button type="button" class="btn btn-primary" onclick="submitSymptomAnswer('${mode}')">Send</button>
      </div>
    `;
  } else if (question.type === 'textarea') {
    html = `
      <textarea id="symptom-answer-input" class="form-textarea" rows="3" placeholder="Type your answer..."></textarea>
      <button type="button" class="btn btn-primary btn-block" style="margin-top:0.5rem;" onclick="submitSymptomAnswer('${mode}')">Send</button>
    `;
  } else {
    // text
    html = `
      <div class="symptom-input-row">
        <input type="text" id="symptom-answer-input" class="form-input" style="flex:1;" placeholder="Type your answer..." onkeydown="if(event.key==='Enter')submitSymptomAnswer('${mode}')">
        <button type="button" class="btn btn-primary" onclick="submitSymptomAnswer('${mode}')">Send</button>
      </div>
    `;
  }

  area.innerHTML = html;
  const input = area.querySelector('#symptom-answer-input');
  if (input && question.type !== 'multiselect') input.focus();
}

function selectSymptomOption(mode, value, btnEl, multi) {
  if (multi) {
    btnEl.classList.toggle('selected');
  } else {
    document.querySelectorAll(`#${(mode === 'modal' ? 'modal-' : '')}symptom-input-area .symptom-option-btn`).forEach(b => b.classList.remove('selected'));
    btnEl.classList.add('selected');
  }
}

function gatherSymptomAnswer(mode) {
  const q = symptomFlow.currentQuestion;
  if (!q) return null;

  if (q.type === 'select') {
    const sel = document.querySelector(`#${(mode === 'modal' ? 'modal-' : '')}symptom-input-area .symptom-option-btn.selected`);
    return sel ? sel.dataset.value : null;
  } else if (q.type === 'multiselect') {
    const sel = document.querySelectorAll(`#${(mode === 'modal' ? 'modal-' : '')}symptom-input-area .symptom-option-btn.selected`);
    const values = Array.from(sel).map(s => s.dataset.value);
    return values.length ? values : ['none'];
  }
  return document.getElementById('symptom-answer-input').value;
}

async function submitSymptomAnswer(mode) {
  const q = symptomFlow.currentQuestion;
  if (!q) return;

  const answer = gatherSymptomAnswer(mode);
  if (!answer || (q.required && (answer === '' || (Array.isArray(answer) && answer.length === 0)))) {
    showToast('Required', 'Please provide an answer to continue.', 'warning');
    return;
  }

  const displayAnswer = Array.isArray(answer) ? answer.join(', ') : answer;
  addUserMessage(mode, displayAnswer);

  // Disable input area while awaiting response
  symptomEl(mode, 'symptom-input-area').innerHTML = '<div class="symptom-typing">Assistant is thinking…</div>';

  try {
    const res = await fetch(`/api/symptoms/${symptomFlow.sessionId}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ answer, questionId: q.id })
    });
    const data = await res.json();

    if (!res.ok) {
      showToast('Error', data.error || 'Failed to submit answer.', 'error');
      symptomEl(mode, 'symptom-input-area').innerHTML = '';
      return;
    }

    if (data.isComplete) {
      symptomFlow.questionIndex = symptomFlow.totalQuestions;
      updateSymptomProgress(mode);
      showSymptomSummary(mode, data);
    } else {
      symptomFlow.questionIndex = data.questionIndex;
      symptomFlow.totalQuestions = data.totalQuestions;
      symptomFlow.currentQuestion = data.currentQuestion;
      updateSymptomProgress(mode);
      setTimeout(() => {
        addBotMessage(mode, data.currentQuestion.question);
        renderSymptomInput(mode, data.currentQuestion);
      }, 300);
    }
  } catch (err) {
    console.error('Symptom answer error:', err);
    showToast('Error', 'Server error submitting answer.', 'error');
    symptomEl(mode, 'symptom-input-area').innerHTML = '';
  }
}

function showSymptomSummary(mode, data) {
  symptomEl(mode, 'symptom-chat').style.display = 'none';
  const summaryEl = symptomEl(mode, 'symptom-summary');
  summaryEl.style.display = 'block';
  symptomEl(mode, 'symptom-summary-content').innerHTML = renderSummaryMarkdown(data.summary);

  symptomFlow.lastSummary = data.summary;
  symptomFlow.lastEmergency = data.emergencyGuidance;

  // Emergency guidance banner if flagged
  if (data.emergencyGuidance) {
    const banner = document.createElement('div');
    banner.className = 'symptom-emergency';
    banner.innerHTML = `
      <strong>🚨 ${data.emergencyGuidance.message}</strong>
      <p>${data.emergencyGuidance.recommendation}</p>
      <small>${data.emergencyGuidance.disclaimer}</small>
    `;
    summaryEl.insertBefore(banner, summaryEl.querySelector('.summary-content'));
  }
}

function renderSummaryMarkdown(md) {
  // Lightweight markdown-ish rendering for the summary (bold lines and bullets)
  const escaped = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped
    .split('\n')
    .map(line => {
      if (line.startsWith('**') && line.endsWith('**')) {
        return `<div class="summary-line summary-line-title">${line.slice(2, -2)}</div>`;
      }
      if (line.startsWith('- ')) {
        return `<div class="summary-line">• ${line.slice(2)}</div>`;
      }
      if (line.startsWith('*') && line.endsWith('*')) {
        return `<div class="summary-line summary-line-note"><em>${line.slice(1, -1)}</em></div>`;
      }
      if (!line.trim()) return '';
      return `<div class="summary-line">${line}</div>`;
    })
    .join('');
}

async function saveSymptomAssessment() { await persistSymptomSummary(); }
async function saveSymptomAssessmentModal() { await persistSymptomSummary(); }

async function persistSymptomSummary() {
  if (!symptomFlow.lastSummary) {
    showToast('Info', 'No completed assessment to save.', 'info');
    return;
  }
  // Assessment is already persisted server-side; refresh the local history list
  showToast('Success', 'Assessment saved and shared with your doctor.', 'success');
  await fetchPatientSymptomHistory();
}

function startNewSymptomAssessment() { resetSymptomUI('tab'); startSymptomAssessmentFlow('tab'); }
function startNewSymptomAssessmentModal() { resetSymptomUI('modal'); startSymptomAssessmentFlow('modal'); }

function resetSymptomUI(mode) {
  symptomEl(mode, 'symptom-welcome').style.display = 'block';
  symptomEl(mode, 'symptom-chat').style.display = 'none';
  symptomEl(mode, 'symptom-summary').style.display = 'none';
  symptomEl(mode, 'symptom-chat-messages').innerHTML = '';
  symptomEl(mode, 'symptom-input-area').innerHTML = '';
  symptomFlow.sessionId = null;
  symptomFlow.questionIndex = 0;
  symptomFlow.lastSummary = null;
  symptomFlow.lastEmergency = null;
}

async function fetchPatientSymptomHistory() {
  if (!state.token) return;
  try {
    const res = await fetch(`/api/symptoms/patient/${state.user.id}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      renderSymptomHistory(data.assessments || []);
    }
  } catch (err) {
    console.error('Fetch symptom history error:', err);
  }
}

function renderSymptomHistory(assessments) {
  const list = document.getElementById('symptom-history-list');
  if (!list) return;

  if (!assessments.length) {
    list.innerHTML = '<div style="padding:1.5rem; text-align:center; color:#64748b;">No assessments yet.</div>';
    return;
  }

  const urgencyBadges = {
    'routine': 'badge-completed',
    'urgent': 'badge-priority-urgent',
    'emergency': 'badge-priority-critical'
  };
  const urgencyLabels = {
    'routine': 'Routine',
    'urgent': 'Urgent',
    'emergency': '🚨 Emergency'
  };

  list.innerHTML = assessments.map(a => `
    <div class="appt-item-row" onclick="viewSymptomHistoryItem(${a.id})" style="cursor:pointer;">
      <div class="appt-item-left">
        <div class="row-doc-avatar">🩺</div>
        <div>
          <div class="row-doc-name">${a.chief_complaint || 'Symptom Assessment'}</div>
          <div class="row-doc-spec">${a.started_at ? new Date(a.started_at).toLocaleString() : ''} • Severity ${a.severity_score || '—'}/10</div>
        </div>
      </div>
      <div class="appt-item-right">
        <span class="badge ${urgencyBadges[a.urgency_level] || 'badge-waiting'}">${urgencyLabels[a.urgency_level] || a.urgency_level}</span>
      </div>
    </div>
  `).join('');
}

function viewSymptomHistoryItem(assessmentId) {
  const list = document.getElementById('symptom-history-list');
  const item = list.querySelector(`[onclick="viewSymptomHistoryItem(${assessmentId})"]`);
  // Show inline summary by toggling a detail area; reuse summary modal is overkill.
  // Simple approach: fetch and alert-style expand not needed for prototype; log it.
  console.log('View assessment', assessmentId);
  showToast('Info', 'Detailed assessment view is available in the Doctor portal.', 'info');
}

/* Landing Page Renderers */
function renderLandingSpecialties() {
  const grid = document.getElementById('landing-specialty-grid');
  if (!grid) return;

  grid.innerHTML = state.specialties.map(s => `
    <div class="specialty-card" onclick="openBookingWithSpecialty(${s.id})">
      <div class="specialty-icon">${s.icon || '🩺'}</div>
      <div class="specialty-title">${s.name}</div>
      <div class="specialty-count">${s.doctor_count || 12} doctors</div>
    </div>
  `).join('');
}

function renderLandingDoctors() {
  const grid = document.getElementById('landing-doctors-grid');
  if (!grid) return;

  grid.innerHTML = state.doctors.slice(0, 6).map(doc => `
    <div class="doc-card">
      <div class="doc-card-header">
        <div class="doc-avatar">${doc.specialty_icon || '👨‍⚕️'}</div>
        <div>
          <div class="doc-name">${doc.full_name}</div>
          <div class="doc-spec-badge">${doc.specialty_name}</div>
          <div class="doc-rating-row">
            <span>⭐ ${doc.rating || 4.9}</span>
            <span>&bull; ${doc.experience_years || 10} yrs exp</span>
          </div>
        </div>
      </div>
      <div class="doc-bio">${doc.bio || 'Board-certified healthcare specialist.'}</div>
      <div class="doc-card-footer">
        <div class="doc-fee">₹${doc.consultation_fee || 800}</div>
        <button class="btn btn-primary btn-sm" onclick="openBookingWithDoctor(${doc.id})">Book Slot</button>
      </div>
    </div>
  `).join('');
}

/* Dashboard Renderers */
function renderNextAppointmentHero() {
  const heroCard = document.getElementById('hero-appt-container');
  if (!heroCard) return;

  const appt = state.nextAppointment;
  if (appt) {
    document.getElementById('hero-doc-name').textContent = appt.doctor_name || 'Dr. Ananya Sharma';
    document.getElementById('hero-doc-spec').textContent = appt.specialty_name || 'Cardiologist';
    document.getElementById('hero-doc-loc').textContent = appt.doctor_location || 'AIIMS New Delhi';
    document.getElementById('hero-doc-time').textContent = appt.appointment_time || '2:30 PM';
    document.getElementById('hero-doc-avatar').textContent = getInitials(appt.doctor_name);
    
    const pos = appt.queue_number || 3;
    const suffix = pos === 1 ? 'st' : (pos === 2 ? 'nd' : (pos === 3 ? 'rd' : 'th'));
    document.getElementById('hero-queue-pos').textContent = `${pos}${suffix}`;
    document.getElementById('hero-queue-wait').textContent = `~${appt.estimated_wait_mins || 18} min wait`;
  }
}

function renderDashboardStats() {
  const upcoming = state.appointments.filter(a => a.status === 'scheduled').length;
  const completed = state.appointments.filter(a => a.status === 'completed').length;
  const cancelled = state.appointments.filter(a => a.status === 'cancelled').length;

  const upEl = document.getElementById('stat-upcoming-cnt');
  const compEl = document.getElementById('stat-completed-cnt');
  const cancEl = document.getElementById('stat-cancelled-cnt');

  if (upEl) upEl.textContent = upcoming || 2;
  if (compEl) compEl.textContent = completed || 14;
  if (cancEl) cancEl.textContent = cancelled || 1;
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

function renderAppointmentsList(filter = 'all') {
  const container = document.getElementById('patient-appts-list');
  const containerAll = document.getElementById('all-patient-appts-list');

  let list = state.appointments;
  if (filter !== 'all') {
    list = list.filter(a => a.status === filter);
  }

  const html = list.map(a => {
    let statusClass = 'badge-waiting';
    let statusText = 'Waiting';
    if (a.status === 'completed') { statusClass = 'badge-completed'; statusText = 'Completed'; }
    else if (a.status === 'cancelled') { statusClass = 'badge-cancelled'; statusText = 'Cancelled'; }
    else if (a.queue_status === 'in-consultation') { statusClass = 'badge-confirmed'; statusText = 'In Consultation'; }

    const priority = a.priority_level || 3;
    const priorityBadge = getPriorityBadge(priority);

    return `
      <div class="appt-item-row">
        <div class="appt-item-left">
          <div class="row-doc-avatar">${getInitials(a.doctor_name)}</div>
          <div>
            <div class="row-doc-name">${a.doctor_name}</div>
            <div class="row-doc-spec">${a.specialty_name}</div>
          </div>
        </div>

        <div class="appt-item-middle">
          <span>📅 ${a.appointment_date}</span>
          <span>⏰ ${a.appointment_time}</span>
          <span class="badge ${priorityBadge.class}">${priorityBadge.text}</span>
        </div>

        <div class="appt-item-right">
          <span class="badge ${statusClass}">${statusText}</span>
          ${a.status === 'scheduled' ? `<button class="btn btn-outline btn-sm" onclick="openLiveQueueTrackerModal(${a.id})">Track Queue</button>` : ''}
          ${a.status === 'scheduled' ? `<button class="btn btn-outline btn-sm" style="color: #ef4444;" onclick="cancelAppointment(${a.id})">Cancel</button>` : ''}
        </div>
      </div>
    `;
  }).join('') || '<div style="padding:2rem; text-align:center; color:#64748b;">No appointments found.</div>';

  if (container) container.innerHTML = html;
  if (containerAll) containerAll.innerHTML = html;
}

function filterApptList(status) {
  document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
  if (event && event.target) event.target.classList.add('active');
  renderAppointmentsList(status);
}

/* View Switching */
function showLandingView() {
  document.getElementById('landing-view').style.display = 'block';
  document.getElementById('dashboard-view').style.display = 'none';
}

function showDashboardView() {
  if (!state.token) {
    openLoginModal();
    return;
  }
  document.getElementById('landing-view').style.display = 'none';
  document.getElementById('dashboard-view').style.display = 'flex';
}

function switchDashTab(tabId) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.dash-tab-content').forEach(el => {
    el.style.display = 'none';
    el.classList.remove('animate-fade-in');
  });

  if (event && event.currentTarget) event.currentTarget.classList.add('active');

  const targetEl = document.getElementById(`tab-${tabId}`);
  if (targetEl) {
    targetEl.style.display = 'block';
    targetEl.classList.add('animate-fade-in');
  }
}

function navigateToSection(secId) {
  showLandingView();
  const el = document.getElementById(secId);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}

/* Booking Modal Logic */
function openBookingModal() {
  if (!state.token) {
    openLoginModal();
    return;
  }
  populateBookingForm();
  document.getElementById('booking-modal').classList.add('active');
  // Trigger entrance animation
  const modalCard = document.querySelector('#booking-modal .modal-card');
  if (modalCard) {
    modalCard.style.animation = 'modalSlideIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
  }
}

function closeBookingModal() {
  const modalCard = document.querySelector('#booking-modal .modal-card');
  if (modalCard) {
    modalCard.style.animation = 'modalSlideOut 0.2s ease-in';
    setTimeout(() => {
      document.getElementById('booking-modal').classList.remove('active');
      modalCard.style.animation = '';
    }, 200);
  } else {
    document.getElementById('booking-modal').classList.remove('active');
  }
}

function populateBookingForm() {
  const specSelect = document.getElementById('book-specialty-select');
  const docSelect = document.getElementById('book-doctor-select');
  const prioritySelect = document.getElementById('book-priority-select');

  if (specSelect) {
    specSelect.innerHTML = '<option value="">All Specialties</option>' +
      state.specialties.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  }

  if (docSelect) {
    docSelect.innerHTML = '<option value="">Choose a doctor...</option>' +
      state.doctors.map(d => `<option value="${d.id}">${d.full_name} (${d.specialty_name})</option>`).join('');
  }

  if (prioritySelect) {
    prioritySelect.innerHTML = `
      <option value="3">Normal — Standard appointment</option>
      <option value="2">High — Urgent concern, needs attention soon</option>
      <option value="1">Critical — Emergency/acute symptoms</option>
      <option value="4">Low — Routine follow-up, non-urgent</option>
      <option value="5">Routine — Annual checkup, preventive care</option>
    `;
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('book-date-input');
  if (dateInput) {
    dateInput.value = todayStr;
    dateInput.min = todayStr;
  }
}

function openBookingWithDoctor(docId) {
  openBookingModal();
  const docSelect = document.getElementById('book-doctor-select');
  if (docSelect) {
    docSelect.value = docId;
    onDoctorSelectChange();
  }
}

function openBookingWithSpecialty(specId) {
  openBookingModal();
  const specSelect = document.getElementById('book-specialty-select');
  if (specSelect) {
    specSelect.value = specId;
    onSpecialtySelectChange();
  }
}

function onSpecialtySelectChange() {
  const specId = document.getElementById('book-specialty-select').value;
  const docSelect = document.getElementById('book-doctor-select');
  
  let filteredDocs = state.doctors;
  if (specId) {
    filteredDocs = state.doctors.filter(d => d.specialty_id == specId);
  }

  docSelect.innerHTML = '<option value="">Choose a doctor...</option>' +
    filteredDocs.map(d => `<option value="${d.id}">${d.full_name} (${d.specialty_name})</option>`).join('');
}

async function onDoctorSelectChange() {
  state.selectedDoctor = document.getElementById('book-doctor-select').value;
  await fetchAvailableSlots();
}

async function onBookingDateChange() {
  state.selectedDate = document.getElementById('book-date-input').value;
  await fetchAvailableSlots();
}

async function fetchAvailableSlots() {
  const docId = document.getElementById('book-doctor-select').value;
  const dateVal = document.getElementById('book-date-input').value;
  const grid = document.getElementById('book-slots-grid');

  if (!docId || !dateVal) {
    grid.innerHTML = '<div class="slots-empty-lbl">Please select a doctor and date</div>';
    return;
  }

  try {
    const res = await fetch(`/api/appointments/slots/${docId}/${dateVal}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    const slots = data.slots || [];

    if (slots.length === 0) {
      grid.innerHTML = '<div class="slots-empty-lbl">No available slots for this date.</div>';
      return;
    }

    grid.innerHTML = slots.map(s => `
      <button type="button" class="slot-btn" onclick="selectSlot('${s}', this)">${s}</button>
    `).join('');
  } catch (err) {
    grid.innerHTML = '<div class="slots-empty-lbl">Error fetching slots.</div>';
  }
}

function selectSlot(timeStr, btnEl) {
  document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
  btnEl.classList.add('selected');
  state.selectedSlot = timeStr;
}

async function submitAppointmentBooking() {
  const doctor_id = document.getElementById('book-doctor-select').value;
  const appointment_date = document.getElementById('book-date-input').value;
  const appointment_time = state.selectedSlot;
  const notes = document.getElementById('book-notes-input').value;
  const priority_level = parseInt(document.getElementById('book-priority-select').value);
  const priority_reason = notes;

  if (!doctor_id || !appointment_date || !appointment_time) {
    alert('Please select a doctor, date, and time slot.');
    return;
  }

  try {
    const res = await fetch('/api/appointments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ doctor_id, appointment_date, appointment_time, notes, priority_level, priority_reason })
    });

    const data = await res.json();
    if (res.ok) {
      alert('🎉 Appointment booked successfully!');
      closeBookingModal();
      await fetchNextAppointment();
      await fetchPatientAppointments();
      showDashboardView();
    } else {
      alert(data.error || 'Failed to book appointment.');
    }
  } catch (err) {
    console.error('Booking error:', err);
    alert('Server error while booking.');
  }
}

async function cancelAppointment(apptId) {
  if (!confirm('Are you sure you want to cancel this appointment?')) return;
  try {
    const res = await fetch(`/api/appointments/${apptId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ status: 'cancelled' })
    });
    if (res.ok) {
      await fetchNextAppointment();
      await fetchPatientAppointments();
    }
  } catch (err) {
    console.error('Cancel appt error:', err);
  }
}

/* Queue Modal Logic */
function openLiveQueueTrackerModal(apptId) {
  const modal = document.getElementById('queue-modal');
  modal.classList.add('active');

  const appt = state.nextAppointment || state.appointments[0];
  if (appt) {
    const pos = appt.queue_number || 3;
    const suffix = pos === 1 ? 'st' : (pos === 2 ? 'nd' : (pos === 3 ? 'rd' : 'th'));
    document.getElementById('qmodal-pos').textContent = `${pos}${suffix}`;
    document.getElementById('qmodal-doc').textContent = appt.doctor_name || 'Dr. Ananya Sharma';
    document.getElementById('qmodal-spec').textContent = appt.specialty_name || 'Cardiology';
    document.getElementById('qmodal-wait').textContent = `~${appt.estimated_wait_mins || 18} minutes`;
    document.getElementById('qmodal-loc').textContent = appt.doctor_location || 'AIIMS New Delhi (Room 302)';
  }
}

function closeQueueModal() {
  document.getElementById('queue-modal').classList.remove('active');
}

/* Login Modal Logic */
function openLoginModal() {
  document.getElementById('login-modal').classList.add('active');
}

function closeLoginModal() {
  document.getElementById('login-modal').classList.remove('active');
}

async function handlePatientLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (res.ok && data.token) {
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('mo_patient_token', data.token);
      closeLoginModal();
      updateUIState(true);
      await fetchNextAppointment();
      await fetchPatientAppointments();
      showDashboardView();
    } else {
      alert(data.error || 'Login failed.');
    }
  } catch (err) {
    console.error('Login error:', err);
    alert('Server error logging in.');
  }
}

async function quickLoginDemo(email, password) {
  document.getElementById('login-email').value = email;
  document.getElementById('login-password').value = password;
  const fakeEvent = { preventDefault: () => {} };
  await handlePatientLogin(fakeEvent);
}

function logoutPatient() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('mo_patient_token');
  updateUIState(false);
  showLandingView();
}

/* Motion Animation Utilities - using window.Motion from UMD bundle */

function animateFadeIn(el, delay = 0) {
  return animateMotion(el, [
    { opacity: 0, transform: 'translateY(16px)' },
    { opacity: 1, transform: 'translateY(0)' }
  ], { duration: 400, delay });
}

function animateSlideIn(el, from = 'right', delay = 0) {
  const transforms = {
    right: 'translateX(24px)',
    left: 'translateX(-24px)',
    up: 'translateY(24px)',
    down: 'translateY(-24px)'
  };
  return animateMotion(el, [
    { opacity: 0, transform: transforms[from] },
    { opacity: 1, transform: 'translateX(0) translateY(0)' }
  ], { duration: 350, delay });
}

function animateQueuePositionChange(el, oldPos, newPos) {
  if (!el) return Promise.resolve();
  const direction = newPos < oldPos ? 'up' : 'down';
  const distance = Math.abs(newPos - oldPos) * 48;
  return animateMotion(el, [
    { transform: `translateY(${direction === 'up' ? -distance : distance}px)`, opacity: 0.5 },
    { transform: 'translateY(0)', opacity: 1 }
  ], { duration: 500 });
}

function animatePriorityPulse(el, priorityLevel) {
  if (!el) return Promise.resolve();
  const colors = {
    1: '#dc2626', // Critical
    2: '#ea580c', // Urgent
    3: '#2563eb', // Normal
    4: '#64748b', // Low
    5: '#94a3b8'  // Routine
  };
  const color = colors[priorityLevel] || colors[3];
  return animateMotion(el, [
    { boxShadow: `0 0 0 0 ${color}80` },
    { boxShadow: `0 0 0 12px ${color}00` }
  ], { duration: 1000 });
}

function animateStatusChange(el, newStatus) {
  if (!el) return Promise.resolve();
  return animateMotion(el, [
    { transform: 'scale(0.95)', opacity: 0.7 },
    { transform: 'scale(1.02)', opacity: 1 },
    { transform: 'scale(1)', opacity: 1 }
  ], { duration: 400 });
}

/* Real-time Queue Updates (SSE) */
let queueEventSource = null;
let lastKnownQueue = null;

function startQueueStream(apptId) {
  stopQueueStream();

  if (!state.token || !apptId) return;

  // EventSource cannot set Authorization header; pass token as query param
  const url = `/api/appointments/${apptId}/stream?token=${encodeURIComponent(state.token)}`;
  queueEventSource = new EventSource(url);

  queueEventSource.addEventListener('appointment-update', (e) => {
    try {
      const appointment = JSON.parse(e.data);
      handleQueueUpdate(appointment);
    } catch (err) {
      console.error('SSE parse error:', err);
    }
  });

  queueEventSource.onerror = () => {
    // Silent fail - will auto-reconnect per retry: 3000
  };
}

function stopQueueStream() {
  if (queueEventSource) {
    queueEventSource.close();
    queueEventSource = null;
  }
  lastKnownQueue = null;
}

function handleQueueUpdate(appointment) {
  if (lastKnownQueue && appointment.queue_number !== lastKnownQueue.queue_number) {
    // Queue position changed - animate
    const posEl = document.getElementById('qmodal-pos');
    if (posEl) {
      animateQueuePositionChange(posEl, lastKnownQueue.queue_number, appointment.queue_number);
    }

    // Update wait time display
    const waitEl = document.getElementById('qmodal-wait');
    if (waitEl) {
      waitEl.textContent = `~${appointment.estimated_wait_mins || 0} minutes`;
      animatePriorityPulse(waitEl, appointment.priority_level || 3);
    }

    // Update progress bar
    const progressEl = document.querySelector('.queue-progress-bar-fill');
    if (progressEl && appointment.queue_number) {
      const progress = Math.min(90, Math.max(10, 100 - (appointment.queue_number * 15)));
      animateMotion(progressEl, [
        { width: `${progressEl.style.width || '0%'}` },
        { width: `${progress}%` }
      ], { duration: 600 });
    }
  }

  lastKnownQueue = appointment;
  updateHeroQueueDisplay(appointment);
}

function updateHeroQueueDisplay(appointment) {
  const posEl = document.getElementById('hero-queue-pos');
  const waitEl = document.getElementById('hero-queue-wait');

  if (posEl && appointment.queue_number) {
    const pos = appointment.queue_number;
    const suffix = pos === 1 ? 'st' : (pos === 2 ? 'nd' : (pos === 3 ? 'rd' : 'th'));
    posEl.textContent = `${pos}${suffix}`;
  }

  if (waitEl && appointment.estimated_wait_mins !== undefined) {
    waitEl.textContent = `~${appointment.estimated_wait_mins} min wait`;
  }
}

/* Enhanced Queue Modal with Live Updates (SSE) */
function openLiveQueueTrackerModal(apptId) {
  const modal = document.getElementById('queue-modal');
  modal.classList.add('active');

  const modalCard = modal.querySelector('.modal-card');
  if (modalCard) {
    animateMotion(modalCard, [
      { opacity: 0, transform: 'scale(0.95) translateY(8px)' },
      { opacity: 1, transform: 'scale(1) translateY(0)' }
    ], { duration: 300 });
  }

  const appt = state.nextAppointment || state.appointments.find(a => a.id === apptId) || state.appointments[0];
  if (appt) {
    lastKnownQueue = appt;
    const pos = appt.queue_number || 3;
    const suffix = pos === 1 ? 'st' : (pos === 2 ? 'nd' : (pos === 3 ? 'rd' : 'th'));
    document.getElementById('qmodal-pos').textContent = `${pos}${suffix}`;
    document.getElementById('qmodal-doc').textContent = appt.doctor_name || 'Dr. Ananya Sharma';
    document.getElementById('qmodal-spec').textContent = appt.specialty_name || 'Cardiology';
    document.getElementById('qmodal-wait').textContent = `~${appt.estimated_wait_mins || 18} minutes`;
    document.getElementById('qmodal-loc').textContent = appt.doctor_location || 'AIIMS New Delhi (Room 302)';

    // Update progress bar
    const progressEl = document.querySelector('.queue-progress-bar-fill');
    if (progressEl && appt.queue_number) {
      const progress = Math.min(90, Math.max(10, 100 - (appt.queue_number * 15)));
      progressEl.style.width = `${progress}%`;
    }

    // Start SSE stream
    startQueueStream(appt.id);
  }
}

function closeQueueModal() {
  const modalCard = document.querySelector('#queue-modal .modal-card');
  if (modalCard) {
    animateMotion(modalCard, [
      { opacity: 1, transform: 'scale(1) translateY(0)' },
      { opacity: 0, transform: 'scale(0.95) translateY(8px)' }
    ], { duration: 200 }).then(() => {
      document.getElementById('queue-modal').classList.remove('active');
      stopQueueStream();
    });
  } else {
    document.getElementById('queue-modal').classList.remove('active');
    stopQueueStream();
  }
}

/* Enhanced Dashboard Tab Switching with Animation */
function switchDashTab(tabId) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  if (event && event.currentTarget) event.currentTarget.classList.add('active');

  const tabs = document.querySelectorAll('.dash-tab-content');
  tabs.forEach(el => {
    if (el.style.display === 'block') {
      animateMotion(el, [
        { opacity: 1, transform: 'translateX(0)' },
        { opacity: 0, transform: 'translateX(-16px)' }
      ], { duration: 200 }).then(() => {
        el.style.display = 'none';
      });
    } else {
      el.style.display = 'none';
      el.style.opacity = '0';
      el.style.transform = 'translateX(16px)';
    }
  });

  const targetEl = document.getElementById(`tab-${tabId}`);
  if (targetEl) {
    targetEl.style.display = 'block';
    // Force reflow
    targetEl.offsetHeight;
    animateMotion(targetEl, [
      { opacity: 0, transform: 'translateX(16px)' },
      { opacity: 1, transform: 'translateX(0)' }
    ], { duration: 300 });
  }
}

/* Landing Section Navigation with Smooth Scroll */
function navigateToSection(secId) {
  showLandingView();
  const el = document.getElementById(secId);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth' });
  }
}

/* Page View Transitions */
function showLandingView() {
  const landing = document.getElementById('landing-view');
  const dashboard = document.getElementById('dashboard-view');

  if (dashboard.style.display !== 'none') {
    animateMotion(dashboard, [
      { opacity: 1, transform: 'translateX(0)' },
      { opacity: 0, transform: 'translateX(-24px)' }
    ], { duration: 250 }).then(() => {
      dashboard.style.display = 'none';
      landing.style.display = 'block';
      landing.style.opacity = '0';
      landing.style.transform = 'translateX(24px)';
      animateMotion(landing, [
        { opacity: 0, transform: 'translateX(24px)' },
        { opacity: 1, transform: 'translateX(0)' }
      ], { duration: 300 });
    });
  } else {
    landing.style.display = 'block';
  }
}

function showDashboardView() {
  if (!state.token) {
    openLoginModal();
    return;
  }

  const landing = document.getElementById('landing-view');
  const dashboard = document.getElementById('dashboard-view');

  if (landing.style.display !== 'none') {
    animateMotion(landing, [
      { opacity: 1, transform: 'translateX(0)' },
      { opacity: 0, transform: 'translateX(24px)' }
    ], { duration: 250 }).then(() => {
      landing.style.display = 'none';
      dashboard.style.display = 'flex';
      dashboard.style.opacity = '0';
      dashboard.style.transform = 'translateX(-24px)';
      animateMotion(dashboard, [
        { opacity: 0, transform: 'translateX(-24px)' },
        { opacity: 1, transform: 'translateX(0)' }
      ], { duration: 300 });
    });
  } else {
    dashboard.style.display = 'flex';
  }
}

/* ============================================================
   CHATBOT WIDGET - Health Assistant
   ============================================================ */

let chatbotState = {
  isOpen: false,
  messages: [],
  isLoading: false
};

function toggleChatbot() {
  const panel = document.getElementById('chatbot-panel');
  const btn = document.getElementById('chatbot-float-btn');

  if (!panel || !btn) return;

  chatbotState.isOpen = !chatbotState.isOpen;

  if (chatbotState.isOpen) {
    panel.style.display = 'flex';
    btn.classList.add('active');
    btn.setAttribute('aria-expanded', 'true');
    // Focus input after animation
    setTimeout(() => {
      const input = document.getElementById('chatbot-input');
      if (input) input.focus();
    }, 300);

    // Initialize welcome message if empty
    if (chatbotState.messages.length === 0) {
      initializeChatbot();
    }
  } else {
    panel.style.display = 'none';
    btn.classList.remove('active');
    btn.setAttribute('aria-expanded', 'false');
  }
}

function initializeChatbot() {
  // Welcome message is already in HTML, just add to state
  chatbotState.messages.push({
    role: 'assistant',
    content: `Hello! I'm your Swasthya Saarthi Health Assistant. 👋

I can help you with:
- 🩺 General health questions & medical term explanations
- 🏥 Finding the right specialist for your symptoms
- 📱 Using Swasthya Saarthi (booking, queue tracking, reports)
- 📋 Preparing for doctor visits (organizing symptoms)
- 🌿 Wellness & prevention tips

**For appointment/queue specifics**, I'll need your appointment details.

**For health concerns**, please remember: I'm an AI assistant, not a doctor. I cannot diagnose or prescribe.

What would you like help with today?

---
⚠️ I am an AI assistant, not a doctor. This information is for educational purposes only. Please consult a healthcare professional for medical advice, diagnosis, or treatment.`,
    timestamp: new Date().toISOString()
  });
}

async function sendChatbotMessage(e) {
  e.preventDefault();

  const input = document.getElementById('chatbot-input');
  const message = input.value.trim();

  if (!message || chatbotState.isLoading) return;

  // Add user message to UI
  addChatbotMessage('user', message);
  chatbotState.messages.push({ role: 'user', content: message, timestamp: new Date().toISOString() });

  // Clear input
  input.value = '';

  // Show typing indicator
  showChatbotTyping(true);
  chatbotState.isLoading = true;

  try {
    const res = await fetch('/api/chatbot/message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({
        message,
        conversationHistory: chatbotState.messages.slice(-10) // Last 10 messages for context
      })
    });

    const data = await res.json();

    showChatbotTyping(false);
    chatbotState.isLoading = false;

    if (res.ok) {
      addChatbotMessage('bot', data.response, data.emergency);
      chatbotState.messages.push({
        role: 'assistant',
        content: data.response,
        emergency: data.emergency,
        timestamp: data.timestamp
      });

      // Scroll to bottom
      scrollChatbotMessages();
    } else {
      showToast('Error', data.error || 'Failed to get response', 'error');
      // Add fallback message
      addChatbotMessage('bot', "I'm having trouble connecting right now. Please try again in a moment, or contact support if the issue persists.");
    }
  } catch (err) {
    console.error('Chatbot error:', err);
    showChatbotTyping(false);
    chatbotState.isLoading = false;
    showToast('Error', 'Server error. Please try again.', 'error');
    addChatbotMessage('bot', "I'm having trouble connecting right now. Please try again in a moment, or contact support if the issue persists.");
  }
}

function addChatbotMessage(role, content, isEmergency = false) {
  const container = document.getElementById('chatbot-messages');
  if (!container) return;

  // Remove welcome message if it exists
  const welcomeMsg = container.querySelector('.chatbot-welcome-message');
  if (welcomeMsg) {
    welcomeMsg.remove();
  }

  const msgDiv = document.createElement('div');
  msgDiv.className = `chatbot-message ${role}`;

  const avatar = role === 'bot' ? '🤖' : getInitials(state.user?.full_name || 'You');

  // Format content (basic markdown-like)
  const formattedContent = formatChatbotMessage(content);

  const emergencyClass = isEmergency ? ' chatbot-emergency' : '';

  msgDiv.innerHTML = `
    <div class="chatbot-message-avatar">${avatar}</div>
    <div class="chatbot-message-content${emergencyClass}">
      ${formattedContent}
    </div>
  `;

  container.appendChild(msgDiv);
  scrollChatbotMessages();
}

function formatChatbotMessage(text) {
  if (!text) return '';

  // Escape HTML
  let html = text
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>');

  // Convert markdown-style formatting
  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  // Bullet points
  html = html.replace(/^• (.*$)/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

  return html;
}

function scrollChatbotMessages() {
  const container = document.getElementById('chatbot-messages');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

function showChatbotTyping(show) {
  const indicator = document.getElementById('chatbot-typing-indicator');
  if (indicator) {
    indicator.style.display = show ? 'flex' : 'none';
  }
  if (show) {
    scrollChatbotMessages();
  }
}

function clearChatbotHistory() {
  if (!confirm('Clear conversation history?')) return;

  chatbotState.messages = [];

  const container = document.getElementById('chatbot-messages');
  if (container) {
    container.innerHTML = '';
    // Re-add welcome message
    container.innerHTML = `
      <div class="chatbot-welcome-message">
        <div class="chatbot-message bot">
          <div class="chatbot-message-avatar">🤖</div>
          <div class="chatbot-message-content">
            <div class="chatbot-message-text">Hello! I'm your Swasthya Saarthi Health Assistant. 👋</div>
            <div class="chatbot-message-text">I can help you with:</div>
            <ul class="chatbot-capabilities">
              <li>🩺 General health questions & medical term explanations</li>
              <li>🏥 Finding the right specialist for your symptoms</li>
              <li>📱 Using Swasthya Saarthi (booking, queue tracking, reports)</li>
              <li>📋 Preparing for doctor visits (organizing symptoms)</li>
              <li>🌿 Wellness & prevention tips</li>
            </ul>
            <div class="chatbot-disclaimer">⚠️ I am an AI assistant, not a doctor. This information is for educational purposes only. Please consult a healthcare professional for medical advice, diagnosis, or treatment.</div>
          </div>
        </div>
      </div>
    `;
  }

  showToast('Cleared', 'Conversation history cleared.', 'info');
}

// Handle Enter key in chatbot input
document.addEventListener('keydown', (e) => {
  const input = document.getElementById('chatbot-input');
  if (input && document.activeElement === input && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const form = document.getElementById('chatbot-form');
    if (form) form.dispatchEvent(new Event('submit'));
  }
});
