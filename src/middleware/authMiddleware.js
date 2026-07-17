const jwt = require('jsonwebtoken');
require('dotenv').config();

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer TOKEN"
  if (!token) return res.status(401).json({ error: 'Access token required' });

  jwt.verify(token, process.env.JWT_SECRET || 'ai_restaurant_jwt_secure_secret_9988!', (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

// Restrict access to specific roles
function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied: insufficient permissions' });
    }
    next();
  };
}

// Ensure an owner/manager can only access their own restaurant's resources.
// Pass in URL param name (e.g. 'restaurantId') to check against.
function ensureRestaurantMatch(req, res, next) {
  const paramRestaurantId = req.params.restaurantId;
  if (paramRestaurantId && req.user.role !== 'SUPER_ADMIN') {
    if (req.user.restaurantId !== paramRestaurantId) {
      return res.status(403).json({ error: 'Access denied: restaurant mismatch' });
    }
  }
  next();
}

module.exports = { authenticateToken, requireRole, ensureRestaurantMatch };
