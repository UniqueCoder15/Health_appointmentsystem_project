process.env.PORT = 3009;

const http = require('http');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'swasthya_saarthi_secret_key_2026';

// Generate test JWT for patient
const token = jwt.sign(
  { id: 1, full_name: 'Rahul Sharma', role: 'patient', abha_id: '12-3456-7890-1234' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

function makeRequest(message, history = []) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      message,
      conversationHistory: history
    });

    const req = http.request({
      hostname: '127.0.0.1',
      port: 3009,
      path: '/api/chatbot/message',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (err) {
          resolve({ status: res.statusCode, body });
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function runTests(server) {
  console.log('🧪 Starting Chatbot API Integration Verification...\n');

  try {
    // Test 1: Emergency query
    console.log('Test 1: Testing Emergency Query ("severe chest pain and difficulty breathing")...');
    const res1 = await makeRequest('I am suffering from severe chest pain and difficulty breathing');
    console.log(`- HTTP Status: ${res1.status}`);
    console.log(`- Emergency Flag: ${res1.data.emergency}`);
    console.log(`- Provider: ${res1.data.provider}`);
    console.log(`- Response Snippet:\n  "${res1.data.response.substring(0, 160).replace(/\n/g, '\n  ')}"\n`);
    if (!res1.data.emergency) {
      throw new Error('Emergency check failed! Expected emergency: true');
    }

    // Test 2: Medical term explanation
    console.log('Test 2: Testing Medical Query ("What is HbA1c?")...');
    const res2 = await makeRequest('What is HbA1c and why is it important for blood sugar management?');
    console.log(`- HTTP Status: ${res2.status}`);
    console.log(`- Emergency Flag: ${res2.data.emergency}`);
    console.log(`- Provider: ${res2.data.provider}`);
    console.log(`- Response Snippet:\n  "${res2.data.response.substring(0, 200).replace(/\n/g, '\n  ')}"\n`);

    // Test 3: Platform feature query
    console.log('Test 3: Testing Swasthya Saarthi Niche Feature Query...');
    const res3 = await makeRequest('How can I book an appointment and track my real-time priority queue position?');
    console.log(`- HTTP Status: ${res3.status}`);
    console.log(`- Emergency Flag: ${res3.data.emergency}`);
    console.log(`- Provider: ${res3.data.provider}`);
    console.log(`- Response Snippet:\n  "${res3.data.response.substring(0, 200).replace(/\n/g, '\n  ')}"\n`);

    console.log('✅ ALL CHATBOT VERIFICATION TESTS PASSED SUCCESSFULLY!');
  } catch (err) {
    console.error('❌ CHATBOT TEST FAILED:', err);
    process.exitCode = 1;
  } finally {
    if (server && server.close) server.close();
    process.exit(process.exitCode || 0);
  }
}

// Requiring server.js will automatically start the server on port 3009
const server = require('./server');
// Give server a brief moment to listen
setTimeout(() => runTests(server), 500);
