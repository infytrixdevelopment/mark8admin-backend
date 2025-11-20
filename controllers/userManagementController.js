// controllers/userManagementController.js
const pool = require('../config/database');
const Joi = require('joi');
const AuditService = require('../services/auditService');
const axios = require('axios');
const { hashPassword } = require("./../utils/auth/password")
// Helper function to extract IP and User Agent
const getRequestMetadata = (req) => ({
  ipAddress: req.ip || req.connection.remoteAddress || null,
  userAgent: req.get('user-agent') || null
});

// Validation schemas - UPDATED to only allow MANAGER and USER
const addUserSchema = Joi.object({
  full_name: Joi.string().min(2).max(100).required().trim(),
  email: Joi.string().email().required().trim().lowercase(),
  password: Joi.string().min(8).required(),
  user_type: Joi.string().valid('MANAGER', 'USER').required(), // Only MANAGER and USER allowed
  organisation: Joi.string().min(2).max(100).required().trim()
});

const updateUserStatusSchema = Joi.object({
  status: Joi.string().valid('ACTIVE', 'INACTIVE').required()
});

// --- UPDATED HELPER ---
// Helper function to clear Redis cache in Central Auth
const clearRedisCache = async (token, userId = null) => {
  try {
    const authUrl = process.env.AUTH_URL || 'http://localhost:8000';

    if (userId) {
      await axios.get(`${authUrl}/api/v1/admin/clearSingleUserCache/${userId}`, {
        headers: { Authorization: token }
      });
      console.log(`Redis cache cleared for user: ${userId}`);
    } else {
      await axios.get(`${authUrl}/api/v1/admin/clearAllUsersCache`, {
        headers: { Authorization: token }
      });
      console.log('Redis cache cleared for all users');
    }
  } catch (error) {
    // Now we will see the real error if it's not 401
    console.error('Error clearing Redis cache:', error.response ? error.response.data : error.message);
  }
};

// GET /api/admin/users - Get all users with search and pagination
const getAllUsers = async (req, res) => {
  try {
    const { search = '', page = 1, limit = 10 } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    let query = `
      SELECT 
        user_id,
        full_name,
        email,
        user_type,
        organisation,
        status,
        created_time_stamp,
        last_login_time_stamp
      FROM v3_t_master_users
    `;

    let countQuery = 'SELECT COUNT(*) as total FROM v3_t_master_users';
    const queryParams = [];
    const countParams = [];

    if (search && search.trim().length > 0) {
      query += ' WHERE full_name ILIKE $1';
      countQuery += ' WHERE full_name ILIKE $1';
      queryParams.push(`%${search.trim()}%`);
      countParams.push(`%${search.trim()}%`);
    }

    query += ' ORDER BY created_time_stamp DESC';
    const paramOffset = queryParams.length + 1;
    const paramLimit = queryParams.length + 2;
    query += ` LIMIT $${paramLimit} OFFSET $${paramOffset}`;
    queryParams.push(offset, limitNum);

    const [usersResult, countResult] = await Promise.all([
      pool.query(query, queryParams),
      pool.query(countQuery, countParams)
    ]);

    return res.status(200).json({
      success: true,
      message: 'Users fetched successfully',
      data: {
        users: usersResult.rows,
        total: parseInt(countResult.rows[0].total),
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(parseInt(countResult.rows[0].total) / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: error.message
    });
  }
};

// POST /api/admin/users - Add new user
const addUser = async (req, res) => {
  const client = await pool.connect();

  try {
    const adminUserId = req.user.user_id;
    const { ipAddress, userAgent } = getRequestMetadata(req);
    const token = req.headers.authorization; // <-- Get the token

    // Validate request body - now only allows MANAGER and USER
    const { error, value } = addUserSchema.validate(req.body);
    if (error) {
      await AuditService.logFailure({
        userId: null,
        appId: null,
        action: 'ADD_USER',
        actionDetails: 'Validation failed',
        requestBody: req.body,
        performedBy: adminUserId,
        ipAddress,
        userAgent
      }, error);

      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(d => d.message)
      });
    }

    const { full_name, email, password, user_type, organisation } = value;

    await client.query('BEGIN');

    // Check if email already exists
    const existingUser = await client.query(
      'SELECT user_id, email FROM v3_t_master_users WHERE email = $1',
      [email]
    );

    if (existingUser.rowCount > 0) {
      await client.query('ROLLBACK');

      await AuditService.logFailure({
        userId: null,
        appId: null,
        action: 'ADD_USER',
        actionDetails: `Failed: Email ${email} already exists`,
        requestBody: req.body,
        performedBy: adminUserId,
        ipAddress,
        userAgent
      }, new Error('Email already exists'));

      return res.status(409).json({
        success: false,
        message: 'Email already exists'
      });
    }

    // Split full_name into first_name and last_name
    const nameParts = full_name.trim().split(' ');
    const first_name = nameParts[0];
    const last_name = nameParts.slice(1).join(' ') || null;


    const hashResult = await hashPassword(password);
    if (!hashResult || !hashResult.status) {
      return sendFailResponse(res, "Unable to hash password.", 500);
    }


    const newHashedPassword = hashResult.hashedPassword;


    // Insert new user
    const insertQuery = `
      INSERT INTO v3_t_master_users (
        first_name,
        last_name,
        full_name,
        email,
        password,
        user_type,
        organisation,
        status,
        created_by,
        created_time_stamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', $8, NOW())
      RETURNING user_id, full_name, email, user_type, organisation, status, created_time_stamp
    `;

    const result = await client.query(insertQuery, [
      first_name,
      last_name,
      full_name,
      email,
      newHashedPassword,
      user_type,
      organisation,
      adminUserId
    ]);

    await client.query('COMMIT');

    const newUser = result.rows[0];

    // Clear Redis cache for the new user
    // --- Pass the token ---
    await clearRedisCache(token, newUser.user_id);

    // Log success
    await AuditService.logSuccess({
      userId: newUser.user_id,
      appId: null,
      action: 'ADD_USER',
      actionDetails: `Created new user: ${full_name} (${email}) with type ${user_type}`,
      requestBody: { ...req.body, password: '***' },
      performedBy: adminUserId,
      ipAddress,
      userAgent
    });

    return res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: newUser
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error adding user:', error);

    const adminUserId = req.user.user_id;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    await AuditService.logFailure({
      userId: null,
      appId: null,
      action: 'ADD_USER',
      actionDetails: 'Failed with error',
      requestBody: req.body,
      performedBy: adminUserId,
      ipAddress,
      userAgent
    }, error);

    return res.status(500).json({
      success: false,
      message: 'Failed to create user',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// PUT /api/admin/users/:userId/status - Update user status
const updateUserStatus = async (req, res) => {
  const client = await pool.connect();

  try {
    const { userId } = req.params;
    const adminUserId = req.user.user_id;
    const { ipAddress, userAgent } = getRequestMetadata(req);
    const token = req.headers.authorization; // <-- Get the token

    const { error, value } = updateUserStatusSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(d => d.message)
      });
    }

    const { status } = value;

    await client.query('BEGIN');

    const userCheck = await client.query(
      'SELECT user_id, full_name, email, status FROM v3_t_master_users WHERE user_id = $1',
      [userId]
    );

    if (userCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const currentUser = userCheck.rows[0];

    const updateQuery = `
      UPDATE v3_t_master_users 
      SET status = $1,
          updated_by = $2,
          updated_time_stamp = NOW()
      WHERE user_id = $3
      RETURNING user_id, full_name, email, user_type, organisation, status, updated_time_stamp
    `;

    const result = await client.query(updateQuery, [status, adminUserId, userId]);

    await client.query('COMMIT');

    // Clear Redis cache for this user
    // --- Pass the token ---
    await clearRedisCache(token, userId);

    await AuditService.logSuccess({
      userId: userId,
      appId: null,
      action: 'UPDATE_USER_STATUS',
      actionDetails: `Updated status from ${currentUser.status} to ${status} for ${currentUser.full_name}`,
      requestBody: req.body,
      performedBy: adminUserId,
      ipAddress,
      userAgent
    });

    return res.status(200).json({
      success: true,
      message: 'User status updated successfully',
      data: result.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating user status:', error);

    const { userId } = req.params;
    const adminUserId = req.user.user_id;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    await AuditService.logFailure({
      userId: userId,
      appId: null,
      action: 'UPDATE_USER_STATUS',
      actionDetails: 'Failed with error',
      requestBody: req.body,
      performedBy: adminUserId,
      ipAddress,
      userAgent
    }, error);

    return res.status(500).json({
      success: false,
      message: 'Failed to update user status',
      error: error.message
    });
  } finally {
    client.release();
  }
};

module.exports = {
  getAllUsers,
  addUser,
  updateUserStatus
};