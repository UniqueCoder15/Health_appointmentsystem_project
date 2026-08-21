const express = require('express');
const bcrypt = require('bcryptjs');
const { queries, getDatabase } = require('../database/db');
const { generateToken, authenticateToken } = require('../middleware/auth');
const { validateRegister, validateLogin } = require('../middleware/validation');

const router = express.Router();

// Register new user (patient or doctor)
router.post('/register', validateRegister, async (req, res) => {
  try {
    const { email, password, full_name, phone, role = 'patient' } = req.body;

    // Check if user already exists
    const existingUser = queries.findUserByEmail.get(email);
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password
    const passwordHash = bcrypt.hashSync(password, 10);

    // Create user
    const avatar = req.body.avatar || (role === 'doctor' ? '👨‍⚕️' : (role === 'admin' ? '⚙️' : '👤'));
    const result = queries.createUser.run(email, passwordHash, full_name, phone || null, role, avatar);

    const user = queries.findUserById.get(result.lastInsertRowid);
    const token = generateToken(user);

    // Remove password hash from response
    const { password_hash, ...userWithoutPassword } = user;

    res.status(201).json({
      message: 'Registration successful',
      user: userWithoutPassword,
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', validateLogin, (req, res) => {
  try {
    const { email, password } = req.body;

    const user = queries.findUserByEmail.get(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = bcrypt.compareSync(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);
    const { password_hash, ...userWithoutPassword } = user;

    res.json({
      message: 'Login successful',
      user: userWithoutPassword,
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user profile
router.get('/me', authenticateToken, (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { password_hash, ...userWithoutPassword } = req.user;
  res.json({ user: userWithoutPassword });
});

// Update user profile
router.put('/profile', authenticateToken, (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { full_name, phone, password, current_password } = req.body;

    // Handle password change if provided
    if (password && current_password) {
      const validPassword = bcrypt.compareSync(current_password, req.user.password_hash);
      if (!validPassword) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }

      const newPasswordHash = bcrypt.hashSync(password, 10);
      queries.updateUser.run(full_name || req.user.full_name, phone || req.user.phone, req.user.id);
      // Update password separately
      getDatabase().prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(newPasswordHash, req.user.id);
    } else {
      queries.updateUser.run(full_name || req.user.full_name, phone || req.user.phone, req.user.id);
    }

    const updatedUser = queries.findUserById.get(req.user.id);

    const { password_hash, ...userWithoutPassword } = updatedUser;
    res.json({ user: userWithoutPassword });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;