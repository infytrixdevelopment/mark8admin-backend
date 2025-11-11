// controllers/auditController.js
const AuditService = require('../services/auditService');

// GET /api/admin/audit-logs
// Get all audit logs with optional filters
const getAuditLogs = async (req, res) => {
  try {
    const { 
      userId, 
      appId, 
      brandId, 
      action, 
      startDate, 
      endDate,
      limit = 100 
    } = req.query;

    const filters = {};
    if (userId) filters.userId = userId;
    if (appId) filters.appId = appId;
    if (brandId) filters.brandId = brandId;
    if (action) filters.action = action;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;

    const logs = await AuditService.getAuditLogs(filters, parseInt(limit));

    return res.status(200).json({
      success: true,
      message: 'Audit logs fetched successfully',
      data: {
        logs: logs,
        total: logs.length,
        filters: filters
      }
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch audit logs',
      error: error.message
    });
  }
};

// GET /api/admin/audit-logs/users/:userId
// Get audit logs for a specific user
const getUserAuditLogs = async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50 } = req.query;

    const logs = await AuditService.getUserAuditLogs(userId, parseInt(limit));

    return res.status(200).json({
      success: true,
      message: 'User audit logs fetched successfully',
      data: {
        userId: userId,
        logs: logs,
        total: logs.length
      }
    });
  } catch (error) {
    console.error('Error fetching user audit logs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch user audit logs',
      error: error.message
    });
  }
};

// GET /api/admin/audit-logs/actions/:action
// Get audit logs by action type
const getAuditLogsByAction = async (req, res) => {
  try {
    const { action } = req.params;
    const { limit = 50 } = req.query;

    const logs = await AuditService.getAuditLogsByAction(action, parseInt(limit));

    return res.status(200).json({
      success: true,
      message: 'Audit logs fetched successfully',
      data: {
        action: action,
        logs: logs,
        total: logs.length
      }
    });
  } catch (error) {
    console.error('Error fetching audit logs by action:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch audit logs',
      error: error.message
    });
  }
};

module.exports = {
  getAuditLogs,
  getUserAuditLogs,
  getAuditLogsByAction
};