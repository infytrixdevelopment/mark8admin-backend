// routes/index.js
const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const userController = require('../controllers/userController');
const userManagementController = require('../controllers/userManagementController');
const appController = require('../controllers/appController');
const accessController = require('../controllers/accessController');
const brandController = require('../controllers/brandController');
const brandAccessController = require('../controllers/brandAccessController');
const auditController = require('../controllers/auditController');

// Apply authentication middleware to all admin routes
router.use('/api/admin', authenticateToken);

// ==================== USER ROUTES ====================
// Get all users (with search and pagination)
router.get('/api/admin/users', userManagementController.getAllUsers);

// Add new user
router.post('/api/admin/users', userManagementController.addUser);

// Update user status
router.put('/api/admin/users/:userId/status', userManagementController.updateUserStatus);

// Get specific user (original endpoint)
router.get('/api/admin/users/:userId', userController.getUserById);

// ==================== App ROUTES ====================
// Get all apps
router.get('/api/admin/apps', appController.getAllApps);

// Get specific app by id
router.get('/api/admin/apps/:appId', appController.getAppById);

// ==================== ACCESS CHECK ROUTES ====================
// Check if user has access to dashboard
router.get('/api/admin/users/:userId/apps/:appId/access', accessController.checkUserAppAccess);

// Get user's brands and platforms for specific apps
router.get('/api/admin/users/:userId/apps/:appId/brands', accessController.getUserAppBrands);

// Get user's full access tree
router.get(
  '/api/admin/users/:userId/access-tree',
  accessController.getUserAccessTree
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
// Grant dashboard access (when user doesn't have access)
// NEW ENDPOINT - specific for grant access flow
router.post('/api/admin/users/:userId/apps/:appId/grant-access', brandAccessController.grantAppAccess);

// Add brand access (when user already has dashboard access)
router.post('/api/admin/users/:userId/apps/:appId/brands', brandAccessController.addBrandAccess);

// Edit brand platforms for user
router.put('/api/admin/users/:userId/apps/:appId/brands/:brandId/platforms', brandAccessController.editBrandPlatforms);

// Remove brand access for user (HARD DELETE)
router.delete('/api/admin/users/:userId/apps/:appId/brands/:brandId', brandAccessController.removeBrandAccess);

// Remove entire dashboard access (HARD DELETE all brands/platforms)
// NEW ENDPOINT
router.delete('/api/admin/users/:userId/apps/:appId', brandAccessController.removeAppAccess);

// ==================== AUDIT LOG ROUTES ====================
// Get all audit logs with filters
router.get('/api/admin/audit-logs', auditController.getAuditLogs);

// Get audit logs for specific user
router.get('/api/admin/audit-logs/users/:userId', auditController.getUserAuditLogs);

// Get audit logs by action type
router.get('/api/admin/audit-logs/actions/:action', auditController.getAuditLogsByAction);

module.exports = router;