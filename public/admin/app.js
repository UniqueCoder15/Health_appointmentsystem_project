// Swasthya Saarthi Admin Portal Application Logic

let state = {
  token: localStorage.getItem('mo_admin_token') || null,
  stats: null,
  doctors: [],
  appointments: [],
  specialties: []
};

document.addEventListener('DOMContentLoaded', () => {
  initAdmin();
});

async function initAdmin() {
  if (state.token) {
    await fetchAdminData();
  } else {
    openAdminLoginModal();
  }
}

async function fetchAdminData() {
  await fetchStats();
  await fetchAdminDoctors();
  await fetchAdminAppointments();
  await fetchAdminSpecialties();
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
