// controllers/brandAccessController.js
const pool = require('../config/database');
const AuditService = require('../services/auditService');

// Helper function to extract IP and User Agent
const getRequestMetadata = (req) => ({
  ipAddress: req.ip || req.connection.remoteAddress || null,
  userAgent: req.get('user-agent') || null
});

// POST /api/admin/users/:userId/apps/:appId/grant-access
// Grant access when user doesn't have app access
const grantAppAccess = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { userId, appId } = req.params;
    const { brandId, platformIds } = req.body;
    const adminUserId = req.user.userId;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    // Validation
    if (!brandId || !platformIds || !Array.isArray(platformIds) || platformIds.length === 0) {
      await AuditService.logFailure({
        userId,
        appId: appId,
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

    // Verify app exists
    const appCheck = await client.query(
      'SELECT app_id, app_name as dashboard_type FROM public.v3_t_master_apps WHERE app_id = $1',
      [appId]
    );
    if (appCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'App not found'
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

    // Check if brand-platforms are valid FOR THIS APP
    const platformCheck = await client.query(
      `SELECT platform_id 
       FROM public.v3_t_app_brand_platform_mapping 
       WHERE app_id = $1
         AND brand_id = $2 
         AND platform_id = ANY($3::uuid[]) 
         AND status = 'ACTIVE'`,
      [appId, brandId, platformIds]
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

    for (const platformId of platformIds) {
      // Check if already exists
      const existingCheck = await client.query(
        `SELECT v3_t_user_app_brand_platform_mapping_id 
         FROM public.v3_t_user_app_brand_platform_mapping 
         WHERE user_id = $1 
           AND app_id = $2 
           AND brand_id = $3 
           AND platform_id = $4`,
        [userId, appId, brandId, platformId]
      );

      if (existingCheck.rowCount > 0) {
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
        appId,
        platformId,
        adminUserId,
        now
      ]);
      insertedRecords.push(result.rows[0]);
    }

    await client.query('COMMIT');

    await AuditService.logSuccess({
      userId,
      appId: appId,
      brandId,
      action: 'GRANT_ACCESS',
      actionDetails: `Granted access to ${userCheck.rows[0].first_name} ${userCheck.rows[0].last_name} for ${appCheck.rows[0].dashboard_type} - ${brandCheck.rows[0].brand_name} with ${platformIds.length} platforms`,
      requestBody: req.body,
      performedBy: adminUserId,
      ipAddress,
      userAgent
    });

    return res.status(201).json({
      success: true,
      message: 'App access granted successfully',
      data: {
        userId: userId,
        appId: appId,
        brandId: brandId,
        platformsAdded: insertedRecords.length,
        records: insertedRecords
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error granting app access:', error);

    const { userId, appId } = req.params;
    const { brandId } = req.body;
    const adminUserId = req.user.userId;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    await AuditService.logFailure({
      userId,
      appId: appId,
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
      message: 'Failed to grant app access',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// POST /api/admin/users/:userId/apps/:appId/brands
// Add brand access (when user already has app access)
const addBrandAccess = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { userId, appId } = req.params;
    const { brandId, platformIds } = req.body;
    const adminUserId = req.user.userId;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    if (!brandId || !platformIds || !Array.isArray(platformIds) || platformIds.length === 0) {
      await AuditService.logFailure({
        userId,
        appId: appId,
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

    // Check if brand-platforms are valid FOR THIS APP
    const platformCheck = await client.query(
      `SELECT platform_id 
       FROM public.v3_t_app_brand_platform_mapping 
       WHERE app_id = $1
         AND brand_id = $2 
         AND platform_id = ANY($3::uuid[]) 
         AND status = 'ACTIVE'`,
      [appId, brandId, platformIds]
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

    for (const platformId of platformIds) {
      const existingCheck = await client.query(
        `SELECT v3_t_user_app_brand_platform_mapping_id 
         FROM public.v3_t_user_app_brand_platform_mapping 
         WHERE user_id = $1 
           AND app_id = $2 
           AND brand_id = $3 
           AND platform_id = $4`,
        [userId, appId, brandId, platformId]
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
        appId,
        platformId,
        adminUserId,
        now
      ]);
      insertedRecords.push(result.rows[0]);
    }

    await client.query('COMMIT');

    await AuditService.logSuccess({
      userId,
      appId: appId,
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
        appId: appId,
        brandId: brandId,
        platformsAdded: insertedRecords.length,
        records: insertedRecords
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error adding brand access:', error);

    const { userId, appId } = req.params;
    const { brandId } = req.body;
    const adminUserId = req.user.userId;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    await AuditService.logFailure({
      userId,
      appId: appId,
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

// PUT /api/admin/users/:userId/apps/:appId/brands/:brandId/platforms
// Edit platforms for a brand
const editBrandPlatforms = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { userId, appId, brandId } = req.params;
    const { platformIds } = req.body;
    const adminUserId = req.user.userId;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    if (!platformIds || !Array.isArray(platformIds)) {
      await AuditService.logFailure({
        userId,
        appId: appId,
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

    const currentPlatforms = await client.query(
      `SELECT platform_id, v3_t_user_app_brand_platform_mapping_id
       FROM public.v3_t_user_app_brand_platform_mapping 
       WHERE user_id = $1 
         AND app_id = $2 
         AND brand_id = $3`,
      [userId, appId, brandId]
    );

    const currentPlatformIds = currentPlatforms.rows.map(row => row.platform_id);
    const platformsToAdd = platformIds.filter(id => !currentPlatformIds.includes(id));
    const platformsToRemove = currentPlatformIds.filter(id => !platformIds.includes(id));

    const now = new Date();
    const updatedRecords = [];

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

    for (const platformId of platformsToAdd) {
      // Validate platform for this brand AND APP
      const validPlatform = await client.query(
        `SELECT platform_id 
         FROM public.v3_t_app_brand_platform_mapping 
         WHERE app_id = $1
           AND brand_id = $2 
           AND platform_id = $3 
           AND status = 'ACTIVE'`,
        [appId, brandId, platformId]
      );

      if (validPlatform.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Platform ${platformId} is not valid for this brand`
        });
      }

      const result = await client.query(
        `INSERT INTO public.v3_t_user_app_brand_platform_mapping 
         (user_id, brand_id, app_id, platform_id, created_by, created_time_stamp, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')
         RETURNING *`,
        [userId, brandId, appId, platformId, adminUserId, now]
      );
      updatedRecords.push({ action: 'added', ...result.rows[0] });
    }

    await client.query('COMMIT');

    await AuditService.logSuccess({
      userId,
      appId: appId,
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
        appId: appId,
        brandId: brandId,
        platformsAdded: platformsToAdd.length,
        platformsRemoved: platformsToRemove.length,
        updates: updatedRecords
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error editing brand platforms:', error);

    const { userId, appId, brandId } = req.params;
    const adminUserId = req.user.userId;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    await AuditService.logFailure({
      userId,
      appId: appId,
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

// DELETE /api/admin/users/:userId/apps/:appId/brands/:brandId
// Remove brand
const removeBrandAccess = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { userId, appId, brandId } = req.params;
    const adminUserId = req.user.userId;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    await client.query('BEGIN');

    const mappingsToRemove = await client.query(
      `SELECT v3_t_user_app_brand_platform_mapping_id, platform_id 
       FROM public.v3_t_user_app_brand_platform_mapping 
       WHERE user_id = $1 
         AND app_id = $2 
         AND brand_id = $3`,
      [userId, appId, brandId]
    );

    if (mappingsToRemove.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'No brand access found to remove'
      });
    }

    const deleteQuery = `
      DELETE FROM public.v3_t_user_app_brand_platform_mapping 
      WHERE user_id = $1 
        AND app_id = $2 
        AND brand_id = $3
      RETURNING *
    `;

    const result = await client.query(deleteQuery, [userId, appId, brandId]);

    await client.query('COMMIT');

    await AuditService.logSuccess({
      userId,
      appId: appId,
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
        appId: appId,
        brandId: brandId,
        platformsRemoved: result.rowCount,
        removedRecords: result.rows
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error removing brand access:', error);

    const { userId, appId, brandId } = req.params;
    const adminUserId = req.user.userId;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    await AuditService.logFailure({
      userId,
      appId: appId,
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

// DELETE /api/admin/users/:userId/apps/:appId
// Remove entire app access
const removeAppAccess = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { userId, appId } = req.params;
    const adminUserId = req.user.userId;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    await client.query('BEGIN');

    const countQuery = await client.query(
      `SELECT COUNT(*) as total_count,
              COUNT(DISTINCT brand_id) as brand_count
       FROM public.v3_t_user_app_brand_platform_mapping 
       WHERE user_id = $1 AND app_id = $2`,
      [userId, appId]
    );

    if (parseInt(countQuery.rows[0].total_count) === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'No app access found to remove'
      });
    }

    const deleteQuery = `
      DELETE FROM public.v3_t_user_app_brand_platform_mapping 
      WHERE user_id = $1 AND app_id = $2
      RETURNING *
    `;

    const result = await client.query(deleteQuery, [userId, appId]);

    await client.query('COMMIT');

    await AuditService.logSuccess({
      userId,
      appId: appId,
      action: 'REMOVE_APP',
      actionDetails: `Removed entire app access with ${countQuery.rows[0].brand_count} brands and ${result.rowCount} platforms`,
      requestBody: { 
        userId, 
        appId,
        brandsRemoved: parseInt(countQuery.rows[0].brand_count),
        platformsRemoved: result.rowCount
      },
      performedBy: adminUserId,
      ipAddress,
      userAgent
    });

    return res.status(200).json({
      success: true,
      message: 'App access removed successfully',
      data: {
        userId: userId,
        appId: appId,
        brandsRemoved: parseInt(countQuery.rows[0].brand_count),
        platformsRemoved: result.rowCount,
        removedRecords: result.rows
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error removing app access:', error);

    const { userId, appId } = req.params;
    const adminUserId = req.user.userId;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    await AuditService.logFailure({
      userId,
      appId: appId,
      action: 'REMOVE_APP',
      actionDetails: 'Failed with error',
      requestBody: { userId, appId },
      performedBy: adminUserId,
      ipAddress,
      userAgent
    }, error);

    return res.status(500).json({
      success: false,
      message: 'Failed to remove app access',
      error: error.message
    });
  } finally {
    client.release();
  }
};

module.exports = {
  grantAppAccess,
  addBrandAccess,
  editBrandPlatforms,
  removeBrandAccess,
  removeAppAccess
};