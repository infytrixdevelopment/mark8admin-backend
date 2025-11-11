// services/auditService.js
const pool = require('../config/database');

/**
 * Centralized audit logging service
 * Logs all access management operations to t_access_audit_log table
 */
class AuditService {
  /**
   * Log an audit entry
   * @param {Object} auditData - Audit log data
   * @returns {Promise<Object>} Created audit log entry
   */
  static async logAction(auditData) {
    try {
      const {
        userId,
        appId,
        brandId = null,
        platformId = null,
        action,
        actionDetails,
        requestBody = null,
        responseStatus = 'SUCCESS',
        errorMessage = null,
        performedBy,
        ipAddress = null,
        userAgent = null
      } = auditData;

      const query = `
        INSERT INTO public.t_access_audit_log (
          user_id,
          app_id,
          brand_id,
          platform_id,
          action,
          action_details,
          request_body,
          response_status,
          error_message,
          performed_by,
          performed_at,
          ip_address,
          user_agent
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12)
        RETURNING *
      `;

      const values = [
        userId,
        appId,
        brandId,
        platformId,
        action,
        actionDetails,
        requestBody ? JSON.stringify(requestBody) : null,
        responseStatus,
        errorMessage,
        performedBy,
        ipAddress,
        userAgent
      ];

      const result = await pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      // Don't throw error - audit logging failure shouldn't break the main operation
      console.error('Audit logging failed:', error);
      return null;
    }
  }

  /**
   * Log successful action
   */
  static async logSuccess(data) {
    return await this.logAction({
      ...data,
      responseStatus: 'SUCCESS'
    });
  }

  /**
   * Log failed action
   */
  static async logFailure(data, error) {
    return await this.logAction({
      ...data,
      responseStatus: 'FAILED',
      errorMessage: error.message || error
    });
  }

  /**
   * Get audit logs for a user
   */
  static async getUserAuditLogs(userId, limit = 50) {
    try {
      const query = `
        SELECT 
          audit_id,
          user_id,
          app_id,
          brand_id,
          platform_id,
          action,
          action_details,
          request_body,
          response_status,
          error_message,
          performed_by,
          performed_at,
          ip_address
        FROM public.t_access_audit_log
        WHERE user_id = $1
        ORDER BY performed_at DESC
        LIMIT $2
      `;

      const result = await pool.query(query, [userId, limit]);
      return result.rows;
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      throw error;
    }
  }

  /**
   * Get audit logs by action type
   */
  static async getAuditLogsByAction(action, limit = 50) {
    try {
      const query = `
        SELECT 
          audit_id,
          user_id,
          app_id,
          brand_id,
          platform_id,
          action,
          action_details,
          request_body,
          response_status,
          performed_by,
          performed_at
        FROM public.t_access_audit_log
        WHERE action = $1
        ORDER BY performed_at DESC
        LIMIT $2
      `;

      const result = await pool.query(query, [action, limit]);
      return result.rows;
    } catch (error) {
      console.error('Error fetching audit logs by action:', error);
      throw error;
    }
  }

  /**
   * Get all audit logs with filters
   */
  static async getAuditLogs(filters = {}, limit = 100) {
    try {
      const { userId, appId, brandId, action, startDate, endDate } = filters;
      
      let query = `
        SELECT 
          a.audit_id,
          a.user_id,
          u.email as user_email,
          u.first_name,
          u.last_name,
          a.app_id,
          a.brand_id,
          b.brand_name,
          a.platform_id,
          p.platform as platform_name,
          a.action,
          a.action_details,
          a.request_body,
          a.response_status,
          a.error_message,
          a.performed_by,
          a.performed_at,
          a.ip_address
        FROM public.t_access_audit_log a
        LEFT JOIN t_user u ON a.user_id = u.user_id
        LEFT JOIN public.neo_brand_master b ON a.brand_id = b.infytrix_brand_id
        LEFT JOIN public.t_platform p ON a.platform_id = p.platform_id
        WHERE 1=1
      `;

      const values = [];
      let paramCount = 1;

      if (userId) {
        query += ` AND a.user_id = $${paramCount}`;
        values.push(userId);
        paramCount++;
      }

      if (appId) {
        query += ` AND a.app_id = $${paramCount}`;
        values.push(appId);
        paramCount++;
      }

      if (brandId) {
        query += ` AND a.brand_id = $${paramCount}`;
        values.push(brandId);
        paramCount++;
      }

      if (action) {
        query += ` AND a.action = $${paramCount}`;
        values.push(action);
        paramCount++;
      }

      if (startDate) {
        query += ` AND a.performed_at >= $${paramCount}`;
        values.push(startDate);
        paramCount++;
      }

      if (endDate) {
        query += ` AND a.performed_at <= $${paramCount}`;
        values.push(endDate);
        paramCount++;
      }

      query += ` ORDER BY a.performed_at DESC LIMIT $${paramCount}`;
      values.push(limit);

      const result = await pool.query(query, values);
      return result.rows;
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      throw error;
    }
  }
}

module.exports = AuditService;