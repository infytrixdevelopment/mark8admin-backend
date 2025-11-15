// controllers/brandMappingController.js
const pool = require('../config/database');
const AuditService = require('../services/auditService');

// Helper function to extract IP and User Agent
const getRequestMetadata = (req) => ({
  ipAddress: req.ip || req.connection.remoteAddress || null,
  userAgent: req.get('user-agent') || null
});


// GET /api/admin/brand-mappings?appId=...
// Get brands that are already mapped for a specific app (for landing page list)
const getMappedBrands = async (req, res) => {
  try {
    const { appId } = req.query;
    if (!appId) {
      return res.status(400).json({ success: false, message: 'appId query parameter is required' });
    }

    // --- THIS QUERY IS UPDATED ---
    // Added 'dashboard_name' to the JSON_BUILD_OBJECT
    const query = `
      SELECT
        b.infytrix_brand_id as brand_id,
        b.brand_name,
        b.company_name,
        (SELECT JSON_AGG(
            JSON_BUILD_OBJECT(
              'platform_id', p.platform_id,
              'platform_name', p.platform,
              'has_dashboard', (pbi.app_brand_power_bi_dashboard_mapping_id IS NOT NULL),
              'dashboard_name', pbi.dashboard_type -- <-- THIS IS THE NEW LINE
            )
            ORDER BY p.platform
          )
         FROM v3_t_app_brand_platform_mapping abp
         JOIN v3_t_master_platforms p ON abp.platform_id = p.platform_id
         LEFT JOIN v3_t_app_brand_power_bi_dashboard_mapping pbi
           ON abp.app_id = pbi.app_id
           AND abp.brand_id = pbi.brand_id
           AND abp.platform_id = pbi.platform_id
           AND pbi.status = 'ACTIVE'
         WHERE abp.app_id = $1 
           AND abp.brand_id = b.infytrix_brand_id 
           AND abp.status = 'ACTIVE'
        ) as platforms
      FROM 
        public.neo_brand_master b
      WHERE 
        EXISTS ( 
          SELECT 1 
          FROM public.v3_t_app_brand_platform_mapping abp_exist
          WHERE abp_exist.app_id = $1 
            AND abp_exist.brand_id = b.infytrix_brand_id
            AND abp_exist.status = 'ACTIVE'
        )
      ORDER BY 
        b.brand_name;
    `;
    // --- END OF QUERY FIX ---

    const result = await pool.query(query, [appId]);

    return res.status(200).json({
      success: true,
      message: 'Mapped brands fetched successfully',
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching mapped brands:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch mapped brands',
      error: error.message
    });
  }
};

// GET /api/admin/brand-mappings/unmapped?appId=...
// Get brands that are NOT yet mapped for a specific app (for modal dropdown)
const getUnmappedBrands = async (req, res) => {
  try {
    const { appId } = req.query;
    if (!appId) {
      return res.status(400).json({ success: false, message: 'appId query parameter is required' });
    }

    // Get all brands that are NOT in the v3_t_app_brand_platform_mapping for this app_id
    const query = `
      SELECT 
        infytrix_brand_id as brand_id,
        brand_name
      FROM 
        public.neo_brand_master
      WHERE 
        infytrix_brand_id NOT IN (
          SELECT DISTINCT brand_id 
          FROM public.v3_t_app_brand_platform_mapping 
          WHERE app_id = $1
        )
      ORDER BY 
        brand_name;
    `;
    const result = await pool.query(query, [appId]);
    return res.status(200).json({
      success: true,
      message: 'Unmapped brands fetched successfully',
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching unmapped brands:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch unmapped brands',
      error: error.message
    });
  }
};

// GET /api/admin/brand-mappings/platforms
// Get all master platforms
const getAllPlatforms = async (req, res) => {
  try {
    const query = `
      SELECT platform_id, platform as platform_name, platform_logo_url 
      FROM public.v3_t_master_platforms 
      WHERE status = 'ACTIVE' 
      ORDER BY platform;
    `;
    const result = await pool.query(query);
    return res.status(200).json({
      success: true,
      message: 'All platforms fetched successfully',
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching all platforms:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch all platforms',
      error: error.message
    });
  }
};

// GET /api/admin/brand-mappings/power-bi-dashboards
// Get all master Power BI dashboard types
const getPowerBiDashboards = async (req, res) => {
  try {
    const query = `
      SELECT 
        master_power_bi_dashboard_type_id as dashboard_id, 
        dashboard_type 
      FROM public.v3_t_master_power_bi_dashboard_type
      WHERE status = 'ACTIVE' 
      ORDER BY dashboard_type;
    `;
    const result = await pool.query(query);
    return res.status(200).json({
      success: true,
      message: 'Power BI dashboards fetched successfully',
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching Power BI dashboards:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Power BI dashboards',
      error: error.message
    });
  }
};

// GET /api/admin/brand-mappings/:appId/:brandId
// Get the full mapping details for one app/brand (for edit mode)
const getBrandMappingDetails = async (req, res) => {
  try {
    const { appId, brandId } = req.params;

    // Get all platforms
    const platformsQuery = `
      SELECT platform_id 
      FROM public.v3_t_app_brand_platform_mapping
      WHERE app_id = $1 AND brand_id = $2 AND status = 'ACTIVE'
    `;
    
    // Get all dashboards
    const dashboardsQuery = `
      SELECT 
        app_brand_power_bi_dashboard_mapping_id,
        platform_id,
        master_power_bi_dashboard_type_id,
        dashboard_type,
        url,
        workspace_id,
        report_id,
        dataset_id
      FROM public.v3_t_app_brand_power_bi_dashboard_mapping
      WHERE app_id = $1 AND brand_id = $2 AND status = 'ACTIVE'
    `;
    
    const [platformsResult, dashboardsResult] = await Promise.all([
      pool.query(platformsQuery, [appId, brandId]),
      pool.query(dashboardsQuery, [appId, brandId])
    ]);

    const platform_ids = platformsResult.rows.map(r => r.platform_id);
    const dashboards = dashboardsResult.rows;

    return res.status(200).json({
      success: true,
      data: {
        platform_ids,
        dashboards
      }
    });

  } catch (error) {
    console.error('Error fetching brand mapping details:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch brand mapping details',
      error: error.message
    });
  }
};


// POST /api/admin/brand-mappings
// Create a new brand mapping (platforms and dashboards)
const createBrandMapping = async (req, res) => {
  const client = await pool.connect();
  try {
    const { appId, brandId, platformIds, dashboards } = req.body;
    const adminUserId = req.user.user_id;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    if (!appId || !brandId || !platformIds || platformIds.length === 0) {
      return res.status(400).json({ success: false, message: 'appId, brandId, and at least one platformId are required' });
    }

    await client.query('BEGIN');

    // 1. Insert into v3_t_app_brand_platform_mapping
    for (const platformId of platformIds) {
      const platformQuery = `
        INSERT INTO public.v3_t_app_brand_platform_mapping
        (app_id, brand_id, platform_id, created_by, created_time_stamp, status)
        VALUES ($1, $2, $3, $4, NOW(), 'ACTIVE')
      `;
      await client.query(platformQuery, [appId, brandId, platformId, adminUserId]);
    }

    // 2. Insert into v3_t_app_brand_power_bi_dashboard_mapping (if any)
    if (dashboards && dashboards.length > 0) {
      for (const dash of dashboards) {
        const pbiQuery = `
          INSERT INTO public.v3_t_app_brand_power_bi_dashboard_mapping
          (app_id, brand_id, platform_id, dashboard_type, url, created_by, created_time_stamp, status, workspace_id, report_id, dataset_id, master_power_bi_dashboard_type_id)
          VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'ACTIVE', $7, $8, $9, $10)
        `;
        await client.query(pbiQuery, [
          appId, brandId, dash.platformId, dash.dashboardType, dash.url, adminUserId,
          dash.workspaceId, dash.reportId, dash.datasetId, dash.masterDashboardId
        ]);
      }
    }
    
    await client.query('COMMIT');

    // Audit log
    await AuditService.logSuccess({
      appId: appId,
      brandId: brandId,
      action: 'CREATE_BRAND_MAPPING',
      actionDetails: `Created mapping for brandId ${brandId} with ${platformIds.length} platforms and ${dashboards.length} dashboards.`,
      requestBody: req.body,
      performedBy: adminUserId,
      ipAddress,
      userAgent
    });

    return res.status(201).json({
      success: true,
      message: 'Brand mapping created successfully'
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating brand mapping:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create brand mapping',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// PUT /api/admin/brand-mappings/:appId/:brandId
// Update an existing brand mapping (platforms and dashboards)
const updateBrandMapping = async (req, res) => {
  const client = await pool.connect();
  try {
    const { appId, brandId } = req.params;
    const { platformIds, dashboards } = req.body; // New desired state
    const adminUserId = req.user.user_id;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    if (!appId || !brandId || !platformIds) {
      return res.status(400).json({ success: false, message: 'appId, brandId, and platformIds (array) are required' });
    }

    await client.query('BEGIN');

    // --- OPTIMIZATION START ---
    // 1. Get the current list of platforms for this brand mapping
    const currentPlatformsQuery = await client.query(
      `SELECT platform_id FROM public.v3_t_app_brand_platform_mapping WHERE app_id = $1 AND brand_id = $2`,
      [appId, brandId]
    );
    const currentPlatformIds = currentPlatformsQuery.rows.map(r => r.platform_id);
    
    // 2. Calculate the "delta" (changes)
    const platformsToRemove = currentPlatformIds.filter(id => !platformIds.includes(id));
    const platformsToAdd = platformIds.filter(id => !currentPlatformIds.includes(id));
    // --- OPTIMIZATION END ---


    // 1. SYNC v3_t_app_brand_platform_mapping (NOW OPTIMIZED)
    
    // --- 1a. Delete only the removed platforms ---
    if (platformsToRemove.length > 0) {
      await client.query(
        `DELETE FROM public.v3_t_app_brand_platform_mapping 
         WHERE app_id = $1 
           AND brand_id = $2 
           AND platform_id = ANY($3::uuid[])`,
        [appId, brandId, platformsToRemove]
      );
    }

    // --- 1b. Insert only the new platforms ---
    if (platformsToAdd.length > 0) {
      for (const platformId of platformsToAdd) {
        const platformQuery = `
          INSERT INTO public.v3_t_app_brand_platform_mapping
          (app_id, brand_id, platform_id, created_by, created_time_stamp, updated_by, updated_time_stamp, status)
          VALUES ($1, $2, $3, $4, NOW(), $4, NOW(), 'ACTIVE')
        `;
        // Note: We're setting created_by and updated_by to the admin,
        // which is correct for a new mapping entry.
        await client.query(platformQuery, [appId, brandId, platformId, adminUserId]);
      }
    }

    // 2. SYNC v3_t_app_brand_power_bi_dashboard_mapping
    // This table is still fine to sync (delete all, re-add)
    // as it's complex to check for deltas on all dashboard fields.
    await client.query(
      `DELETE FROM public.v3_t_app_brand_power_bi_dashboard_mapping WHERE app_id = $1 AND brand_id = $2`,
      [appId, brandId]
    );

    // Insert new PBI mappings (if any)
    if (dashboards && dashboards.length > 0) {
      for (const dash of dashboards) {
        const pbiQuery = `
          INSERT INTO public.v3_t_app_brand_power_bi_dashboard_mapping
          (app_id, brand_id, platform_id, dashboard_type, url, created_by, created_time_stamp, updated_by, updated_time_stamp, status, workspace_id, report_id, dataset_id, master_power_bi_dashboard_type_id)
          VALUES ($1, $2, $3, $4, $5, $6, NOW(), $6, NOW(), 'ACTIVE', $7, $8, $9, $10)
        `;
        await client.query(pbiQuery, [
          appId, brandId, dash.platformId, dash.dashboardType, dash.url, adminUserId,
          dash.workspaceId, dash.reportId, dash.datasetId, dash.masterDashboardId
        ]);
      }
    }

    // 3. SYNC the user access table (This was already optimized)
    // --- This logic is still correct, it uses the calculated platformsToRemove ---
    if (platformsToRemove.length > 0) {
      await client.query(
        `DELETE FROM public.v3_t_user_app_brand_platform_mapping 
         WHERE app_id = $1 
           AND brand_id = $2 
           AND platform_id = ANY($3::uuid[])`,
        [appId, brandId, platformsToRemove]
      );
    }
    
    await client.query('COMMIT');

    // Audit log
    await AuditService.logSuccess({
      appId: appId,
      brandId: brandId,
      action: 'UPDATE_BRAND_MAPPING',
      actionDetails: `Updated mapping for brandId ${brandId}. Added: ${platformsToAdd.length}, Removed: ${platformsToRemove.length}. Synced ${dashboards.length} dashboards.`,
      requestBody: req.body,
      performedBy: adminUserId,
      ipAddress,
      userAgent
    });

    return res.status(200).json({
      success: true,
      message: 'Brand mapping updated successfully'
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating brand mapping:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update brand mapping',
      error: error.message
    });
  } finally {
    client.release();
  }
};
// DELETE /api/admin/brand-mappings/:appId/:brandId
// Delete a brand mapping (cascading delete)
const deleteBrandMapping = async (req, res) => {
  const client = await pool.connect();
  try {
    const { appId, brandId } = req.params;
    const adminUserId = req.user.user_id;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    await client.query('BEGIN');

    // 1. Delete from v3_t_app_brand_platform_mapping
    const res1 = await client.query(
      `DELETE FROM public.v3_t_app_brand_platform_mapping WHERE app_id = $1 AND brand_id = $2`,
      [appId, brandId]
    );
    
    // 2. Delete from v3_t_app_brand_power_bi_dashboard_mapping
    const res2 = await client.query(
      `DELETE FROM public.v3_t_app_brand_power_bi_dashboard_mapping WHERE app_id = $1 AND brand_id = $2`,
      [appId, brandId]
    );

    // 3. Delete from v3_t_user_app_brand_platform_mapping (the user table)
    const res3 = await client.query(
      `DELETE FROM public.v3_t_user_app_brand_platform_mapping WHERE app_id = $1 AND brand_id = $2`,
      [appId, brandId]
    );

    await client.query('COMMIT');
    
    // Audit log
    await AuditService.logSuccess({
      appId: appId,
      brandId: brandId,
      action: 'DELETE_BRAND_MAPPING',
      actionDetails: `Deleted all mappings for brandId ${brandId}. Removed ${res1.rowCount} platforms, ${res2.rowCount} dashboards, and ${res3.rowCount} user grants.`,
      requestBody: { appId, brandId },
      performedBy: adminUserId,
      ipAddress,
      userAgent
    });

    return res.status(200).json({
      success: true,
      message: 'Brand mapping deleted successfully',
      data: {
        deletedPlatforms: res1.rowCount,
        deletedDashboards: res2.rowCount,
        deletedUserGrants: res3.rowCount
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting brand mapping:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete brand mapping',
      error: error.message
    });
  } finally {
    client.release();
  }
};


module.exports = {
  getMappedBrands,
  getUnmappedBrands,
  getAllPlatforms,
  getPowerBiDashboards,
  getBrandMappingDetails,
  createBrandMapping,
  updateBrandMapping,
  deleteBrandMapping
  // We will add updateBrandMapping later
};