// routes/index.js
const express = require('express');
const router = express.Router();

// const { authenticateToken } = require('../middleware/auth');
const userController = require('../controllers/userController');
const userManagementController = require('../controllers/userManagementController');
const appController = require('../controllers/appController');
const accessController = require('../controllers/accessController');
const brandController = require('../controllers/brandController');
const brandAccessController = require('../controllers/brandAccessController');
const auditController = require('../controllers/auditController');
const brandMappingController = require('../controllers/brandMappingController');
const authController = require('../controllers/authController');
// Apply authentication middleware to all admin routes
// router.use('/api/admin', authenticateToken);

// ==================== USER ROUTES ====================
// Get all users (with search and pagination)
router.get('/api/admin/users', authController.validateAdminFromCentralAuth, userManagementController.getAllUsers);

// Add new user
router.post('/api/admin/users',authController.validateAdminFromCentralAuth, userManagementController.addUser);

// Update user status
router.put('/api/admin/users/:userId/status',authController.validateAdminFromCentralAuth, userManagementController.updateUserStatus);

// Get specific user (original endpoint)
router.get('/api/admin/users/:userId',authController.validateAdminFromCentralAuth, userController.getUserById);

// ==================== App ROUTES ====================
// Get all apps
router.get('/api/admin/apps',authController.validateAdminFromCentralAuth, appController.getAllApps);

// Get specific app by id
router.get('/api/admin/apps/:appId',authController.validateAdminFromCentralAuth, appController.getAppById);

// ==================== ACCESS CHECK ROUTES ====================
// Check if user has access to dashboard
router.get('/api/admin/users/:userId/apps/:appId/access',authController.validateAdminFromCentralAuth, accessController.checkUserAppAccess);

// Get user's brands and platforms for specific apps
router.get('/api/admin/users/:userId/apps/:appId/brands',authController.validateAdminFromCentralAuth, accessController.getUserAppBrands);

// Get user's full access tree
router.get(
  '/api/admin/users/:userId/access-tree',
  authController.validateAdminFromCentralAuth, accessController.getUserAccessTree
);
// ==================== BRAND ROUTES ====================
// Get available brands (not assigned to user)
router.get('/api/admin/brands/available',authController.validateAdminFromCentralAuth, brandController.getAvailableBrands);

// Get platforms for a specific brand
router.get('/api/admin/brands/:brandId/platforms',authController.validateAdminFromCentralAuth, brandController.getBrandPlatforms);

// Get assigned platforms for user-dashboard-brand combination
router.get(
  '/api/admin/brands/:brandId/platforms/assigned',
  authController.validateAdminFromCentralAuth, brandController.getAssignedPlatforms
);

// ==================== BRAND ACCESS MANAGEMENT ROUTES ====================
// Grant dashboard access (when user doesn't have access)
// NEW ENDPOINT - specific for grant access flow
router.post('/api/admin/users/:userId/apps/:appId/grant-access', authController.validateAdminFromCentralAuth, brandAccessController.grantAppAccess);

// Add brand access (when user already has dashboard access)
router.post('/api/admin/users/:userId/apps/:appId/brands', authController.validateAdminFromCentralAuth, brandAccessController.addBrandAccess);

// Edit brand platforms for user
router.put('/api/admin/users/:userId/apps/:appId/brands/:brandId/platforms', authController.validateAdminFromCentralAuth, brandAccessController.editBrandPlatforms);

// Remove brand access for user (HARD DELETE)
router.delete('/api/admin/users/:userId/apps/:appId/brands/:brandId', authController.validateAdminFromCentralAuth, brandAccessController.removeBrandAccess);

// Remove entire dashboard access (HARD DELETE all brands/platforms)
// NEW ENDPOINT
router.delete('/api/admin/users/:userId/apps/:appId', authController.validateAdminFromCentralAuth, brandAccessController.removeAppAccess);

// ==================== BRAND MAPPING ROUTES (NEW) ====================
// Get brands already mapped to an app (landing page)
router.get('/api/admin/brand-mappings', authController.validateAdminFromCentralAuth, brandMappingController.getMappedBrands);

// Get brands NOT mapped to an app (for modal)
router.get('/api/admin/brand-mappings/unmapped', authController.validateAdminFromCentralAuth, brandMappingController.getUnmappedBrands);

// Get all master platforms (for modal)
router.get('/api/admin/brand-mappings/platforms', authController.validateAdminFromCentralAuth, brandMappingController.getAllPlatforms);

// Get all master Power BI dashboards (for sub-modal)
router.get('/api/admin/brand-mappings/power-bi-dashboards', authController.validateAdminFromCentralAuth, brandMappingController.getPowerBiDashboards);

// Get full details for one app-brand mapping (for edit)
router.get('/api/admin/brand-mappings/:appId/:brandId', authController.validateAdminFromCentralAuth, brandMappingController.getBrandMappingDetails);
// Create a new full brand mapping
router.post('/api/admin/brand-mappings', authController.validateAdminFromCentralAuth, brandMappingController.createBrandMapping);
// Update an existing full brand mapping
router.put('/api/admin/brand-mappings/:appId/:brandId', authController.validateAdminFromCentralAuth, brandMappingController.updateBrandMapping);
// Delete a full brand mapping (cascades to user table)
router.delete('/api/admin/brand-mappings/:appId/:brandId', authController.validateAdminFromCentralAuth, brandMappingController.deleteBrandMapping);

// ==================== AUDIT LOG ROUTES ====================
// Get all audit logs with filters
router.get('/api/admin/audit-logs', authController.validateAdminFromCentralAuth, auditController.getAuditLogs);

// Get audit logs for specific user
router.get('/api/admin/audit-logs/users/:userId', authController.validateAdminFromCentralAuth, auditController.getUserAuditLogs);

// Get audit logs by action type
router.get('/api/admin/audit-logs/actions/:action', authController.validateAdminFromCentralAuth, auditController.getAuditLogsByAction);

module.exports = router;