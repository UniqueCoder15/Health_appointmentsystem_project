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
  selectedSlot: null
};

let heroEventSource = null;

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
    updateUIState(true);
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
  } else {
    if (authBtns) authBtns.style.display = 'flex';
    if (userBadge) userBadge.style.display = 'none';
  }
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
