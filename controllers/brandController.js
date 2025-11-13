// controllers/brandController.js
const pool = require('../config/database');

// GET /api/admin/brands/available?userId=xxx&dashboardId=xxx
// Get brands that are NOT assigned to user for specific dashboard
const getAvailableBrands = async (req, res) => {
  try {
    const { userId, dashboardId } = req.query;

    if (!userId || !dashboardId) {
      return res.status(400).json({
        success: false,
        message: 'userId and dashboardId are required query parameters'
      });
    }

    // Get all active brands that are NOT assigned to this user for this dashboard
    // REMOVED status filter from subquery for hard delete
    const query = `
      SELECT DISTINCT
        b.infytrix_brand_id as brand_id,
        b.brand_name,
        b.company_name,
        b.brand_logo_url,
        b.status
      FROM public.neo_brand_master b
      WHERE b.status = 'ACTIVE'
        AND b.infytrix_brand_id NOT IN (
          SELECT DISTINCT brand_id 
          FROM public.v3_t_user_app_brand_platform_mapping
          WHERE user_id = $1 AND app_id = $2
        )
      ORDER BY b.brand_name ASC
    `;

    const result = await pool.query(query, [userId, dashboardId]);

    return res.status(200).json({
      success: true,
      message: 'Available brands fetched successfully',
      data: {
        brands: result.rows,
        total: result.rowCount
      }
    });
  } catch (error) {
    console.error('Error fetching available brands:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch available brands',
      error: error.message
    });
  }
};

// GET /api/admin/brands/:brandId/platforms
// Get all platforms available for a specific brand
const getBrandPlatforms = async (req, res) => {
  try {
    const { brandId } = req.params;
    const { dashboardId } = req.query;

    if (!dashboardId) {
      return res.status(400).json({
        success: false,
        message: 'dashboardId is required as a query parameter'
      });
    }
    // Verify brand exists
    const brandCheck = await pool.query(
      'SELECT brand_name FROM public.neo_brand_master WHERE infytrix_brand_id = $1',
      [brandId]
    );

    if (brandCheck.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Brand not found'
      });
    }

    // Get all platforms for this brand
const query = `
      SELECT 
        abp.v3_t_app_brand_platform_mapping_id as mapping_id,
        abp.brand_id,
        abp.platform_id,
        p.platform as platform_name,
        p.platform_logo_url,
        p.status as platform_status,
        abp.status as mapping_status
      FROM public.v3_t_app_brand_platform_mapping abp
      INNER JOIN public.v3_t_master_platforms p 
        ON abp.platform_id = p.platform_id
      WHERE abp.brand_id = $1 
        AND abp.app_id = $2
        AND abp.status = 'ACTIVE'
        AND p.status = 'ACTIVE'
      ORDER BY p.platform ASC
    `;

    const result = await pool.query(query, [brandId, dashboardId]);

return res.status(200).json({
      success: true,
      message: 'Brand platforms fetched successfully',
      data: {
        brandId: brandId,
        brandName: brandCheck.rows[0].brand_name,
        platforms: result.rows,
        total: result.rowCount
      }
    });
  } catch (error) {
    console.error('Error fetching brand platforms:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch brand platforms',
      error: error.message
    });
  }
};

// GET /api/admin/brands/:brandId/platforms/assigned?userId=xxx&dashboardId=xxx
// Get platforms already assigned to user for a specific brand and dashboard
const getAssignedPlatforms = async (req, res) => {
  try {
    const { brandId } = req.params;
    const { userId, dashboardId } = req.query;

    if (!userId || !dashboardId) {
      return res.status(400).json({
        success: false,
        message: 'userId and dashboardId are required query parameters'
      });
    }

    // REMOVED status filter for hard delete
    const query = `
      SELECT 
        uabp.v3_t_user_app_brand_platform_mapping_id as mapping_id,
        uabp.platform_id,
        p.platform as platform_name,
        p.platform_logo_url
      FROM public.v3_t_user_app_brand_platform_mapping uabp
      INNER JOIN public.v3_t_master_platforms p 
        ON uabp.platform_id = p.platform_id
      WHERE uabp.user_id = $1 
        AND uabp.app_id = $2 
        AND uabp.brand_id = $3
      ORDER BY p.platform ASC
    `;

    const result = await pool.query(query, [userId, dashboardId, brandId]);

    return res.status(200).json({
      success: true,
      message: 'Assigned platforms fetched successfully',
      data: {
        userId: userId,
        dashboardId: dashboardId,
        brandId: brandId,
        platforms: result.rows,
        total: result.rowCount
      }
    });
  } catch (error) {
    console.error('Error fetching assigned platforms:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch assigned platforms',
      error: error.message
    });
  }
};

module.exports = {
  getAvailableBrands,
  getBrandPlatforms,
  getAssignedPlatforms
};