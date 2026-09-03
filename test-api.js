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

async function test() {
  try {
    // Login as admin
    const loginRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ email: 'admin@clinic.com', password: 'admin123' }));

    console.log('Login response:', loginRes.status, loginRes.data);

    if (loginRes.status === 200) {
      const { token } = JSON.parse(loginRes.data);

      // Test ABHA thresholds
      const thresholdsRes = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/abuse/thresholds',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      console.log('Thresholds:', thresholdsRes.status, thresholdsRes.data);

      // Test flagged users
      const flaggedRes = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/abuse/flagged-users',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      console.log('Flagged users:', flaggedRes.status, flaggedRes.data);

      // Test symptoms
      const symptomsRes = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/symptoms/admin/all',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      console.log('Symptoms:', symptomsRes.status, symptomsRes.data);

      // Test reports
      const reportsRes = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/reports/admin/all',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      console.log('Reports:', reportsRes.status, reportsRes.data);
    }
  } catch (err) {
    console.error('Test error:', err);
  }
}

test();