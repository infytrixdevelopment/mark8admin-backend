// routes/index.js
const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const userController = require('../controllers/UserController');
const dashboardController = require('../controllers/DashboardController');
const accessController = require('../controllers/AccessController');
const brandController = require('../controllers/BrandController');
const brandAccessController = require('../controllers/BrandAccessController');

// Apply authentication middleware to all admin routes
router.use('/api/admin', authenticateToken);

// ==================== USER ROUTES ====================
// Get all users
router.get('/api/admin/users', userController.getAllUsers);

// Get specific user
router.get('/api/admin/users/:userId', userController.getUserById);

// ==================== DASHBOARD ROUTES ====================
// Get all dashboards
router.get('/api/admin/dashboards', dashboardController.getAllDashboards);

// Get specific dashboard
router.get('/api/admin/dashboards/:dashboardId', dashboardController.getDashboardById);

// ==================== ACCESS CHECK ROUTES ====================
// Check if user has access to dashboard
router.get(
  '/api/admin/users/:userId/dashboards/:dashboardId/access',
  accessController.checkUserDashboardAccess
);

// Get user's brands and platforms for specific dashboard
router.get(
  '/api/admin/users/:userId/dashboards/:dashboardId/brands',
  accessController.getUserDashboardBrands
);

// ==================== BRAND ROUTES ====================
// Get available brands (not assigned to user)
router.get('/api/admin/brands/available', brandController.getAvailableBrands);

// Get platforms for a specific brand
router.get('/api/admin/brands/:brandId/platforms', brandController.getBrandPlatforms);

// Get assigned platforms for user-dashboard-brand combination
router.get(
  '/api/admin/brands/:brandId/platforms/assigned',
  brandController.getAssignedPlatforms
);

// ==================== BRAND ACCESS MANAGEMENT ROUTES ====================
// Add brand access (with platforms) for user
router.post(
  '/api/admin/users/:userId/dashboards/:dashboardId/brands',
  brandAccessController.addBrandAccess
);

// Edit brand platforms for user
router.put(
  '/api/admin/users/:userId/dashboards/:dashboardId/brands/:brandId/platforms',
  brandAccessController.editBrandPlatforms
);

// Remove brand access for user
router.delete(
  '/api/admin/users/:userId/dashboards/:dashboardId/brands/:brandId',
  brandAccessController.removeBrandAccess
);

module.exports = router;