// controllers/accessController.js
const pool = require('../config/database');

// GET /api/admin/users/:userId/dashboards/:dashboardId/access
// Check if user has access to specific dashboard
const checkUserDashboardAccess = async (req, res) => {
  try {
    const { userId, dashboardId } = req.params;

    // First verify user exists
    const userCheck = await pool.query(
      'SELECT user_id, first_name, last_name FROM t_users WHERE user_id = $1',
      [userId]
    );

    if (userCheck.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check dashboard exists
    const dashboardCheck = await pool.query(
      'SELECT dashboard_type FROM public.t_brands_power_bi_dashboard_type WHERE brand_power_bi_dashboard_type_id = $1',
      [dashboardId]
    );

    if (dashboardCheck.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Dashboard not found'
      });
    }

    // Check if user has access to this dashboard
    const accessQuery = `
      SELECT COUNT(*) as access_count
      FROM public.v3_t_user_app_brand_platform_mapping
      WHERE user_id = $1 
        AND app_id = $2 
        AND status = 'ACTIVE'
    `;

    const accessResult = await pool.query(accessQuery, [userId, dashboardId]);
    const hasAccess = parseInt(accessResult.rows[0].access_count) > 0;

    return res.status(200).json({
      success: true,
      message: 'Access check completed',
      data: {
        userId: userId,
        dashboardId: dashboardId,
        dashboardType: dashboardCheck.rows[0].dashboard_type,
        userName: `${userCheck.rows[0].first_name} ${userCheck.rows[0].last_name}`,
        hasAccess: hasAccess
      }
    });
  } catch (error) {
    console.error('Error checking access:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to check access',
      error: error.message
    });
  }
};

// GET /api/admin/users/:userId/dashboards/:dashboardId/brands
// Get all brands and platforms assigned to user for specific dashboard
const getUserDashboardBrands = async (req, res) => {
  try {
    const { userId, dashboardId } = req.params;

    // First check if user has access
    const accessCheck = await pool.query(
      `SELECT COUNT(*) as count 
       FROM public.v3_t_user_app_brand_platform_mapping 
       WHERE user_id = $1 AND app_id = $2 AND status = 'ACTIVE'`,
      [userId, dashboardId]
    );

    if (parseInt(accessCheck.rows[0].count) === 0) {
      return res.status(404).json({
        success: false,
        message: 'User does not have access to this dashboard'
      });
    }

    // Get all brands and their platforms for this user and dashboard
    const query = `
      SELECT 
        uabp.v3_t_user_app_brand_platform_mapping_id as mapping_id,
        uabp.brand_id,
        b.brand_name,
        b.company_name,
        uabp.platform_id,
        p.platform as platform_name,
        p.platform_logo_url,
        uabp.status,
        uabp.created_time_stamp,
        uabp.updated_time_stamp
      FROM public.v3_t_user_app_brand_platform_mapping uabp
      INNER JOIN public.neo_brand_master b 
        ON uabp.brand_id = b.infytrix_brand_id
      INNER JOIN public.t_platform p 
        ON uabp.platform_id = p.platform_id
      WHERE uabp.user_id = $1 
        AND uabp.app_id = $2 
        AND uabp.status = 'ACTIVE'
      ORDER BY b.brand_name, p.platform
    `;

    const result = await pool.query(query, [userId, dashboardId]);

    // Group by brand
    const brandMap = {};
    result.rows.forEach(row => {
      if (!brandMap[row.brand_id]) {
        brandMap[row.brand_id] = {
          brandId: row.brand_id,
          brandName: row.brand_name,
          companyName: row.company_name,
          platforms: []
        };
      }
      brandMap[row.brand_id].platforms.push({
        mappingId: row.mapping_id,
        platformId: row.platform_id,
        platformName: row.platform_name,
        platformLogoUrl: row.platform_logo_url,
        status: row.status,
        createdTimeStamp: row.created_time_stamp,
        updatedTimeStamp: row.updated_time_stamp
      });
    });

    const brands = Object.values(brandMap);

    return res.status(200).json({
      success: true,
      message: 'User brands and platforms fetched successfully',
      data: {
        userId: userId,
        dashboardId: dashboardId,
        brands: brands,
        totalBrands: brands.length,
        totalPlatforms: result.rowCount
      }
    });
  } catch (error) {
    console.error('Error fetching user brands:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch user brands',
      error: error.message
    });
  }
};

module.exports = {
  checkUserDashboardAccess,
  getUserDashboardBrands
};