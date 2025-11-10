// controllers/userController.js
const pool = require('../config/database');

// GET /api/admin/users - Get all users
const getAllUsers = async (req, res) => {
  try {
    const query = `
      SELECT 
        user_id,
        email,
        first_name,
        last_name,
        status,
        created_time_stamp,
        updated_time_stamp
      FROM t_users
      WHERE status = 'ACTIVE'
      ORDER BY created_time_stamp DESC
    `;

    const result = await pool.query(query);

    return res.status(200).json({
      success: true,
      message: 'Users fetched successfully',
      data: {
        users: result.rows,
        total: result.rowCount
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

// GET /api/admin/users/:userId - Get specific user details
const getUserById = async (req, res) => {
  try {
    const { userId } = req.params;

    const query = `
      SELECT 
        user_id,
        email,
        first_name,
        last_name,
        status,
        created_time_stamp,
        updated_time_stamp
      FROM t_users
      WHERE user_id = $1
    `;

    const result = await pool.query(query, [userId]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'User fetched successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch user',
      error: error.message
    });
  }
};

module.exports = {
  getAllUsers,
  getUserById
};