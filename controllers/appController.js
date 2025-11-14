// controllers/appController.js
const pool = require('../config/database');

// GET /api/admin/apps - Get all available apps
const getAllApps = async (req, res) => {
  try {
    const query = `
      SELECT 
    app_id,
    app_name,
        status,
        created_time_stamp,
        updated_time_stamp
      FROM public.v3_t_master_apps
      WHERE status = 'ACTIVE'
      ORDER BY app_name ASC
    `;

    const result = await pool.query(query);

    return res.status(200).json({
      success: true,
      message: 'Apps fetched successfully',
      data: {
        apps: result.rows,
        total: result.rowCount
      }
    });
  } catch (error) {
    console.error('Error fetching apps:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch apps',
      error: error.message
    });
  }
};

// GET /api/admin/apps/:appId - Get specific app
const getAppById = async (req, res) => {
  try {
    const { appId } = req.params;

    const query = `
      SELECT 
        app_id,
        app_name,
        status,
        created_time_stamp,
        updated_time_stamp
      FROM public.v3_t_master_apps
      WHERE app_id = $1
    `;

    const result = await pool.query(query, [appId]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'App not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'App fetched successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching app:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch app',
      error: error.message
    });
  }
};

module.exports = {
  getAllApps,
  getAppById
};