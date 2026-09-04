// Swasthya Saarthi — Kiosk Mode Application Logic

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
  return Promise.resolve();
}

// Kiosk State
let kioskState = {
  currentStep: 'welcome',
  selectedLanguage: null,
  visitType: null,
  selectedDoctor: null,
  selectedSpecialty: null,
  checkinMethod: 'phone',
  patientData: {},
  foundAppointment: null,
  doctors: [],
  specialties: [],
  queueEventSource: null,
  highContrast: false,
  largeText: false
};

// Language options
const languages = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'mr', name: 'Marathi', native: 'मराठी' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' }
];

// Initialize Kiosk
document.addEventListener('DOMContentLoaded', () => {
  initKiosk();
});

async function initKiosk() {
  // Add kiosk mode class to body
  document.body.classList.add('kiosk-mode');

  // Initialize i18n engine first
  if (window.i18n) {
    await window.i18n.init();
    if (window.i18n.locale) {
      kioskState.selectedLanguage = window.i18n.locale;
    }
  }

  // Start clock
  updateClock();
  setInterval(updateClock, 1000);

  // Load data
  await loadSpecialties();
  await loadDoctors();

  // Render language grid
  renderLanguageGrid();

  // Setup event listeners
  setupEventListeners();

  // Highlight selected language card if saved
  if (kioskState.selectedLanguage) {
    document.querySelectorAll('.language-card').forEach(card => {
      const isSelected = card.dataset.lang === kioskState.selectedLanguage;
      card.classList.toggle('selected', isSelected);
      card.setAttribute('aria-selected', isSelected);
    });
    const welcomeNext = document.getElementById('welcome-next-btn');
    if (welcomeNext) welcomeNext.disabled = false;
  }

  // Show welcome step
  showStep('welcome');
}

function updateClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
  const dateStr = now.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  document.getElementById('kiosk-time').textContent = `${dateStr} • ${timeStr}`;
}

async function loadSpecialties() {
  try {
    const res = await fetch('/api/kiosk/specialties');
    const data = await res.json();
    kioskState.specialties = data.specialties || [];
    renderSpecialtyFilter();
    renderQueueFilterTabs();
  } catch (err) {
    console.error('Load specialties error:', err);
  }
}

async function loadDoctors() {
  try {
    const res = await fetch('/api/kiosk/doctors');
    const data = await res.json();
    kioskState.doctors = data.doctors || [];
    renderWalkinDoctors();
  } catch (err) {
    console.error('Load doctors error:', err);
  }
}

function setupEventListeners() {
  // Language selection
  document.getElementById('language-grid').addEventListener('click', (e) => {
    const card = e.target.closest('.language-card');
    if (card) {
      selectLanguage(card.dataset.lang);
    }
  });

  // Visit type selection
  document.getElementById('visit-type-grid').addEventListener('click', (e) => {
    const card = e.target.closest('.visit-type-card');
    if (card) {
      selectVisitType(card.dataset.type);
    }
  });

  // Doctor search
  const searchInput = document.getElementById('doctor-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(filterDoctors, 300));
  }

  // Specialty filter chips
  document.getElementById('specialty-filter').addEventListener('click', (e) => {
    const chip = e.target.closest('.specialty-chip');
    if (chip) {
      selectSpecialty(chip.dataset.specialty);
    }
  });

  // Doctor list selection
  document.getElementById('walkin-doctor-list').addEventListener('click', (e) => {
    const card = e.target.closest('.doctor-card-kiosk');
    if (card) {
      selectDoctor(card.dataset.doctorId);
    }
  });

  // Check-in method selection
  document.querySelector('.checkin-methods').addEventListener('click', (e) => {
    const card = e.target.closest('.checkin-method-card');
    if (card) {
      selectCheckinMethod(card.dataset.method);
    }
  });

  // Check-in input validation
  ['checkin-phone', 'checkin-email', 'checkin-booking-id'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', validateCheckinInput);
    }
  });

  // Patient form inputs
  ['patient-name', 'patient-phone', 'patient-age', 'patient-reason', 'patient-abha'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', validatePatientForm);
    }
  });

  // Queue filter tabs
  document.getElementById('queue-filter-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.queue-filter-tab');
    if (tab) {
      selectQueueFilter(tab.dataset.doctorId);
    }
  });

  // Keyboard navigation for accessibility
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Go back or close
      handleEscapeKey();
    }
  });

  // Welcome next button
  document.getElementById('welcome-next-btn').addEventListener('click', () => {
    if (kioskState.selectedLanguage) {
      goToStep('visit-type');
    }
  });

  // Visit type next button
  document.getElementById('visit-next-btn').addEventListener('click', handleVisitTypeNext);

  // Doctor next button
  document.getElementById('doctor-next-btn').addEventListener('click', handleDoctorNext);

  // Check-in next button
  document.getElementById('checkin-next-btn').addEventListener('click', handleCheckinNext);

  // Confirm check-in button
  document.getElementById('confirm-checkin-btn').addEventListener('click', handleConfirmCheckin);

  // Submit walk-in button
  document.getElementById('submit-walkin-btn').addEventListener('click', handleWalkinSubmit);
}

// Debounce utility
function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

// Step Navigation
function showStep(stepId) {
  // Hide all steps
  document.querySelectorAll('.kiosk-step').forEach(step => {
    step.style.display = 'none';
    step.classList.remove('active');
  });

  // Show target step
  const targetStep = document.getElementById(`step-${stepId}`);
  if (targetStep) {
    targetStep.style.display = 'block';
    targetStep.classList.add('active');
    kioskState.currentStep = stepId;

    // Animate entrance
    const card = targetStep.querySelector('.kiosk-card');
    if (card) {
      animateMotion(card, [
        { opacity: 0, transform: 'translateY(20px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ], { duration: 300 });
    }

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Focus first focusable element
    setTimeout(() => {
      const focusable = targetStep.querySelector('button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable) focusable.focus();
    }, 100);
  }
}

function goToStep(stepId) {
  showStep(stepId);
}

// Language Selection
function renderLanguageGrid() {
  const grid = document.getElementById('language-grid');
  if (!grid) return;

  grid.innerHTML = languages.map(lang => `
    <button class="language-card" data-lang="${lang.code}" role="option" aria-selected="false">
      <span>${lang.name}</span>
      <span class="lang-native">${lang.native}</span>
    </button>
  `).join('');
}

async function selectLanguage(langCode) {
  const lang = languages.find(l => l.code === langCode);
  if (!lang) return;

  kioskState.selectedLanguage = langCode;

  // Update UI
  document.querySelectorAll('.language-card').forEach(card => {
    const isSelected = card.dataset.lang === langCode;
    card.classList.toggle('selected', isSelected);
    card.setAttribute('aria-selected', isSelected);
  });

  // Enable next button
  document.getElementById('welcome-next-btn').disabled = false;
  document.getElementById('welcome-next-btn').focus();

  // Update i18n engine and active DOM elements
  if (window.i18n) {
    await window.i18n.setLocale(langCode);
    updateDynamicTranslations();
  }
}

function updateDynamicTranslations() {
  renderSpecialtyFilter();
  renderWalkinDoctors();
  renderQueueFilterTabs();

  if (kioskState.currentStep === 'queue-view') {
    const activeTab = document.querySelector('.queue-filter-tab.active');
    const doctorId = activeTab?.dataset.doctorId || 'all';
    renderLiveQueue(doctorId);
  }

  if (kioskState.foundAppointment && kioskState.currentStep === 'confirm-checkin') {
    renderAppointmentConfirmation(kioskState.foundAppointment);
  }
}

// Visit Type Selection
function selectVisitType(type) {
  kioskState.visitType = type;

  document.querySelectorAll('.visit-type-card').forEach(card => {
    const isSelected = card.dataset.type === type;
    card.classList.toggle('selected', isSelected);
  });

  document.getElementById('visit-next-btn').disabled = false;
  document.getElementById('visit-next-btn').focus();
}

function handleVisitTypeNext() {
  switch (kioskState.visitType) {
    case 'walkin':
      goToStep('walkin-doctor');
      break;
    case 'booked':
      goToStep('booked-checkin');
      break;
    case 'queue-only':
      goToStep('queue-view');
      startLiveQueueStream();
      break;
  }
}

// Doctor Selection (Walk-in)
function renderSpecialtyFilter() {
  const container = document.getElementById('specialty-filter');
  if (!container) return;

  const t = (key, fallback) => (window.i18n ? window.i18n.t(key) : fallback);
  const activeSpec = kioskState.selectedSpecialty || 'all';

  const chips = ['all', ...kioskState.specialties.map(s => s.id)].map(id => {
    if (id === 'all') {
      const allText = t('kiosk.allSpecialties', 'All Specialties');
      return `<button class="specialty-chip ${activeSpec === 'all' ? 'active' : ''}" data-specialty="all">${allText}</button>`;
    }
    const spec = kioskState.specialties.find(s => s.id == id);
    return `<button class="specialty-chip ${activeSpec == id ? 'active' : ''}" data-specialty="${id}">${spec?.icon || '🩺'} ${spec?.name || 'Unknown'}</button>`;
  }).join('');

  container.innerHTML = chips;
}

function selectSpecialty(specialtyId) {
  kioskState.selectedSpecialty = specialtyId === 'all' ? null : specialtyId;

  document.querySelectorAll('.specialty-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.specialty === specialtyId);
  });

  filterDoctors();
}

function filterDoctors() {
  const searchTerm = document.getElementById('doctor-search-input')?.value.toLowerCase() || '';
  let filtered = kioskState.doctors;

  // Filter by specialty
  if (kioskState.selectedSpecialty) {
    filtered = filtered.filter(d => d.specialty_id == kioskState.selectedSpecialty);
  }

  // Filter by search
  if (searchTerm) {
    filtered = filtered.filter(d =>
      d.full_name.toLowerCase().includes(searchTerm) ||
      d.specialty_name.toLowerCase().includes(searchTerm)
    );
  }

  renderWalkinDoctors(filtered);
}

function renderWalkinDoctors(doctors = kioskState.doctors) {
  const container = document.getElementById('walkin-doctor-list');
  if (!container) return;

  const t = (key, fallback) => (window.i18n ? window.i18n.t(key) : fallback);

  if (doctors.length === 0) {
    container.innerHTML = `
      <div class="queue-empty">
        <div class="empty-icon">🔍</div>
        <p>${t('kiosk.noDoctors', 'No doctors match your criteria.')}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = doctors.map(doc => `
    <button class="doctor-card-kiosk ${kioskState.selectedDoctor === doc.id ? 'selected' : ''}" data-doctor-id="${doc.id}" role="option" aria-selected="${kioskState.selectedDoctor === doc.id}">
      <div class="doc-avatar">${doc.specialty_icon || '👨‍⚕️'}</div>
      <div class="doctor-info">
        <div class="doc-name">${doc.full_name}</div>
        <div class="doc-spec">${doc.specialty_name}</div>
        <div class="doctor-meta">
          <span>⭐ <span class="meta-value">${doc.rating || 4.9}</span></span>
          <span>💰 <span class="meta-value">₹${doc.consultation_fee || 800}</span></span>
          <span>📍 <span class="meta-value">${doc.location || 'Medical Center'}</span></span>
        </div>
      </div>
    </button>
  `).join('');

  // Update next button state
  document.getElementById('doctor-next-btn').disabled = !kioskState.selectedDoctor;
}

function selectDoctor(doctorId) {
  kioskState.selectedDoctor = doctorId;

  document.querySelectorAll('.doctor-card-kiosk').forEach(card => {
    const isSelected = card.dataset.doctorId == doctorId;
    card.classList.toggle('selected', isSelected);
    card.setAttribute('aria-selected', isSelected);
  });

  document.getElementById('doctor-next-btn').disabled = false;
  document.getElementById('doctor-next-btn').focus();
}

function handleDoctorNext() {
  if (!kioskState.selectedDoctor) return;
  goToStep('patient-details');
}

// Check-in Flow (Booked Appointment)
function selectCheckinMethod(method) {
  kioskState.checkinMethod = method;

  document.querySelectorAll('.checkin-method-card').forEach(card => {
    card.classList.toggle('active', card.dataset.method === method);
  });

  // Show/hide appropriate input
  document.getElementById('checkin-phone-input').style.display = method === 'phone' ? 'block' : 'none';
  document.getElementById('checkin-email-input').style.display = method === 'email' ? 'block' : 'none';
  document.getElementById('checkin-booking-input').style.display = method === 'booking-id' ? 'block' : 'none';

  // Focus the input
  const inputId = method === 'phone' ? 'checkin-phone' : (method === 'email' ? 'checkin-email' : 'checkin-booking-id');
  setTimeout(() => document.getElementById(inputId)?.focus(), 100);

  validateCheckinInput();
}

function validateCheckinInput() {
  let isValid = false;
  const phone = document.getElementById('checkin-phone')?.value;
  const email = document.getElementById('checkin-email')?.value;
  const bookingId = document.getElementById('checkin-booking-id')?.value;

  switch (kioskState.checkinMethod) {
    case 'phone':
      isValid = phone && phone.length === 10;
      break;
    case 'email':
      isValid = email && email.includes('@');
      break;
    case 'booking-id':
      isValid = bookingId && bookingId.length >= 5;
      break;
  }

  document.getElementById('checkin-next-btn').disabled = !isValid;
}

async function handleCheckinNext() {
  const t = (key, fallback) => (window.i18n ? window.i18n.t(key) : fallback);
  showLoading(true, t('kiosk.findingAppointment', 'Finding your appointment...'));

  try {
    let appointment = null;

    switch (kioskState.checkinMethod) {
      case 'phone':
        appointment = await findAppointmentByPhone(document.getElementById('checkin-phone').value);
        break;
      case 'email':
        appointment = await findAppointmentByEmail(document.getElementById('checkin-email').value);
        break;
      case 'booking-id':
        appointment = await findAppointmentByBookingId(document.getElementById('checkin-booking-id').value);
        break;
    }

    if (appointment) {
      kioskState.foundAppointment = appointment;
      renderAppointmentConfirmation(appointment);
      showLoading(false);
      goToStep('confirm-checkin');
    } else {
      showLoading(false);
      showToast(t('kiosk.apptNotFoundTitle', 'Appointment not found'), t('kiosk.apptNotFoundMsg', 'Please check your details and try again.'), 'error');
    }
  } catch (err) {
    showLoading(false);
    console.error('Check-in error:', err);
    showToast(t('kiosk.errorTitle', 'Error'), t('kiosk.findApptError', 'Failed to find appointment. Please try again.'), 'error');
  }
}

async function findAppointmentByPhone(phone) {
  const res = await fetch('/api/kiosk/find-appointment?phone=' + encodeURIComponent(phone));
  if (res.ok) {
    const data = await res.json();
    return data.appointment;
  }
  return null;
}

async function findAppointmentByEmail(email) {
  const res = await fetch('/api/kiosk/find-appointment?email=' + encodeURIComponent(email));
  if (res.ok) {
    const data = await res.json();
    return data.appointment;
  }
  return null;
}

async function findAppointmentByBookingId(bookingId) {
  const res = await fetch('/api/kiosk/find-appointment?booking_id=' + encodeURIComponent(bookingId));
  if (res.ok) {
    const data = await res.json();
    return data.appointment;
  }
  return null;
}

function getDemoToken() {
  // For kiosk demo, we'll use a demo token or localStorage
  return localStorage.getItem('mo_patient_token') || 'demo-token';
}

function renderAppointmentConfirmation(appt) {
  const container = document.getElementById('appointment-confirmation');
  if (!container) return;

  const t = (key, fallback) => (window.i18n ? window.i18n.t(key) : fallback);
  const priorityBadge = getPriorityBadge(appt.priority_level || 3);
  const minsText = t('kiosk.mins', 'minutes');

  container.innerHTML = `
    <div class="confirmation-row">
      <span class="confirmation-label">${t('kiosk.doctor', 'Doctor')}</span>
      <span class="confirmation-value">${appt.doctor_name || 'Dr. Ananya Sharma'}</span>
    </div>
    <div class="confirmation-row">
      <span class="confirmation-label">${t('kiosk.specialty', 'Specialty')}</span>
      <span class="confirmation-value">${appt.specialty_name || 'Cardiology'}</span>
    </div>
    <div class="confirmation-row">
      <span class="confirmation-label">${t('kiosk.date', 'Date')}</span>
      <span class="confirmation-value">${formatDate(appt.appointment_date)}</span>
    </div>
    <div class="confirmation-row">
      <span class="confirmation-label">${t('kiosk.time', 'Time')}</span>
      <span class="confirmation-value">${appt.appointment_time}</span>
    </div>
    <div class="confirmation-row">
      <span class="confirmation-label">${t('kiosk.location', 'Location')}</span>
      <span class="confirmation-value">${appt.doctor_location || 'AIIMS New Delhi'}</span>
    </div>
    <div class="confirmation-row">
      <span class="confirmation-label">${t('kiosk.priority', 'Priority')}</span>
      <span class="confirmation-value"><span class="badge ${priorityBadge.class}">${priorityBadge.text}</span></span>
    </div>
    <div class="confirmation-row">
      <span class="confirmation-label">${t('kiosk.queuePosition', 'Queue Position')}</span>
      <span class="confirmation-value highlight">#${appt.queue_number || 1}</span>
    </div>
    <div class="confirmation-row">
      <span class="confirmation-label">${t('kiosk.estimatedWait', 'Estimated Wait')}</span>
      <span class="confirmation-value highlight">~${appt.estimated_wait_mins || 15} ${minsText}</span>
    </div>
  `;
}

async function handleConfirmCheckin() {
  const t = (key, fallback) => (window.i18n ? window.i18n.t(key) : fallback);
  showLoading(true, t('kiosk.checkingIn', 'Checking you in...'));

  try {
    const appt = kioskState.foundAppointment;
    if (!appt || !appt.id) {
      showLoading(false);
      showToast('Error', 'Appointment details missing. Please search again.', 'error');
      return;
    }

    const res = await fetch('/api/kiosk/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appointment_id: appt.id })
    });

    const data = await res.json();
    if (res.ok) {
      showLoading(false);
      showSuccessScreen(data.appointment || appt);
    } else {
      showLoading(false);
      showToast('Error', data.error || 'Failed to check in.', 'error');
    }
  } catch (err) {
    showLoading(false);
    console.error('Confirm check-in error:', err);
    showToast('Error', 'Failed to check in. Please try again.', 'error');
  }
}

// Walk-in Patient Form
function validatePatientForm() {
  const name = document.getElementById('patient-name')?.value.trim();
  const phone = document.getElementById('patient-phone')?.value;
  const age = document.getElementById('patient-age')?.value;
  const reason = document.getElementById('patient-reason')?.value.trim();
  const abha = document.getElementById('patient-abha')?.value.trim();

  // Validate ABHA ID if provided (14 digits)
  const abhaValid = !abha || (abha.length === 14 && /^\d{14}$/.test(abha));

  const isValid = name && phone && phone.length === 10 && age && age >= 1 && age <= 120 && reason && abhaValid;

  // Show/hide ABHA validation error
  const abhaInput = document.getElementById('patient-abha');
  if (abha && !abhaValid) {
    abhaInput.style.borderColor = '#ef4444';
    abhaInput.setAttribute('aria-invalid', 'true');
  } else if (abhaInput) {
    abhaInput.style.borderColor = '';
    abhaInput.removeAttribute('aria-invalid');
  }

  document.getElementById('submit-walkin-btn').disabled = !isValid;
}

async function handleWalkinSubmit() {
  const t = (key, fallback) => (window.i18n ? window.i18n.t(key) : fallback);
  const name = document.getElementById('patient-name').value.trim();
  const phone = document.getElementById('patient-phone').value.trim();
  const email = document.getElementById('patient-email').value.trim() || null;
  const reason = document.getElementById('patient-reason').value.trim();
  const priority = parseInt(document.getElementById('patient-priority').value);
  const abha = document.getElementById('patient-abha').value.trim() || null;

  if (!kioskState.selectedDoctor) {
    showToast('Error', 'Please select a doctor first.', 'error');
    return;
  }

  // Validate ABHA if provided
  if (abha && (abha.length !== 14 || !/^\d{14}$/.test(abha))) {
    showToast('Invalid ABHA ID', 'ABHA ID must be 14 digits.', 'error');
    return;
  }

  showLoading(true, t('kiosk.bookingAppointment', 'Booking your appointment...'));

  try {
    const res = await fetch('/api/kiosk/walkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: name,
        phone: phone,
        email: email,
        doctor_id: kioskState.selectedDoctor,
        notes: reason,
        priority_level: priority,
        priority_reason: reason,
        abha_id: abha
      })
    });

    const data = await res.json();

    if (res.ok) {
      showLoading(false);
      showSuccessScreen(data.appointment);
    } else {
      showLoading(false);
      // Check for suspension error
      if (data.error && data.error.includes('suspended')) {
        showToast('Account Suspended', data.error, 'error');
      } else {
        showToast('Error', data.error || 'Failed to book appointment.', 'error');
      }
    }
  } catch (err) {
    showLoading(false);
    console.error('Walk-in booking error:', err);
    showToast('Error', 'Failed to complete registration. Please try again.', 'error');
  }
}

function renderQueueFilterTabs() {
  const container = document.getElementById('queue-filter-tabs');
  if (!container) return;

  const t = (key, fallback) => (window.i18n ? window.i18n.t(key) : fallback);
  const activeTab = document.querySelector('.queue-filter-tab.active')?.dataset.doctorId || 'all';

  const tabs = ['all', ...kioskState.doctors.map(d => d.id)].map(id => {
    if (id === 'all') {
      const allText = t('kiosk.allDoctors', 'All Doctors');
      return `<button class="queue-filter-tab ${activeTab === 'all' ? 'active' : ''}" data-doctor-id="all">${allText}</button>`;
    }
    const doc = kioskState.doctors.find(d => d.id == id);
    return `<button class="queue-filter-tab ${activeTab == id ? 'active' : ''}" data-doctor-id="${id}">${doc?.specialty_icon || '🩺'} ${doc?.full_name || 'Unknown'}</button>`;
  }).join('');

  container.innerHTML = tabs;
}

function selectQueueFilter(doctorId) {
  document.querySelectorAll('.queue-filter-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.doctorId === doctorId);
  });
  renderLiveQueue(doctorId);
}

async function renderLiveQueue(doctorId = 'all') {
  const container = document.getElementById('live-queue-display');
  if (!container) return;

  const t = (key, fallback) => (window.i18n ? window.i18n.t(key) : fallback);

  try {
    let allAppointments = [];

    const queueUrl = doctorId === 'all'
      ? '/api/kiosk/queue'
      : `/api/kiosk/queue?doctor_id=${doctorId}`;
    const res = await fetch(queueUrl);
    const data = await res.json();
    allAppointments = data.queue || [];

    // Filter only waiting/scheduled
    const waitingAppointments = allAppointments.filter(a =>
      a.status === 'scheduled' && (a.queue_status === 'waiting' || a.queue_status === 'in-consultation')
    );

    // Group by doctor
    const grouped = {};
    waitingAppointments.forEach(appt => {
      const docId = appt.doctor_id;
      if (!grouped[docId]) grouped[docId] = [];
      grouped[docId].push(appt);
    });

    // Sort each group by queue_number
    Object.values(grouped).forEach(list => list.sort((a, b) => (a.queue_number || 0) - (b.queue_number || 0)));

    if (Object.keys(grouped).length === 0) {
      container.innerHTML = `
        <div class="queue-empty">
          <div class="empty-icon">📋</div>
          <p>${t('kiosk.noPatientsInQueue', 'No patients in queue right now.')}</p>
        </div>
      `;
      return;
    }

    const waitingText = t('kiosk.waiting', 'waiting');
    const minsText = t('kiosk.mins', 'min');

    container.innerHTML = Object.entries(grouped).map(([docId, patients]) => {
      const doctor = kioskState.doctors.find(d => d.id == docId);
      const currentPatient = patients.find(p => p.queue_status === 'in-consultation') || patients[0];

      return `
        <div class="queue-doctor-group">
          <div class="queue-doctor-header">
            <div class="doc-info">
              <div class="doc-avatar">${doctor?.specialty_icon || '👨‍⚕️'}</div>
              <div>
                <div class="doc-name">${doctor?.full_name || 'Doctor'}</div>
                <div class="doc-spec">${doctor?.specialty_name || 'Specialty'}</div>
              </div>
            </div>
            <div class="queue-stats">
              <span class="stat">👥 <span class="meta-value">${patients.length}</span> ${waitingText}</span>
              <span class="stat">⏱️ <span class="meta-value">~${currentPatient?.estimated_wait_mins || 0}</span> ${minsText}</span>
            </div>
          </div>
          <div class="queue-patient-list">
            ${patients.map((p, idx) => `
              <div class="queue-patient-item ${p.queue_status === 'in-consultation' ? 'current' : ''}" role="listitem">
                <div class="queue-patient-left">
                  <div class="patient-avatar">${getInitials(p.patient_name)}</div>
                  <div class="patient-name">${p.patient_name}</div>
                </div>
                <div class="queue-patient-right">
                  <span class="queue-position">${p.queue_number || idx + 1}${getOrdinalSuffix(p.queue_number || idx + 1)}</span>
                  <span class="wait-time">~${p.estimated_wait_mins || 0} ${minsText}</span>
                  <span class="priority-badge badge ${getPriorityBadge(p.priority_level || 3).class}">${getPriorityBadge(p.priority_level || 3).text}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Render live queue error:', err);
    container.innerHTML = `
      <div class="queue-empty">
        <div class="empty-icon">⚠️</div>
        <p>Unable to load queue. Please try again.</p>
      </div>
    `;
  }
}

function startLiveQueueStream() {
  // SSE would go here for real-time updates
  // For now, refresh every 10 seconds
  if (kioskState.queueEventSource) {
    kioskState.queueEventSource.close();
  }

  // Poll for updates
  kioskState.queuePollInterval = setInterval(() => {
    if (kioskState.currentStep === 'queue-view') {
      const activeTab = document.querySelector('.queue-filter-tab.active');
      const doctorId = activeTab?.dataset.doctorId || 'all';
      renderLiveQueue(doctorId);
    }
  }, 10000);
}

function stopLiveQueueStream() {
  if (kioskState.queueEventSource) {
    kioskState.queueEventSource.close();
    kioskState.queueEventSource = null;
  }
  if (kioskState.queuePollInterval) {
    clearInterval(kioskState.queuePollInterval);
    kioskState.queuePollInterval = null;
  }
}

// Success Screen
function showSuccessScreen(appointment) {
  const titleEl = document.getElementById('success-title');
  const messageEl = document.getElementById('success-message');
  const detailsEl = document.getElementById('success-details');
  const queueDisplayEl = document.getElementById('queue-position-display');

  const t = (key, fallback) => (window.i18n ? window.i18n.t(key) : fallback);

  if (kioskState.visitType === 'booked') {
    titleEl.textContent = t('kiosk.checkinCompleteTitle', 'Check-in Complete!');
    messageEl.textContent = t('kiosk.checkinCompleteMsg', 'You are now checked in for your appointment.');
  } else {
    titleEl.textContent = t('kiosk.walkinBookedTitle', 'Appointment Booked!');
    messageEl.textContent = t('kiosk.walkinBookedMsg', 'Your walk-in appointment has been confirmed.');
  }

  // Details
  detailsEl.innerHTML = `
    <div class="detail-row">
      <span class="detail-label">${t('kiosk.doctor', 'Doctor')}</span>
      <span class="detail-value">${appointment.doctor_name || 'Dr. Ananya Sharma'}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">${t('kiosk.specialty', 'Specialty')}</span>
      <span class="detail-value">${appointment.specialty_name || 'Cardiology'}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">${t('kiosk.date', 'Date & Time')}</span>
      <span class="detail-value">${formatDate(appointment.appointment_date)} at ${appointment.appointment_time}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">${t('kiosk.location', 'Location')}</span>
      <span class="detail-value">${appointment.doctor_location || 'AIIMS New Delhi'}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">${t('kiosk.bookingReference', 'Booking Reference')}</span>
      <span class="detail-value">SWA-${appointment.appointment_date.replace(/-/g, '')}-${String(appointment.id).padStart(5, '0')}</span>
    </div>
  `;

  // Queue position
  const queueNum = appointment.queue_number || 1;
  const waitMins = appointment.estimated_wait_mins || 15;
  const minsText = t('kiosk.mins', 'minutes');
  queueDisplayEl.innerHTML = `
    <div class="position-label">${t('kiosk.yourPositionInQueue', 'Your Position in Queue')}</div>
    <div class="position-number">${queueNum}${getOrdinalSuffix(queueNum)}</div>
    <div class="position-wait">${t('kiosk.estimatedWaitLabel', 'Estimated wait:')} ~${waitMins} ${minsText}</div>
  `;

  goToStep('success');

  // Auto-reset after 30 seconds
  setTimeout(() => {
    if (kioskState.currentStep === 'success') {
      resetKiosk();
    }
  }, 30000);
}

function resetKiosk() {
  // Reset state
  kioskState = {
    currentStep: 'welcome',
    selectedLanguage: null,
    visitType: null,
    selectedDoctor: null,
    selectedSpecialty: null,
    checkinMethod: 'phone',
    patientData: {},
    foundAppointment: null,
    doctors: kioskState.doctors,
    specialties: kioskState.specialties,
    queueEventSource: null,
    highContrast: kioskState.highContrast,
    largeText: kioskState.largeText
  };

  // Reset forms
  document.getElementById('doctor-search-input').value = '';
  document.getElementById('checkin-phone').value = '';
  document.getElementById('checkin-email').value = '';
  document.getElementById('checkin-booking-id').value = '';
  document.getElementById('patient-name').value = '';
  document.getElementById('patient-phone').value = '';
  document.getElementById('patient-email').value = '';
  document.getElementById('patient-age').value = '';
  document.getElementById('patient-reason').value = '';
  document.getElementById('patient-priority').value = '3';

  // Reset buttons
  document.getElementById('welcome-next-btn').disabled = true;
  document.getElementById('visit-next-btn').disabled = true;
  document.getElementById('doctor-next-btn').disabled = true;
  document.getElementById('checkin-next-btn').disabled = true;
  document.getElementById('submit-walkin-btn').disabled = true;

  // Reset selections
  document.querySelectorAll('.language-card, .visit-type-card, .doctor-card-kiosk, .checkin-method-card, .specialty-chip, .queue-filter-tab').forEach(el => {
    el.classList.remove('selected', 'active');
    el.setAttribute('aria-selected', 'false');
  });
  document.querySelector('.checkin-method-card[data-method="phone"]').classList.add('active');
  document.querySelector('.specialty-chip[data-specialty="all"]').classList.add('active');
  document.querySelector('.queue-filter-tab[data-doctor-id="all"]').classList.add('active');

  // Show/hide checkin inputs
  document.getElementById('checkin-phone-input').style.display = 'block';
  document.getElementById('checkin-email-input').style.display = 'none';
  document.getElementById('checkin-booking-input').style.display = 'none';

  // Stop queue stream
  stopLiveQueueStream();

  // Go to welcome
  goToStep('welcome');

  // Re-render
  renderWalkinDoctors();
  renderLiveQueue();
}

// Utility Functions
function getPriorityBadge(level) {
  const t = (key, fallback) => (window.i18n ? window.i18n.t(key) : fallback);
  const badges = {
    1: { class: 'badge-priority-critical', text: t('kiosk.badgeCritical', '🚨 Critical') },
    2: { class: 'badge-priority-urgent', text: t('kiosk.badgeUrgent', '⚡ Urgent') },
    3: { class: 'badge-priority-normal', text: t('kiosk.badgeNormal', '🟢 Normal') },
    4: { class: 'badge-priority-low', text: t('kiosk.badgeLow', '🔵 Low') },
    5: { class: 'badge-priority-routine', text: t('kiosk.badgeRoutine', '⚪ Routine') }
  };
  return badges[level] || badges[3];
}

function getInitials(name) {
  if (!name) return 'AJ';
  const parts = name.trim().split(' ');
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

function formatDate(dateStr) {
  if (!dateStr) return 'Today';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function getOrdinalSuffix(num) {
  if (num % 100 >= 11 && num % 100 <= 13) return 'th';
  switch (num % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

// Loading Overlay
function showLoading(show, text = 'Processing...') {
  const overlay = document.getElementById('loading-overlay');
  const textEl = document.getElementById('loading-text');
  if (overlay) {
    overlay.style.display = show ? 'flex' : 'none';
  }
  if (textEl) {
    textEl.textContent = text;
  }
}

// Toast Notifications
function showToast(title, message, type = 'info', duration = 2000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  // Clear existing active toasts smoothly
  container.querySelectorAll('.toast').forEach(t => t.remove());

  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.style.cursor = 'pointer';
  toast.title = 'Click to dismiss';
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || 'ℹ️'}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
  `;

  toast.onclick = () => toast.remove();
  container.appendChild(toast);

  // Animate in
  animateMotion(toast, [
    { opacity: 0, transform: 'translateX(100%)' },
    { opacity: 1, transform: 'translateX(0)' }
  ], { duration: 250 });

  // Auto-remove after duration
  setTimeout(() => {
    animateMotion(toast, [
      { opacity: 1, transform: 'translateX(0)' },
      { opacity: 0, transform: 'translateX(100%)' }
    ], { duration: 200 }).then(() => toast.remove());
  }, duration);
}

// Accessibility Controls
function toggleHighContrast() {
  kioskState.highContrast = !kioskState.highContrast;
  document.body.classList.toggle('high-contrast', kioskState.highContrast);
  showToast(
    kioskState.highContrast ? 'High Contrast Enabled' : 'High Contrast Disabled',
    kioskState.highContrast ? 'Colors adjusted for better visibility.' : 'Standard colors restored.',
    'success'
  );
}

function toggleTextSize() {
  kioskState.largeText = !kioskState.largeText;
  document.body.classList.toggle('large-text', kioskState.largeText);
  showToast(
    kioskState.largeText ? 'Large Text Enabled' : 'Large Text Disabled',
    kioskState.largeText ? 'Text size increased for readability.' : 'Standard text size restored.',
    'success'
  );
}

// Handle Escape Key
function handleEscapeKey() {
  switch (kioskState.currentStep) {
    case 'welcome':
      // At welcome, do nothing or could redirect
      break;
    case 'visit-type':
      goToStep('welcome');
      break;
    case 'walkin-doctor':
      goToStep('visit-type');
      break;
    case 'booked-checkin':
      goToStep('visit-type');
      break;
    case 'queue-view':
      goToStep('visit-type');
      break;
    case 'patient-details':
      goToStep('walkin-doctor');
      break;
    case 'confirm-checkin':
      goToStep('booked-checkin');
      break;
    case 'success':
      resetKiosk();
      break;
  }
}

// Expose functions globally for inline onclick handlers
window.goToStep = goToStep;
window.selectLanguage = selectLanguage;
window.selectVisitType = selectVisitType;
window.handleVisitTypeNext = handleVisitTypeNext;
window.selectSpecialty = selectSpecialty;
window.selectDoctor = selectDoctor;
window.handleDoctorNext = handleDoctorNext;
window.selectCheckinMethod = selectCheckinMethod;
window.handleCheckinNext = handleCheckinNext;
window.handleConfirmCheckin = handleConfirmCheckin;
window.handleWalkinSubmit = handleWalkinSubmit;
window.selectQueueFilter = selectQueueFilter;
window.resetKiosk = resetKiosk;
window.toggleHighContrast = toggleHighContrast;
window.toggleTextSize = toggleTextSize;