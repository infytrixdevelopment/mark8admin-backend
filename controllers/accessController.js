// controllers/accessController.js
const pool = require('../config/database');

// GET /api/admin/users/:userId/apps/:appId/access
// Check if user has access to specific app
const checkUserAppAccess = async (req, res) => {
  try {
    const { userId, appId } = req.params;

    // First verify user exists
    const userCheck = await pool.query(
      'SELECT user_id, first_name, last_name FROM v3_t_master_users WHERE user_id = $1',
      [userId]
    );

    if (userCheck.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check app exists
    const appCheck = await pool.query(
      'SELECT app_name FROM public.v3_t_master_apps WHERE app_id = $1',
      [appId]
    );

    if (appCheck.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'App not found'
      });
    }

    // Check if user has access to this app
    const accessQuery = `
      SELECT COUNT(*) as access_count
      FROM public.v3_t_user_app_brand_platform_mapping
      WHERE user_id = $1 AND app_id = $2
    `;

    const accessResult = await pool.query(accessQuery, [userId, appId]);
    const hasAccess = parseInt(accessResult.rows[0].access_count) > 0;

    return res.status(200).json({
      success: true,
      message: 'Access check completed',
      data: {
        userId: userId,
        appId: appId,
        appType: appCheck.rows[0].app_name,
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

// GET /api/admin/users/:userId/apps/:appId/brands
// Get all brands and platforms assigned to user for specific app
const getUserAppBrands = async (req, res) => {
  try {
    const { userId, appId } = req.params;

    // First check if user has access
    const accessCheck = await pool.query(
      `SELECT COUNT(*) as count 
       FROM public.v3_t_user_app_brand_platform_mapping 
       WHERE user_id = $1 AND app_id = $2`,
      [userId, appId]
    );

    if (parseInt(accessCheck.rows[0].count) === 0) {
      return res.status(404).json({
        success: false,
        message: 'User does not have access to this app'
      });
    }

    // Get all brands and their platforms for this user and app
    const query = `
      SELECT 
        uabp.v3_t_user_app_brand_platform_mapping_id as mapping_id,
        uabp.brand_id,
        b.brand_name,
        b.company_name,
        uabp.platform_id,
        p.platform as platform_name,
        p.platform_logo_url,
        uabp.created_time_stamp,
        uabp.updated_time_stamp
      FROM public.v3_t_user_app_brand_platform_mapping uabp
      INNER JOIN public.neo_brand_master b 
        ON uabp.brand_id = b.infytrix_brand_id
      INNER JOIN public.v3_t_master_platforms p 
        ON uabp.platform_id = p.platform_id
      WHERE uabp.user_id = $1 AND uabp.app_id = $2
      ORDER BY b.brand_name, p.platform
    `;

    const result = await pool.query(query, [userId, appId]);

    // Group by brand
    const brandMap = {};
    result.rows.forEach(row => {
      if (!brandMap[row.brand_id]) {
        brandMap[row.brand_id] = {
          brand_id: row.brand_id,
          brand_name: row.brand_name,
          company_name: row.company_name,
          platforms: []
        };
      }
      brandMap[row.brand_id].platforms.push({
        mapping_id: row.mapping_id,
        platform_id: row.platform_id,
        platform_name: row.platform_name,
        platform_logo_url: row.platform_logo_url,
        created_time_stamp: row.created_time_stamp,
        updated_time_stamp: row.updated_time_stamp
      });
    });

    const brands = Object.values(brandMap);

    return res.status(200).json({
      success: true,
      message: 'User brands and platforms fetched successfully',
      data: {
        userId: userId,
        appId: appId,
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

// GET /api/admin/users/:userId/access-tree
// Get user's full access tree (all apps, brands, platforms)
const getUserAccessTree = async (req, res) => {
  try {
    const { userId } = req.params;

    const query = `
      SELECT 
        d.app_id as app_id,
        d.app_name as app_name,
        b.infytrix_brand_id as brand_id,
        b.brand_name,
        p.platform_id,
        p.platform as platform_name
      FROM 
        public.v3_t_user_app_brand_platform_mapping uabp
      INNER JOIN 
        public.v3_t_master_apps d ON uabp.app_id = d.app_id
      INNER JOIN 
        public.neo_brand_master b ON uabp.brand_id = b.infytrix_brand_id
      INNER JOIN 
        public.v3_t_master_platforms p ON uabp.platform_id = p.platform_id
      WHERE 
        uabp.user_id = $1
      ORDER BY 
        d.app_name, b.brand_name, p.platform;
    `;

    const result = await pool.query(query, [userId]);

    if (result.rowCount === 0) {
      return res.status(200).json({
        success: true,
        message: 'User has no access grants.',
        data: []
      });
    }

    const appMap = new Map();

    result.rows.forEach(row => {
      // 1. App Level
      if (!appMap.has(row.app_id)) {
        appMap.set(row.app_id, {
          app_id: row.app_id,
          app_name: row.app_name,
          brands: new Map()
        });
      }

      // 2. Brand Level
      const app = appMap.get(row.app_id);
      if (!app.brands.has(row.brand_id)) {
        app.brands.set(row.brand_id, {
          brand_id: row.brand_id,
          brand_name: row.brand_name,
          platforms: []
        });
      }

      // 3. Platform Level
      const brand = app.brands.get(row.brand_id);
      brand.platforms.push({
        platform_id: row.platform_id,
        platform_name: row.platform_name
      });
    });

    const accessTree = Array.from(appMap.values()).map(app => {
      app.brands = Array.from(app.brands.values());
      return app;
    });

    return res.status(200).json({
      success: true,
      message: 'User access tree fetched successfully',
      data: accessTree
    });

  } catch (error) {
    console.error('Error fetching user access tree:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch user access tree',
      error: error.message
    });
  }
};

module.exports = {
  checkUserAppAccess,
  getUserAppBrands,
  getUserAccessTree
};