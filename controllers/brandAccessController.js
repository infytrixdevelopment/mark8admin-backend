// controllers/brandAccessController.js
const pool = require('../config/database');
const AuditService = require('../services/auditService');

// Helper function to extract IP and User Agent
const getRequestMetadata = (req) => ({
  ipAddress: req.ip || req.connection.remoteAddress || null,
  userAgent: req.get('user-agent') || null
});

// POST /api/admin/users/:userId/dashboards/:dashboardId/grant-access
// Grant access when user doesn't have dashboard access (same as add brand but specific endpoint)
const grantDashboardAccess = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { userId, dashboardId } = req.params;
    const { brandId, platformIds } = req.body;
    const adminUserId = req.user.userId;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    // Validation
    if (!brandId || !platformIds || !Array.isArray(platformIds) || platformIds.length === 0) {
      await AuditService.logFailure({
        userId,
        appId: dashboardId,
        brandId,
        action: 'GRANT_ACCESS',
        actionDetails: 'Failed: Invalid request body',
        requestBody: req.body,
        performedBy: adminUserId,
        ipAddress,
        userAgent
      }, new Error('brandId and platformIds (array) are required'));

      return res.status(400).json({
        success: false,
        message: 'brandId and platformIds (array) are required'
      });
    }

    await client.query('BEGIN');

    // Verify user exists
    const userCheck = await client.query(
      'SELECT user_id, first_name, last_name FROM t_users WHERE user_id = $1',
      [userId]
    );
    if (userCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify dashboard exists
    const dashboardCheck = await client.query(
      'SELECT brand_power_bi_dashboard_type_id, dashboard_type FROM public.t_brands_power_bi_dashboard_type WHERE brand_power_bi_dashboard_type_id = $1',
      [dashboardId]
    );
    if (dashboardCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Dashboard not found'
      });
    }

    // Verify brand exists
    const brandCheck = await client.query(
      'SELECT infytrix_brand_id, brand_name FROM public.neo_brand_master WHERE infytrix_brand_id = $1',
      [brandId]
    );
    if (brandCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Brand not found'
      });
    }

    // Check if brand-platforms are valid
    const platformCheck = await client.query(
      `SELECT platform_id 
       FROM public.t_brand_platform_mapping 
       WHERE brand_id = $1 
         AND platform_id = ANY($2::uuid[]) 
         AND status = 'ACTIVE'`,
      [brandId, platformIds]
    );

    if (platformCheck.rowCount !== platformIds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'One or more platforms are not valid for this brand'
      });
    }

    const insertedRecords = [];
    const now = new Date();

    // Insert records for each platform (HARD DELETE approach - just INSERT)
    for (const platformId of platformIds) {
      // Check if already exists
      const existingCheck = await client.query(
        `SELECT v3_t_user_app_brand_platform_mapping_id 
         FROM public.v3_t_user_app_brand_platform_mapping 
         WHERE user_id = $1 
           AND app_id = $2 
           AND brand_id = $3 
           AND platform_id = $4`,
        [userId, dashboardId, brandId, platformId]
      );

      if (existingCheck.rowCount > 0) {
        // Already exists, skip
        insertedRecords.push({ platformId, status: 'already_exists' });
        continue;
      }

      // Create new record
      const insertQuery = `
        INSERT INTO public.v3_t_user_app_brand_platform_mapping 
        (user_id, brand_id, app_id, platform_id, created_by, created_time_stamp, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')
        RETURNING *
      `;
      const result = await client.query(insertQuery, [
        userId,
        brandId,
        dashboardId,
        platformId,
        adminUserId,
        now
      ]);
      insertedRecords.push(result.rows[0]);
    }

    await client.query('COMMIT');

    // Log successful audit entry
    await AuditService.logSuccess({
      userId,
      appId: dashboardId,
      brandId,
      action: 'GRANT_ACCESS',
      actionDetails: `Granted access to ${userCheck.rows[0].first_name} ${userCheck.rows[0].last_name} for ${dashboardCheck.rows[0].dashboard_type} - ${brandCheck.rows[0].brand_name} with ${platformIds.length} platforms`,
      requestBody: req.body,
      performedBy: adminUserId,
      ipAddress,
      userAgent
    });

    return res.status(201).json({
      success: true,
      message: 'Dashboard access granted successfully',
      data: {
        userId: userId,
        dashboardId: dashboardId,
        brandId: brandId,
        platformsAdded: insertedRecords.length,
        records: insertedRecords
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error granting dashboard access:', error);

    const { userId, dashboardId } = req.params;
    const { brandId } = req.body;
    const adminUserId = req.user.userId;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    await AuditService.logFailure({
      userId,
      appId: dashboardId,
      brandId,
      action: 'GRANT_ACCESS',
      actionDetails: 'Failed with error',
      requestBody: req.body,
      performedBy: adminUserId,
      ipAddress,
      userAgent
    }, error);

    return res.status(500).json({
      success: false,
      message: 'Failed to grant dashboard access',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// POST /api/admin/users/:userId/dashboards/:dashboardId/brands
// Add brand access (when user already has dashboard access)
const addBrandAccess = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { userId, dashboardId } = req.params;
    const { brandId, platformIds } = req.body;
    const adminUserId = req.user.userId;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    // Validation
    if (!brandId || !platformIds || !Array.isArray(platformIds) || platformIds.length === 0) {
      await AuditService.logFailure({
        userId,
        appId: dashboardId,
        brandId,
        action: 'ADD_BRAND',
        actionDetails: 'Failed: Invalid request body',
        requestBody: req.body,
        performedBy: adminUserId,
        ipAddress,
        userAgent
      }, new Error('brandId and platformIds (array) are required'));

      return res.status(400).json({
        success: false,
        message: 'brandId and platformIds (array) are required'
      });
    }

    await client.query('BEGIN');

    // Verify brand exists
    const brandCheck = await client.query(
      'SELECT brand_name FROM public.neo_brand_master WHERE infytrix_brand_id = $1',
      [brandId]
    );
    if (brandCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Brand not found'
      });
    }

    // Check if brand-platforms are valid
    const platformCheck = await client.query(
      `SELECT platform_id 
       FROM public.t_brand_platform_mapping 
       WHERE brand_id = $1 
         AND platform_id = ANY($2::uuid[]) 
         AND status = 'ACTIVE'`,
      [brandId, platformIds]
    );

    if (platformCheck.rowCount !== platformIds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'One or more platforms are not valid for this brand'
      });
    }

    const insertedRecords = [];
    const now = new Date();

    // Insert records for each platform
    for (const platformId of platformIds) {
      const existingCheck = await client.query(
        `SELECT v3_t_user_app_brand_platform_mapping_id 
         FROM public.v3_t_user_app_brand_platform_mapping 
         WHERE user_id = $1 
           AND app_id = $2 
           AND brand_id = $3 
           AND platform_id = $4`,
        [userId, dashboardId, brandId, platformId]
      );

      if (existingCheck.rowCount > 0) {
        insertedRecords.push({ platformId, status: 'already_exists' });
        continue;
      }

      const insertQuery = `
        INSERT INTO public.v3_t_user_app_brand_platform_mapping 
        (user_id, brand_id, app_id, platform_id, created_by, created_time_stamp, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')
        RETURNING *
      `;
      const result = await client.query(insertQuery, [
        userId,
        brandId,
        dashboardId,
        platformId,
        adminUserId,
        now
      ]);
      insertedRecords.push(result.rows[0]);
    }

    await client.query('COMMIT');

    // Log audit
    await AuditService.logSuccess({
      userId,
      appId: dashboardId,
      brandId,
      action: 'ADD_BRAND',
      actionDetails: `Added brand ${brandCheck.rows[0].brand_name} with ${platformIds.length} platforms`,
      requestBody: req.body,
      performedBy: adminUserId,
      ipAddress,
      userAgent
    });

    return res.status(201).json({
      success: true,
      message: 'Brand access added successfully',
      data: {
        userId: userId,
        dashboardId: dashboardId,
        brandId: brandId,
        platformsAdded: insertedRecords.length,
        records: insertedRecords
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error adding brand access:', error);

    const { userId, dashboardId } = req.params;
    const { brandId } = req.body;
    const adminUserId = req.user.userId;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    await AuditService.logFailure({
      userId,
      appId: dashboardId,
      brandId,
      action: 'ADD_BRAND',
      actionDetails: 'Failed with error',
      requestBody: req.body,
      performedBy: adminUserId,
      ipAddress,
      userAgent
    }, error);

    return res.status(500).json({
      success: false,
      message: 'Failed to add brand access',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// PUT /api/admin/users/:userId/dashboards/:dashboardId/brands/:brandId/platforms
// Edit platforms for a brand (HARD DELETE removed platforms, INSERT new ones)
const editBrandPlatforms = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { userId, dashboardId, brandId } = req.params;
    const { platformIds } = req.body;
    const adminUserId = req.user.userId;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    // Validation
    if (!platformIds || !Array.isArray(platformIds)) {
      await AuditService.logFailure({
        userId,
        appId: dashboardId,
        brandId,
        action: 'EDIT_PLATFORMS',
        actionDetails: 'Failed: Invalid request body',
        requestBody: req.body,
        performedBy: adminUserId,
        ipAddress,
        userAgent
      }, new Error('platformIds (array) is required'));

      return res.status(400).json({
        success: false,
        message: 'platformIds (array) is required'
      });
    }

    await client.query('BEGIN');

    // Get currently assigned platforms
    const currentPlatforms = await client.query(
      `SELECT platform_id, v3_t_user_app_brand_platform_mapping_id
       FROM public.v3_t_user_app_brand_platform_mapping 
       WHERE user_id = $1 
         AND app_id = $2 
         AND brand_id = $3`,
      [userId, dashboardId, brandId]
    );

    const currentPlatformIds = currentPlatforms.rows.map(row => row.platform_id);
    const platformsToAdd = platformIds.filter(id => !currentPlatformIds.includes(id));
    const platformsToRemove = currentPlatformIds.filter(id => !platformIds.includes(id));

    const now = new Date();
    const updatedRecords = [];

    // HARD DELETE platforms to remove
    if (platformsToRemove.length > 0) {
      const mappingsToDelete = currentPlatforms.rows
        .filter(row => platformsToRemove.includes(row.platform_id))
        .map(row => row.v3_t_user_app_brand_platform_mapping_id);

      const deleteQuery = `
        DELETE FROM public.v3_t_user_app_brand_platform_mapping 
        WHERE v3_t_user_app_brand_platform_mapping_id = ANY($1::uuid[])
        RETURNING *
      `;
      const deleteResult = await client.query(deleteQuery, [mappingsToDelete]);
      
      deleteResult.rows.forEach(row => {
        updatedRecords.push({ action: 'deleted', ...row });
      });
    }

    // INSERT new platforms
    for (const platformId of platformsToAdd) {
      // Validate platform for this brand
      const validPlatform = await client.query(
        `SELECT platform_id 
         FROM public.t_brand_platform_mapping 
         WHERE brand_id = $1 
           AND platform_id = $2 
           AND status = 'ACTIVE'`,
        [brandId, platformId]
      );

      if (validPlatform.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Platform ${platformId} is not valid for this brand`
        });
      }

      // Insert new record
      const result = await client.query(
        `INSERT INTO public.v3_t_user_app_brand_platform_mapping 
         (user_id, brand_id, app_id, platform_id, created_by, created_time_stamp, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')
         RETURNING *`,
        [userId, brandId, dashboardId, platformId, adminUserId, now]
      );
      updatedRecords.push({ action: 'added', ...result.rows[0] });
    }

    await client.query('COMMIT');

    // Log audit
    await AuditService.logSuccess({
      userId,
      appId: dashboardId,
      brandId,
      action: 'EDIT_PLATFORMS',
      actionDetails: `Edited platforms: Added ${platformsToAdd.length}, Removed ${platformsToRemove.length}`,
      requestBody: req.body,
      performedBy: adminUserId,
      ipAddress,
      userAgent
    });

    return res.status(200).json({
      success: true,
      message: 'Brand platforms updated successfully',
      data: {
        userId: userId,
        dashboardId: dashboardId,
        brandId: brandId,
        platformsAdded: platformsToAdd.length,
        platformsRemoved: platformsToRemove.length,
        updates: updatedRecords
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error editing brand platforms:', error);

    const { userId, dashboardId, brandId } = req.params;
    const adminUserId = req.user.userId;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    await AuditService.logFailure({
      userId,
      appId: dashboardId,
      brandId,
      action: 'EDIT_PLATFORMS',
      actionDetails: 'Failed with error',
      requestBody: req.body,
      performedBy: adminUserId,
      ipAddress,
      userAgent
    }, error);

    return res.status(500).json({
      success: false,
      message: 'Failed to edit brand platforms',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// DELETE /api/admin/users/:userId/dashboards/:dashboardId/brands/:brandId
// Remove brand (HARD DELETE all platforms for this brand)
const removeBrandAccess = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { userId, dashboardId, brandId } = req.params;
    const adminUserId = req.user.userId;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    await client.query('BEGIN');

    // Get all mappings for this brand before deleting (for audit log)
    const mappingsToRemove = await client.query(
      `SELECT v3_t_user_app_brand_platform_mapping_id, platform_id 
       FROM public.v3_t_user_app_brand_platform_mapping 
       WHERE user_id = $1 
         AND app_id = $2 
         AND brand_id = $3`,
      [userId, dashboardId, brandId]
    );

    if (mappingsToRemove.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'No brand access found to remove'
      });
    }

    // HARD DELETE all mappings
    const deleteQuery = `
      DELETE FROM public.v3_t_user_app_brand_platform_mapping 
      WHERE user_id = $1 
        AND app_id = $2 
        AND brand_id = $3
      RETURNING *
    `;

    const result = await client.query(deleteQuery, [userId, dashboardId, brandId]);

    await client.query('COMMIT');

    // Log audit
    await AuditService.logSuccess({
      userId,
      appId: dashboardId,
      brandId,
      action: 'REMOVE_BRAND',
      actionDetails: `Removed brand with ${result.rowCount} platforms`,
      requestBody: { brandId, deletedCount: result.rowCount },
      performedBy: adminUserId,
      ipAddress,
      userAgent
    });

    return res.status(200).json({
      success: true,
      message: 'Brand access removed successfully',
      data: {
        userId: userId,
        dashboardId: dashboardId,
        brandId: brandId,
        platformsRemoved: result.rowCount,
        removedRecords: result.rows
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error removing brand access:', error);

    const { userId, dashboardId, brandId } = req.params;
    const adminUserId = req.user.userId;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    await AuditService.logFailure({
      userId,
      appId: dashboardId,
      brandId,
      action: 'REMOVE_BRAND',
      actionDetails: 'Failed with error',
      requestBody: { brandId },
      performedBy: adminUserId,
      ipAddress,
      userAgent
    }, error);

    return res.status(500).json({
      success: false,
      message: 'Failed to remove brand access',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// DELETE /api/admin/users/:userId/dashboards/:dashboardId
// Remove entire dashboard access (HARD DELETE all brands and platforms)
const removeDashboardAccess = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { userId, dashboardId } = req.params;
    const adminUserId = req.user.userId;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    await client.query('BEGIN');

    // Get count before deleting
    const countQuery = await client.query(
      `SELECT COUNT(*) as total_count,
              COUNT(DISTINCT brand_id) as brand_count
       FROM public.v3_t_user_app_brand_platform_mapping 
       WHERE user_id = $1 AND app_id = $2`,
      [userId, dashboardId]
    );

    if (parseInt(countQuery.rows[0].total_count) === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'No dashboard access found to remove'
      });
    }

    // HARD DELETE all mappings for this user-dashboard combination
    const deleteQuery = `
      DELETE FROM public.v3_t_user_app_brand_platform_mapping 
      WHERE user_id = $1 AND app_id = $2
      RETURNING *
    `;

    const result = await client.query(deleteQuery, [userId, dashboardId]);

    await client.query('COMMIT');

    // Log audit
    await AuditService.logSuccess({
      userId,
      appId: dashboardId,
      action: 'REMOVE_DASHBOARD',
      actionDetails: `Removed entire dashboard access with ${countQuery.rows[0].brand_count} brands and ${result.rowCount} platforms`,
      requestBody: { 
        userId, 
        dashboardId,
        brandsRemoved: parseInt(countQuery.rows[0].brand_count),
        platformsRemoved: result.rowCount
      },
      performedBy: adminUserId,
      ipAddress,
      userAgent
    });

    return res.status(200).json({
      success: true,
      message: 'Dashboard access removed successfully',
      data: {
        userId: userId,
        dashboardId: dashboardId,
        brandsRemoved: parseInt(countQuery.rows[0].brand_count),
        platformsRemoved: result.rowCount,
        removedRecords: result.rows
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error removing dashboard access:', error);

    const { userId, dashboardId } = req.params;
    const adminUserId = req.user.userId;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    await AuditService.logFailure({
      userId,
      appId: dashboardId,
      action: 'REMOVE_DASHBOARD',
      actionDetails: 'Failed with error',
      requestBody: { userId, dashboardId },
      performedBy: adminUserId,
      ipAddress,
      userAgent
    }, error);

    return res.status(500).json({
      success: false,
      message: 'Failed to remove dashboard access',
      error: error.message
    });
  } finally {
    client.release();
  }
};

module.exports = {
  grantDashboardAccess,
  addBrandAccess,
  editBrandPlatforms,
  removeBrandAccess,
  removeDashboardAccess
};