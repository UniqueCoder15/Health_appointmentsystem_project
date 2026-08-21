const jwt = require('jsonwebtoken');
const { queries } = require('../database/db');

const JWT_SECRET = process.env.JWT_SECRET || 'clinic-appointment-secret-key-change-in-production';
const JWT_EXPIRES_IN = '24h';

function generateToken(user) {
  return jwt.sign(
    { id: Number(user.id), email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  // Attach user to request
  const user = queries.findUserById.get(decoded.id);
  if (!user) {
    return res.status(403).json({ error: 'User not found' });
  }

  req.user = user;
  next();
}

function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    const decoded = verifyToken(token);
    if (decoded) {
      const user = queries.findUserById.get(decoded.id);
      if (user) {
        req.user = user;
      }
    }
  }
  next();
}

// For SSE: EventSource cannot set headers, so accept token via query string
function authenticateTokenOrQuery(req, res, next) {
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  const user = queries.findUserById.get(decoded.id);
  if (!user) {
    return res.status(403).json({ error: 'User not found' });
  }

  req.user = user;
  next();
}

module.exports = {
  generateToken,
  verifyToken,
  authenticateToken,
  authenticateTokenOrQuery,
  authorizeRoles,
  optionalAuth,
  JWT_SECRET
};