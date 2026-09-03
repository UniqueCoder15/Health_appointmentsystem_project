// Swasthya Saarthi Admin Portal Application Logic

let state = {
  token: localStorage.getItem('mo_admin_token') || null,
  stats: null,
  doctors: [],
  appointments: [],
  specialties: [],
  abuseThresholds: [],
  flaggedUsers: [],
  activeSuspensions: []
};

let adminEventSource = null;

function startAdminSSE() {
  stopAdminSSE();
  if (!state.token) return;

  const url = `/api/admin/stream?token=${encodeURIComponent(state.token)}`;
  adminEventSource = new EventSource(url);

  adminEventSource.addEventListener('overview-update', (e) => {
    try {
      const data = JSON.parse(e.data);
      handleAdminNotification(data);
    } catch (err) {
      console.error('Admin SSE parse error:', err);
    }
  });

  adminEventSource.onerror = () => {
    // Auto-reconnect via retry header
  };
}

function stopAdminSSE() {
  if (adminEventSource) {
    adminEventSource.close();
    adminEventSource = null;
  }
}

function handleAdminNotification(data) {
  console.log('Admin notification:', data);

  switch (data.type) {
    case 'abuse-flag-raised':
      showToast('⚠️ Abuse Flag Raised', `Patient ${data.userName} flagged for ${data.metric}: ${data.count}/${data.threshold}`, 'warning');
      fetchAbuseData();
      break;
    case 'user-suspended':
      showToast('🔒 User Suspended', `${data.userName} suspended (${data.suspensionType})`, 'error');
      fetchAbuseData();
      break;
    case 'user-unsuspended':
      showToast('🔓 Suspension Lifted', `${data.userName} suspension lifted`, 'success');
      fetchAbuseData();
      break;
    case 'report-uploaded':
      showToast('📄 New Report', `Report uploaded by ${data.userName}`, 'info');
      break;
    case 'symptom-assessment-completed':
      showToast('🩺 Assessment Completed', `${data.userName} completed symptom assessment`, 'info');
      break;
    case 'abha-linked':
      showToast('🆔 ABHA Linked', `Patient ${data.userName} linked ABHA ID: ${data.abhaId}`, 'info');
      break;
    case 'appointment-changed':
      // Refresh appointments when queue changes
      fetchAdminAppointments();
      break;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initAdmin();
});

async function initAdmin() {
  if (state.token) {
    await fetchAdminData();
    startAdminSSE();
  } else {
    openAdminLoginModal();
  }
}

async function fetchAdminData() {
  await fetchStats();
  await fetchAdminDoctors();
  await fetchAdminAppointments();
  await fetchAdminSpecialties();
  await fetchAbuseData();
}

async function fetchStats() {
  try {
    const res = await fetch('/api/admin/stats', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      state.stats = data.stats;
      document.getElementById('admin-stat-patients').textContent = data.stats.total_patients || 120;
      document.getElementById('admin-stat-doctors').textContent = data.stats.total_doctors || 5;
      document.getElementById('admin-stat-scheduled').textContent = data.stats.upcoming_appointments || 16;
    } else {
      logoutAdmin();
    }
  } catch (err) {
    console.error('Fetch admin stats error:', err);
  }
}

async function fetchAdminDoctors() {
  try {
    const res = await fetch('/api/doctors');
    const data = await res.json();
    state.doctors = data.doctors || [];
    renderDoctorList();
  } catch (err) {
    console.error('Fetch doctors error:', err);
  }
}

async function fetchAdminAppointments() {
  try {
    const res = await fetch('/api/appointments', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      state.appointments = data.appointments || [];
      renderAdminAppointments();
    }
  } catch (err) {
    console.error('Fetch admin appts error:', err);
  }
}

async function fetchAdminSpecialties() {
  try {
    const res = await fetch('/api/specialties');
    const data = await res.json();
    state.specialties = data.specialties || [];
    renderSpecialtiesGrid();
    populateSpecialtiesDropdown();
  } catch (err) {
    console.error('Fetch admin specialties error:', err);
  }
}

function renderDoctorList() {
  const container = document.getElementById('admin-doctor-list');
  if (!container) return;

  container.innerHTML = state.doctors.map(d => `
    <div class="appt-item-row">
      <div class="appt-item-left">
        <div class="row-doc-avatar">${d.specialty_icon || '👨‍⚕️'}</div>
        <div>
          <div class="row-doc-name">${d.full_name}</div>
          <div class="row-doc-spec">${d.specialty_name} &bull; Fee: ₹${d.consultation_fee}</div>
        </div>
      </div>

      <div class="appt-item-middle">
        <span>📍 ${d.location || 'Downtown Medical Center'}</span>
        <span>⭐ ${d.rating || 4.9}</span>
      </div>

      <div class="appt-item-right">
        <button class="btn btn-outline btn-sm" onclick="deleteDoctor(${d.id})">Delete</button>
      </div>
    </div>
  `).join('');
}

function renderAdminAppointments() {
  const recentContainer = document.getElementById('admin-recent-appts');
  const allContainer = document.getElementById('admin-all-appts-list');

  const html = state.appointments.map(a => `
    <div class="appt-item-row">
      <div class="appt-item-left">
        <div class="row-doc-avatar">${a.patient_name ? a.patient_name.substring(0,2).toUpperCase() : 'AJ'}</div>
        <div>
          <div class="row-doc-name">Patient: ${a.patient_name}</div>
          <div class="row-doc-spec">Doctor: ${a.doctor_name} (${a.specialty_name})</div>
        </div>
      </div>

      <div class="appt-item-middle">
        <span>📅 ${a.appointment_date} ${a.appointment_time}</span>
        <span>Queue #${a.queue_number || 1}</span>
      </div>

      <div class="appt-item-right">
        <span class="badge ${a.status === 'completed' ? 'badge-completed' : (a.status === 'cancelled' ? 'badge-cancelled' : 'badge-waiting')}">${a.status}</span>
        <button class="btn btn-outline btn-sm" style="color:#ef4444;" onclick="deleteApptAdmin(${a.id})">Delete</button>
      </div>
    </div>
  `).join('');

  if (recentContainer) recentContainer.innerHTML = html;
  if (allContainer) allContainer.innerHTML = html;
}

function renderSpecialtiesGrid() {
  const grid = document.getElementById('admin-specialties-grid');
  if (!grid) return;

  grid.innerHTML = state.specialties.map(s => `
    <div class="specialty-card">
      <div class="specialty-icon">${s.icon || '🩺'}</div>
      <div class="specialty-title">${s.name}</div>
      <div class="specialty-count">${s.doctor_count || 0} active doctors</div>
    </div>
  `).join('');
}

function populateSpecialtiesDropdown() {
  const sel = document.getElementById('new-doc-specialty');
  if (sel) {
    sel.innerHTML = state.specialties.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  }
}

function openAddDoctorModal() {
  document.getElementById('add-doctor-modal').classList.add('active');
}

function closeAddDoctorModal() {
  document.getElementById('add-doctor-modal').classList.remove('active');
}

async function deleteDoctor(id) {
  if (!confirm('Are you sure you want to delete this doctor?')) return;
  try {
    const res = await fetch(`/api/doctors/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      await fetchAdminDoctors();
    }
  } catch (err) {
    console.error('Delete doc error:', err);
  }
}

async function deleteApptAdmin(id) {
  if (!confirm('Delete appointment?')) return;
  try {
    const res = await fetch(`/api/appointments/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      await fetchAdminAppointments();
    }
  } catch (err) {
    console.error('Delete appt error:', err);
  }
}

function switchAdminTab(tabId) {
  document.querySelectorAll('.dash-tab-content').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  if (event && event.currentTarget) event.currentTarget.classList.add('active');

  if (tabId === 'admin-analytics') {
    document.getElementById('tab-admin-analytics').style.display = 'block';
  } else if (tabId === 'admin-priority') {
    document.getElementById('tab-admin-priority').style.display = 'block';
    loadPriorityConfig();
  } else if (tabId === 'admin-doctors') {
    document.getElementById('tab-admin-doctors').style.display = 'block';
  } else if (tabId === 'admin-appointments') {
    document.getElementById('tab-admin-appointments').style.display = 'block';
  } else if (tabId === 'admin-specialties') {
    document.getElementById('tab-admin-specialties').style.display = 'block';
  } else if (tabId === 'admin-abuse') {
    document.getElementById('tab-admin-abuse').style.display = 'block';
    fetchAbuseData();
  }
}

// Priority Configuration Functions
async function loadPriorityConfig() {
  await Promise.all([
    fetchPriorityLevels(),
    fetchPriorityWeights(),
    fetchAcuityRules(),
    renderPriorityDistribution()
  ]);
  setupPreviewListeners();
}

async function fetchPriorityLevels() {
  try {
    const res = await fetch('/api/admin/priority/levels', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      renderPriorityLevels(data.levels);
    }
  } catch (err) {
    console.error('Fetch priority levels error:', err);
    // Fallback to defaults
    renderPriorityLevels(getDefaultPriorityLevels());
  }
}

function getDefaultPriorityLevels() {
  return [
    { level: 1, name: 'Critical', icon: '🚨', baseScore: 880, description: 'Life-threatening emergencies' },
    { level: 2, name: 'Urgent', icon: '⚡', baseScore: 760, description: 'Requires attention within 15-30 min' },
    { level: 3, name: 'Normal', icon: '🟢', baseScore: 640, description: 'Standard walk-in / scheduled' },
    { level: 4, name: 'Low', icon: '🔵', baseScore: 520, description: 'Routine follow-ups, non-urgent' },
    { level: 5, name: 'Routine', icon: '⚪', baseScore: 400, description: 'Annual checkups, preventive' }
  ];
}

function renderPriorityLevels(levels) {
  const container = document.getElementById('priority-levels-table');
  if (!container) return;

  container.innerHTML = `
    <table class="priority-table">
      <thead>
        <tr>
          <th>Level</th>
          <th>Name</th>
          <th>Icon</th>
          <th>Base Score</th>
          <th>Description</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${levels.map(l => `
          <tr>
            <td><strong>${l.level}</strong></td>
            <td>${l.name}</td>
            <td>${l.icon}</td>
            <td><input type="number" class="form-input form-input-sm" value="${l.baseScore}" min="0" max="2000" data-level="${l.level}" onchange="updatePriorityBaseScore(${l.level}, this.value)"></td>
            <td>${l.description}</td>
            <td><button class="btn btn-outline btn-sm" onclick="resetPriorityLevel(${l.level})">Reset</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function fetchPriorityWeights() {
  try {
    const res = await fetch('/api/admin/priority/weights', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      document.getElementById('weight-base').value = data.weights?.base || 1.0;
      document.getElementById('weight-wait').value = data.weights?.wait || 0.5;
      document.getElementById('weight-fairness').value = data.weights?.fairness || 2.0;
      document.getElementById('weight-acuity').value = data.weights?.acuity || 100;
    }
  } catch (err) {
    console.error('Fetch priority weights error:', err);
  }
}

async function fetchAcuityRules() {
  try {
    const res = await fetch('/api/admin/priority/acuity', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      Object.entries(data.rules || {}).forEach(([level, score]) => {
        const input = document.querySelector(`.acuity-rule-row[data-level="${level}"] input`);
        if (input) input.value = score;
      });
    }
  } catch (err) {
    console.error('Fetch acuity rules error:', err);
  }
}

function setupPreviewListeners() {
  ['preview-priority-level', 'preview-queue-pos', 'preview-wait-mins', 'preview-acuity'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', updatePreviewScore);
      el.addEventListener('input', updatePreviewScore);
    }
  });
  updatePreviewScore();
}

function updatePreviewScore() {
  const level = parseInt(document.getElementById('preview-priority-level').value) || 3;
  const queuePos = parseInt(document.getElementById('preview-queue-pos').value) || 1;
  const waitMins = parseInt(document.getElementById('preview-wait-mins').value) || 0;
  const acuity = parseInt(document.getElementById('preview-acuity').value) || 100;

  // Simulate the priority engine computation
  const baseWeights = {
    base: parseFloat(document.getElementById('weight-base').value) || 1.0,
    wait: parseFloat(document.getElementById('weight-wait').value) || 0.5,
    fairness: parseFloat(document.getElementById('weight-fairness').value) || 2.0,
    acuity: parseFloat(document.getElementById('weight-acuity').value) || 100
  };

  // Base score calculation: 1000 - (level * 120 * baseWeight)
  const baseScore = 1000 - (level * 120 * baseWeights.base);

  // Wait bonus: min(waitMins * waitWeight, 200)
  const waitBonus = Math.min(waitMins * baseWeights.wait, 200);

  // Fairness penalty: -queuePos * fairnessWeight
  const fairness = -queuePos * baseWeights.fairness;

  // Acuity bonus: acuity * (acuityWeight / 100)
  const acuityBonus = acuity * (baseWeights.acuity / 100);

  const totalScore = Math.round(baseScore + waitBonus + fairness + acuityBonus);

  document.getElementById('preview-score-value').textContent = totalScore;

  const breakdown = document.getElementById('preview-breakdown');
  breakdown.innerHTML = `
    <div class="breakdown-row"><span>Base Score (Level ${level})</span><span>${Math.round(baseScore)}</span></div>
    <div class="breakdown-row"><span>Wait Bonus (${waitMins}min × ${baseWeights.wait})</span><span>+${waitBonus}</span></div>
    <div class="breakdown-row"><span>Fairness (Pos ${queuePos} × -${baseWeights.fairness})</span><span>${fairness}</span></div>
    <div class="breakdown-row"><span>Acuity Bonus (${acuity} × ${baseWeights.acuity/100})</span><span>+${acuityBonus}</span></div>
    <div class="breakdown-row total"><span>Total</span><span><strong>${totalScore}</strong></span></div>
  `;
}

async function savePriorityWeights() {
  const weights = {
    base: parseFloat(document.getElementById('weight-base').value) || 1.0,
    wait: parseFloat(document.getElementById('weight-wait').value) || 0.5,
    fairness: parseFloat(document.getElementById('weight-fairness').value) || 2.0,
    acuity: parseFloat(document.getElementById('weight-acuity').value) || 100
  };

  try {
    const res = await fetch('/api/admin/priority/weights', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify(weights)
    });
    if (res.ok) {
      showToast('Success', 'Priority weights saved successfully');
      updatePreviewScore();
    } else {
      showToast('Error', 'Failed to save weights');
    }
  } catch (err) {
    console.error('Save weights error:', err);
    showToast('Error', 'Server error');
  }
}

async function saveAcuityRules() {
  const rules = {};
  document.querySelectorAll('.acuity-rule-row').forEach(row => {
    const level = row.dataset.level;
    const input = row.querySelector('input');
    if (input) {
      rules[level] = parseInt(input.value) || 0;
    }
  });

  try {
    const res = await fetch('/api/admin/priority/acuity', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify(rules)
    });
    if (res.ok) {
      showToast('Success', 'Acuity rules saved successfully');
    } else {
      showToast('Error', 'Failed to save acuity rules');
    }
  } catch (err) {
    console.error('Save acuity error:', err);
    showToast('Error', 'Server error');
  }
}

function updatePriorityBaseScore(level, score) {
  // In a real implementation, this would update via API
  console.log(`Update priority level ${level} base score to ${score}`);
}

function resetPriorityLevel(level) {
  const defaults = getDefaultPriorityLevels();
  const defaultLevel = defaults.find(l => l.level === level);
  if (defaultLevel) {
    const input = document.querySelector(`.priority-table input[data-level="${level}"]`);
    if (input) {
      input.value = defaultLevel.baseScore;
    }
  }
}

async function renderPriorityDistribution() {
  try {
    const res = await fetch('/api/admin/priority/distribution', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      renderDistributionChart(data.distribution);
    }
  } catch (err) {
    console.error('Fetch distribution error:', err);
    // Render mock data for demo
    renderDistributionChart([
      { level: 1, name: 'Critical', count: 2, color: '#ef4444' },
      { level: 2, name: 'Urgent', count: 8, color: '#f97316' },
      { level: 3, name: 'Normal', count: 25, color: '#22c55e' },
      { level: 4, name: 'Low', count: 10, color: '#3b82f6' },
      { level: 5, name: 'Routine', count: 5, color: '#64748b' }
    ]);
  }
}

function renderDistributionChart(distribution) {
  const container = document.getElementById('distribution-chart');
  if (!container) return;

  const total = distribution.reduce((sum, d) => sum + (d.count || 0), 0);

  container.innerHTML = `
    <div class="distribution-bars">
      ${distribution.map(d => {
        const pct = total > 0 ? ((d.count || 0) / total * 100).toFixed(1) : 0;
        return `
          <div class="distribution-bar-row">
            <div class="dist-bar-label">
              <span class="badge" style="background: ${d.color}; color: white;">${d.icon || getPriorityIcon(d.level)} ${d.name}</span>
              <span>${d.count || 0}</span>
            </div>
            <div class="dist-bar-track">
              <div class="dist-bar-fill" style="width: ${pct}%; background: ${d.color};"></div>
            </div>
            <div class="dist-bar-pct">${pct}%</div>
          </div>
        `;
      }).join('')}
    </div>
    <div class="distribution-total">Total patients in queue: ${total}</div>
  `;
}

function getPriorityIcon(level) {
  const icons = { 1: '🚨', 2: '⚡', 3: '🟢', 4: '🔵', 5: '⚪' };
  return icons[level] || '🟢';
}

// Toast helper
function showToast(title, message) {
  const container = document.getElementById('toast-container') || (() => {
    const c = document.createElement('div');
    c.id = 'toast-container';
    c.className = 'toast-container';
    document.body.appendChild(c);
    return c;
  })();

  const toast = document.createElement('div');
  toast.className = 'toast success';
  toast.innerHTML = `
    <div class="toast-icon">✅</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function openAdminLoginModal() {
  document.getElementById('admin-login-modal').classList.add('active');
}

async function handleAdminLogin(e) {
  e.preventDefault();
  const email = document.getElementById('admin-login-email').value;
  const password = document.getElementById('admin-login-password').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (res.ok && data.token) {
      state.token = data.token;
      localStorage.setItem('mo_admin_token', data.token);
      document.getElementById('admin-login-modal').classList.remove('active');
      await fetchAdminData();
    } else {
      alert(data.error || 'Admin sign in failed.');
    }
  } catch (err) {
    alert('Server error logging in.');
  }
}

async function quickLoginAdmin(email, password) {
  document.getElementById('admin-login-email').value = email;
  document.getElementById('admin-login-password').value = password;
  const fakeEvent = { preventDefault: () => {} };
  await handleAdminLogin(fakeEvent);
}

function logoutAdmin() {
  state.token = null;
  localStorage.removeItem('mo_admin_token');
  openAdminLoginModal();
}

// ===== ABUSE MONITORING FUNCTIONS =====

async function fetchAbuseData() {
  try {
    await Promise.all([
      fetchAbuseThresholds(),
      fetchFlaggedUsers(),
      fetchActiveSuspensions()
    ]);
  } catch (err) {
    console.error('Fetch abuse data error:', err);
  }
}

async function fetchAbuseThresholds() {
  try {
    const res = await fetch('/api/abuse/thresholds', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      state.abuseThresholds = data.thresholds || [];
      renderThresholdsTable();
    }
  } catch (err) {
    console.error('Fetch abuse thresholds error:', err);
  }
}

async function fetchFlaggedUsers() {
  try {
    const res = await fetch('/api/abuse/flagged-users', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      state.flaggedUsers = data.flaggedUsers || [];
      renderFlaggedUsersTable();
    }
  } catch (err) {
    console.error('Fetch flagged users error:', err);
  }
}

async function fetchActiveSuspensions() {
  try {
    const res = await fetch('/api/abuse/suspensions', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      state.activeSuspensions = data.suspensions || [];
      renderSuspensionsTable();
    }
  } catch (err) {
    console.error('Fetch active suspensions error:', err);
  }
}

function renderThresholdsTable() {
  const container = document.getElementById('thresholds-table');
  if (!container) return;

  const metricLabels = {
    'cancellations_per_30d': 'Cancellations per 30 days',
    'no_shows_per_90d': 'No-shows per 90 days',
    'bookings_per_7d': 'Bookings per 7 days',
    'duplicate_enquiries_per_24h': 'Duplicate enquiries per 24 hours'
  };

  const actionLabels = {
    'flag': '🚩 Flag Only',
    'warn': '⚠️ Warn Patient',
    'suspend_temporary': '⏸️ Temporary Suspension',
    'suspend_permanent': '🚫 Permanent Suspension'
  };

  container.innerHTML = `
    <table class="priority-table">
      <thead>
        <tr>
          <th>Metric</th>
          <th>Threshold</th>
          <th>Window (Days)</th>
          <th>Action</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${state.abuseThresholds.map(t => `
          <tr>
            <td><strong>${metricLabels[t.metric] || t.metric}</strong></td>
            <td><input type="number" class="form-input form-input-sm" value="${t.threshold}" min="1" max="100" data-metric="${t.metric}" onchange="updateThresholdValue('${t.metric}', 'threshold', this.value)"></td>
            <td><input type="number" class="form-input form-input-sm" value="${t.window_days}" min="1" max="365" data-metric="${t.metric}" onchange="updateThresholdValue('${t.metric}', 'window_days', this.value)"></td>
            <td>
              <select class="form-select form-select-sm" data-metric="${t.metric}" onchange="updateThresholdValue('${t.metric}', 'action', this.value)">
                ${Object.entries(actionLabels).map(([val, label]) => `
                  <option value="${val}" ${t.action === val ? 'selected' : ''}>${label}</option>
                `).join('')}
              </select>
            </td>
            <td><button class="btn btn-outline btn-sm" onclick="saveThreshold('${t.metric}')">Save</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderFlaggedUsersTable() {
  const container = document.getElementById('flagged-users-table');
  if (!container) return;

  if (state.flaggedUsers.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem; color: #64748b;">
        <div style="font-size: 3rem;">✅</div>
        <p style="margin-top: 1rem;">No flagged patients. All accounts are within normal thresholds.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <table class="priority-table">
      <thead>
        <tr>
          <th>Patient</th>
          <th>Contact</th>
          <th>Flags Triggered</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${state.flaggedUsers.map(u => `
          <tr>
            <td>
              <strong>${u.user.full_name}</strong>
              <br><small style="color: #64748b;">ID: ${u.user.id}</small>
            </td>
            <td>
              ${u.user.email}<br>
              ${u.user.phone || 'N/A'}
            </td>
            <td>
              ${u.flags.map(f => `
                <span class="badge badge-priority-critical" style="margin: 0.15rem; font-size: 0.7rem;">
                  ${f.metric.replace('_', ' ')}: ${f.count}/${f.threshold} → ${f.action}
                </span>
              `).join('')}
            </td>
            <td>
              ${u.isSuspended ?
                `<span class="badge badge-priority-critical">🔒 ${u.suspension.suspension_type.toUpperCase()}</span>` :
                '<span class="badge badge-waiting">⚠️ FLAGGED</span>'
              }
            </td>
            <td>
              ${!u.isSuspended ?
                `<button class="btn btn-danger btn-sm" onclick="openSuspendModal(${u.user.id}, '${u.user.full_name.replace(/'/g, "\\'")}')">Suspend</button>` :
                `<button class="btn btn-primary btn-sm" onclick="openUnsuspendModal(${u.user.id}, '${u.user.full_name.replace(/'/g, "\\'")}', ${u.suspension.id})">Unsuspend</button>`
              }
              <button class="btn btn-outline btn-sm" onclick="viewUserDetail(${u.user.id})">Details</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderSuspensionsTable() {
  const container = document.getElementById('suspensions-table');
  if (!container) return;

  if (state.activeSuspensions.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem; color: #64748b;">
        <div style="font-size: 3rem;">🔓</div>
        <p style="margin-top: 1rem;">No active suspensions.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <table class="priority-table">
      <thead>
        <tr>
          <th>Patient</th>
          <th>Type</th>
          <th>Reason</th>
          <th>Suspended By</th>
          <th>Suspended At</th>
          <th>Expires</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${state.activeSuspensions.map(s => `
          <tr>
            <td>
              <strong>${s.user_name}</strong>
              <br><small style="color: #64748b;">${s.user_email}</small>
            </td>
            <td>
              <span class="badge ${s.suspension_type === 'permanent' ? 'badge-priority-critical' : (s.suspension_type === 'temporary' ? 'badge-priority-urgent' : 'badge-priority-low')}">
                ${s.suspension_type.toUpperCase()}
              </span>
            </td>
            <td>${s.reason}</td>
            <td>${s.suspended_by_name || 'System'}</td>
            <td>${formatDateTime(s.suspended_at)}</td>
            <td>
              ${s.expires_at ? formatDateTime(s.expires_at) : '<span class="badge badge-priority-critical">PERMANENT</span>'}
            </td>
            <td>
              <button class="btn btn-primary btn-sm" onclick="openUnsuspendModal(${s.user_id}, '${s.user_name.replace(/'/g, "\\'")}', ${s.id})">Lift</button>
              <button class="btn btn-outline btn-sm" onclick="viewUserDetail(${s.user_id})">Details</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function updateThresholdValue(metric, field, value) {
  // Find and update local state
  const threshold = state.abuseThresholds.find(t => t.metric === metric);
  if (threshold) {
    threshold[field] = field === 'threshold' || field === 'window_days' ? parseInt(value) : value;
  }
}

async function saveThreshold(metric) {
  const threshold = state.abuseThresholds.find(t => t.metric === metric);
  if (!threshold) return;

  try {
    const res = await fetch('/api/abuse/thresholds', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({
        metric: threshold.metric,
        threshold: threshold.threshold,
        action: threshold.action,
        window_days: threshold.window_days
      })
    });

    if (res.ok) {
      showToast('Success', 'Threshold updated');
      await fetchAbuseThresholds();
    } else {
      showToast('Error', 'Failed to update threshold');
    }
  } catch (err) {
    console.error('Save threshold error:', err);
    showToast('Error', 'Server error');
  }
}

function openSuspendModal(userId, userName) {
  document.getElementById('suspend-user-id').value = userId;
  document.getElementById('suspend-user-name').value = userName;
  document.getElementById('suspend-type').value = 'temporary';
  document.getElementById('suspend-reason').value = '';
  document.getElementById('suspend-expires-group').style.display = 'block';

  // Set default expiry to 7 days from now
  const defaultExpiry = new Date();
  defaultExpiry.setDate(defaultExpiry.getDate() + 7);
  document.getElementById('suspend-expires-at').value = defaultExpiry.toISOString().slice(0, 16);

  document.getElementById('suspend-type').onchange = function() {
    document.getElementById('suspend-expires-group').style.display = this.value === 'temporary' ? 'block' : 'none';
  };

  document.getElementById('suspend-user-modal').classList.add('active');
}

function closeSuspendModal() {
  document.getElementById('suspend-user-modal').classList.remove('active');
}

async function submitSuspendUser() {
  const userId = parseInt(document.getElementById('suspend-user-id').value);
  const suspensionType = document.getElementById('suspend-type').value;
  const reason = document.getElementById('suspend-reason').value;
  const expiresAt = suspensionType === 'temporary' ? document.getElementById('suspend-expires-at').value : null;

  if (!reason.trim()) {
    showToast('Error', 'Please enter a reason');
    return;
  }

  try {
    const res = await fetch('/api/abuse/suspend', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ user_id: userId, suspension_type: suspensionType, reason, expires_at: expiresAt })
    });

    if (res.ok) {
      showToast('Success', 'User suspended');
      closeSuspendModal();
      await fetchAbuseData();
    } else {
      const data = await res.json();
      showToast('Error', data.error || 'Failed to suspend user');
    }
  } catch (err) {
    console.error('Suspend user error:', err);
    showToast('Error', 'Server error');
  }
}

function openUnsuspendModal(userId, userName, suspensionId) {
  document.getElementById('unsuspend-user-id').value = userId;
  document.getElementById('unsuspend-suspension-id').value = suspensionId;
  document.getElementById('unsuspend-user-name').value = userName;
  document.getElementById('unsuspend-lift-reason').value = '';

  // Find current suspension details
  const suspension = state.activeSuspensions.find(s => s.id === suspensionId);
  if (suspension) {
    document.getElementById('unsuspend-current').value = `${suspension.suspension_type.toUpperCase()} - ${suspension.reason}`;
  }

  document.getElementById('unsuspend-user-modal').classList.add('active');
}

function closeUnsuspendModal() {
  document.getElementById('unsuspend-user-modal').classList.remove('active');
}

async function submitUnsuspendUser() {
  const userId = parseInt(document.getElementById('unsuspend-user-id').value);
  const suspensionId = parseInt(document.getElementById('unsuspend-suspension-id').value);
  const liftReason = document.getElementById('unsuspend-lift-reason').value;

  if (!liftReason.trim()) {
    showToast('Error', 'Please enter a reason for lifting suspension');
    return;
  }

  try {
    const res = await fetch('/api/abuse/unsuspend', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ user_id: userId, lift_reason: liftReason })
    });

    if (res.ok) {
      showToast('Success', 'Suspension lifted');
      closeUnsuspendModal();
      await fetchAbuseData();
    } else {
      const data = await res.json();
      showToast('Error', data.error || 'Failed to lift suspension');
    }
  } catch (err) {
    console.error('Unsuspend user error:', err);
    showToast('Error', 'Server error');
  }
}

async function viewUserDetail(userId) {
  try {
    const res = await fetch(`/api/abuse/user/${userId}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      renderUserDetailModal(data);
      document.getElementById('user-detail-modal').classList.add('active');
    }
  } catch (err) {
    console.error('View user detail error:', err);
    showToast('Error', 'Failed to load user details');
  }
}

function renderUserDetailModal(data) {
  const container = document.getElementById('user-detail-content');
  const { user, flags, suspension, suspensionHistory, activity } = data;

  container.innerHTML = `
    <div class="user-detail-header">
      <div class="user-avatar-large" style="width: 80px; height: 80px; font-size: 1.5rem;">${getInitials(user.full_name)}</div>
      <div>
        <h3 style="margin: 0;">${user.full_name}</h3>
        <p style="margin: 0.25rem 0 0; color: #64748b;">${user.email} • ${user.phone || 'N/A'}</p>
        <p style="margin: 0.25rem 0 0; font-size: 0.8rem; color: #64748b;">Registered: ${formatDate(user.created_at)}</p>
      </div>
    </div>

    <div style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid #e2e8f0;">
      <h4>⚠️ Active Flags</h4>
      ${flags.length > 0 ? `
        <div class="flags-list">
          ${flags.map(f => `
            <div class="flag-item" style="padding: 0.75rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; margin-bottom: 0.5rem;">
              <div style="display: flex; justify-content: space-between;">
                <strong>${f.metric.replace('_', ' ')}</strong>
                <span class="badge badge-priority-critical">${f.action}</span>
              </div>
              <div style="margin-top: 0.25rem; color: #64748b; font-size: 0.85rem;">
                Current: ${f.count} / Threshold: ${f.threshold} (${f.windowDays} day window)
              </div>
            </div>
          `).join('')}
        </div>
      ` : '<p style="color: #22c55e;">No active flags - within all thresholds</p>'}
    </div>

    <div style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid #e2e8f0;">
      <h4>🔒 Suspension Status</h4>
      ${suspension ? `
        <div class="suspension-detail" style="padding: 1rem; background: ${suspension.suspension_type === 'permanent' ? '#fef2f2' : '#fffbeb'}; border: 1px solid ${suspension.suspension_type === 'permanent' ? '#fecaca' : '#fde68a'}; border-radius: 8px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
            <strong>Type: ${suspension.suspension_type.toUpperCase()}</strong>
            <span class="badge ${suspension.suspension_type === 'permanent' ? 'badge-priority-critical' : 'badge-priority-urgent'}">ACTIVE</span>
          </div>
          <p style="margin: 0.5rem 0;"><strong>Reason:</strong> ${suspension.reason}</p>
          <p style="margin: 0.5rem 0;"><strong>Suspended By:</strong> ${suspension.suspended_by_name || 'System'}</p>
          <p style="margin: 0.5rem 0;"><strong>Suspended At:</strong> ${formatDateTime(suspension.suspended_at)}</p>
          <p style="margin: 0.5rem 0;"><strong>Expires:</strong> ${suspension.expires_at ? formatDateTime(suspension.expires_at) : 'PERMANENT'}</p>
        </div>
      ` : '<p style="color: #22c55e;">No active suspension</p>'}
    </div>

    ${suspensionHistory && suspensionHistory.length > 0 ? `
    <div style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid #e2e8f0;">
      <h4>📜 Suspension History</h4>
      <table class="priority-table" style="font-size: 0.85rem;">
        <thead>
          <tr><th>Type</th><th>Reason</th><th>Suspended By</th><th>Suspended At</th><th>Lifted At</th><th>Lifted By</th></tr>
        </thead>
        <tbody>
          ${suspensionHistory.map(h => `
            <tr>
              <td>${h.suspension_type.toUpperCase()}</td>
              <td>${h.reason}</td>
              <td>${h.suspended_by_name || 'System'}</td>
              <td>${formatDateTime(h.suspended_at)}</td>
              <td>${h.lifted_at ? formatDateTime(h.lifted_at) : '—'}</td>
              <td>${h.lifted_by_name || '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    <div style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid #e2e8f0;">
      <h4>📋 Recent Activity (Last 20)</h4>
      ${activity && activity.length > 0 ? `
        <table class="priority-table" style="font-size: 0.85rem;">
          <thead>
            <tr><th>Type</th><th>Appointment</th><th>Details</th><th>Date</th></tr>
          </thead>
          <tbody>
            ${activity.slice(0, 20).map(a => `
              <tr>
                <td>${a.activity_type.replace('_', ' ')}</td>
                <td>${a.appointment_id ? `#${a.appointment_id}` : '—'}</td>
                <td>${a.metadata_json ? JSON.parse(a.metadata_json).reason || '—' : '—'}</td>
                <td>${formatDateTime(a.created_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<p style="color: #64748b;">No recent activity</p>'}
    </div>
  `;
}

function closeUserDetailModal() {
  document.getElementById('user-detail-modal').classList.remove('active');
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
