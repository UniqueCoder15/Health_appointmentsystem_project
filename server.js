const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

// Initialize database
const { initializeDatabase } = require('./database/init');
initializeDatabase();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/doctors', require('./routes/doctors'));
app.use('/api/specialties', require('./routes/specialties'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/kiosk', require('./routes/kiosk'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve patient frontend
app.get(['/patient', '/patient/*'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'patient', 'index.html'));
});

// Serve doctor frontend
app.get(['/doctor', '/doctor/*'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'doctor', 'index.html'));
});

// Serve admin frontend
app.get(['/admin', '/admin/*'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// Serve kiosk frontend
app.get(['/kiosk', '/kiosk/*'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'kiosk', 'index.html'));
});

// Default route - redirect to patient portal
app.get('/', (req, res) => {
  res.redirect('/patient');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

app.listen(PORT, () => {
  console.log(`🏥 Swasthya Saarthi — Smart Healthcare Platform running on http://localhost:${PORT}`);
  console.log(`   Patient Portal: http://localhost:${PORT}/patient`);
  console.log(`   Admin Portal:   http://localhost:${PORT}/admin`);
  console.log(`   API Base:       http://localhost:${PORT}/api`);
});

module.exports = app;