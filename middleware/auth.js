// middleware/auth.js
const jwt = require('jsonwebtoken');

// Mock JWT secret - replace with actual secret from central auth later
const JWT_SECRET = process.env.JWT_SECRET || 'mock-secret-key-replace-in-production';

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token is missing'
      });
    }

    // For now, using mock verification
    // Later this will connect to central auth service
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(403).json({
          success: false,
          message: 'Invalid or expired token'
        });
      }

      // Attach user info to request
      req.user = {
        userId: decoded.userId || decoded.user_id,
        email: decoded.email,
        role: decoded.role
      };

      next();
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Authentication error',
      error: error.message
    });
  }
};

// Mock token generator for testing (remove in production)
const generateMockToken = (userId, email, role = 'admin') => {
  return jwt.sign(
    { userId, email, role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
};

module.exports = {
  authenticateToken,
  generateMockToken
};