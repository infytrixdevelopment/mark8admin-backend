// controllers/userManagementController.js
const pool = require('../config/database');
const Joi = require('joi');
const AuditService = require('../services/auditService');

// Helper function to extract IP and User Agent
const getRequestMetadata = (req) => ({
  ipAddress: req.ip || req.connection.remoteAddress || null,
  userAgent: req.get('user-agent') || null
});

// Validation schemas
const addUserSchema = Joi.object({
  full_name: Joi.string().min(2).max(100).required().trim(),
  email: Joi.string().email().required().trim().lowercase(),
  password: Joi.string().min(8).required(),
  user_type: Joi.string().valid('ADMIN', 'ANALYST', 'MANAGER', 'CLIENT').required(),
  organisation: Joi.string().min(2).max(100).required().trim()
});

const updateUserStatusSchema = Joi.object({
  status: Joi.string().valid('ACTIVE', 'INACTIVE').required()
});

// GET /api/admin/users - Get all users with search and pagination
const getAllUsers = async (req, res) => {
  try {
    const { search = '', page = 1, limit = 10 } = req.query;

    // Convert to numbers
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // Base query
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

    // Add search filter if provided
    if (search && search.trim().length > 0) {
      query += ' WHERE full_name ILIKE $1';
      countQuery += ' WHERE full_name ILIKE $1';
      queryParams.push(`%${search.trim()}%`);
      countParams.push(`%${search.trim()}%`);
    }

    // Add ordering and pagination
    query += ' ORDER BY created_time_stamp DESC';
    const paramOffset = queryParams.length + 1;
    const paramLimit = queryParams.length + 2;
    query += ` LIMIT $${paramLimit} OFFSET $${paramOffset}`;
    queryParams.push(offset, limitNum);

    // Execute queries
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

    // Validate request body
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
      password, // Storing as plain text for now (as per your requirement)
      user_type,
      organisation,
      adminUserId
    ]);

    await client.query('COMMIT');

    const newUser = result.rows[0];

    // Log success
    await AuditService.logSuccess({
      userId: newUser.user_id,
      appId: null,
      action: 'ADD_USER',
      actionDetails: `Created new user: ${full_name} (${email})`,
      requestBody: { ...req.body, password: '***' }, // Don't log password
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

    // Validate request body
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

    // Check if user exists
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

    // Update status
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

    // Log success
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