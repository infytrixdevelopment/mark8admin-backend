// controllers/dashboardController.js
const pool = require('../config/database');

// GET /api/admin/dashboards - Get all available dashboards
const getAllDashboards = async (req, res) => {
  try {
    const query = `
SELECT 
  app_id as dashboard_id,
  app_name as dashboard_type,  -- Use alias to avoid breaking frontend
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
      message: 'Dashboards fetched successfully',
      data: {
        dashboards: result.rows,
        total: result.rowCount
      }
    });
  } catch (error) {
    console.error('Error fetching dashboards:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboards',
      error: error.message
    });
  }
};

// GET /api/admin/dashboards/:dashboardId - Get specific dashboard
const getDashboardById = async (req, res) => {
  try {
    const { dashboardId } = req.params;

    const query = `
SELECT 
  app_id as dashboard_id,
  app_name as dashboard_type,
  status,
  created_time_stamp,
  updated_time_stamp
FROM public.v3_t_master_apps   
WHERE app_id = $1             
    `;

    const result = await pool.query(query, [dashboardId]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Dashboard not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Dashboard fetched successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard',
      error: error.message
    });
  }
};

module.exports = {
  getAllDashboards,
  getDashboardById
};