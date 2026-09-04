const http = require('http');

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function runTests() {
  console.log('--- STARTING SWASTHYA SAARTHI VERIFICATION TESTS ---');
  let passCount = 0;
  let failCount = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passCount++;
    } else {
      console.error(`[FAIL] ${message}`);
      failCount++;
    }
  }

  try {
    // Test 1: Register Patient
    const testEmail = `test_patient_${Date.now()}@example.com`;
    const regRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/auth/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({
      full_name: 'Test Patient',
      email: testEmail,
      phone: '+91-9876543210',
      password: 'Password123!'
    }));
    assert(regRes.status === 201, `Patient registration status 201 (Got ${regRes.status})`);
    const regData = JSON.parse(regRes.data);
    assert(regData.token && regData.user.id, 'Patient registration returned token and user');

    const patientToken = regData.token;

    // Test 2: Login Patient
    const loginRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ email: testEmail, password: 'Password123!' }));
    assert(loginRes.status === 200, `Patient login status 200 (Got ${loginRes.status})`);

    // Test 3: Get Patient Profile
    const meRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/auth/me',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${patientToken}` }
    });
    assert(meRes.status === 200, `Get profile status 200 (Got ${meRes.status})`);

    // Test 4: Get Doctors
    const docsRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/doctors',
      method: 'GET'
    });
    assert(docsRes.status === 200, `Get public doctors list status 200 (Got ${docsRes.status})`);
    const docsData = JSON.parse(docsRes.data);
    const doctorId = docsData.doctors[0]?.id || 1;

    // Test 5: Book Appointment (Patient)
    // Find next weekday in future
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 1 + Math.floor(Math.random() * 20));
    while (targetDate.getDay() === 0 || targetDate.getDay() === 6) {
      targetDate.setDate(targetDate.getDate() + 1);
    }
    const apptDateStr = targetDate.toISOString().split('T')[0];

    const randomHour = 9 + Math.floor(Math.random() * 5);
    const randomMin = (Math.floor(Math.random() * 4) * 15).toString().padStart(2, '0');
    const timeStr = `${randomHour.toString().padStart(2, '0')}:${randomMin}`;

    const bookRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/appointments',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${patientToken}`
      }
    }, JSON.stringify({
      doctor_id: doctorId,
      appointment_date: apptDateStr,
      appointment_time: timeStr,
      notes: 'Routine checkup & consultation',
      priority_level: 3,
      priority_reason: 'Standard appointment'
    }));
    assert(bookRes.status === 201, `Appointment booking status 201 (Got ${bookRes.status})`);
    const bookData = JSON.parse(bookRes.data);
    assert(bookData.appointment && bookData.appointment.id, 'Appointment object returned with ID');

    // Test 6: Fetch Patient's Appointments
    const myApptsRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/appointments/my',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${patientToken}` }
    });
    assert(myApptsRes.status === 200, `Fetch my appointments status 200 (Got ${myApptsRes.status})`);
    const myApptsData = JSON.parse(myApptsRes.data);
    assert(myApptsData.appointments && myApptsData.appointments.length > 0, 'My appointments list is non-empty');

    // Test 7: Kiosk Public Live Queue
    const kioskQueueRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/kiosk/queue',
      method: 'GET'
    });
    assert(kioskQueueRes.status === 200, `Kiosk public queue status 200 (Got ${kioskQueueRes.status})`);

    // Test 8: Admin Login & Stats
    const adminLoginRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ email: 'admin@clinic.com', password: 'admin123' }));
    assert(adminLoginRes.status === 200, `Admin login status 200 (Got ${adminLoginRes.status})`);
    const adminToken = JSON.parse(adminLoginRes.data).token;

    const adminStatsRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/admin/stats',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(adminStatsRes.status === 200, `Admin stats status 200 (Got ${adminStatsRes.status})`);

    console.log(`\n--- TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED ---`);
    process.exit(failCount === 0 ? 0 : 1);
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

runTests();
