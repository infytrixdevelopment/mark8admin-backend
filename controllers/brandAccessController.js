// controllers/brandAccessController.js
const pool = require('../config/database');

// POST /api/admin/users/:userId/dashboards/:dashboardId/brands
// Add brand with selected platforms for user
const addBrandAccess = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { userId, dashboardId } = req.params;
    const { brandId, platformIds } = req.body; // platformIds is an array
    const adminUserId = req.user.userId; // From JWT token

    // Validation
    if (!brandId || !platformIds || !Array.isArray(platformIds) || platformIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'brandId and platformIds (array) are required'
      });
    }

    await client.query('BEGIN');

    // Verify user exists
    const userCheck = await client.query(
      'SELECT user_id FROM t_users WHERE user_id = $1',
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
      'SELECT brand_power_bi_dashboard_type_id FROM public.t_brands_power_bi_dashboard_type WHERE brand_power_bi_dashboard_type_id = $1',
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
      'SELECT infytrix_brand_id FROM public.neo_brand_master WHERE infytrix_brand_id = $1',
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
      // Check if this combination already exists (might be INACTIVE)
      const existingCheck = await client.query(
        `SELECT v3_t_user_app_brand_platform_mapping_id, status 
         FROM public.v3_t_user_app_brand_platform_mapping 
         WHERE user_id = $1 
           AND app_id = $2 
           AND brand_id = $3 
           AND platform_id = $4`,
        [userId, dashboardId, brandId, platformId]
      );

      if (existingCheck.rowCount > 0) {
        // If exists and INACTIVE, reactivate it
        if (existingCheck.rows[0].status === 'INACTIVE') {
          const updateQuery = `
            UPDATE public.v3_t_user_app_brand_platform_mapping 
            SET status = 'ACTIVE',
                updated_by = $1,
                updated_time_stamp = $2
            WHERE v3_t_user_app_brand_platform_mapping_id = $3
            RETURNING *
          `;
          const result = await client.query(updateQuery, [
            adminUserId,
            now,
            existingCheck.rows[0].v3_t_user_app_brand_platform_mapping_id
          ]);
          insertedRecords.push(result.rows[0]);
        } else {
          // Already active, skip
          insertedRecords.push(existingCheck.rows[0]);
        }
      } else {
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
    }

    await client.query('COMMIT');

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
// Edit platforms for a brand (add/remove platforms)
const editBrandPlatforms = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { userId, dashboardId, brandId } = req.params;
    const { platformIds } = req.body; // New array of platform IDs
    const adminUserId = req.user.userId;

    // Validation
    if (!platformIds || !Array.isArray(platformIds)) {
      return res.status(400).json({
        success: false,
        message: 'platformIds (array) is required'
      });
    }

    await client.query('BEGIN');

    // Get currently assigned platforms
    const currentPlatforms = await client.query(
      `SELECT platform_id, v3_t_user_app_brand_platform_mapping_id, status
       FROM public.v3_t_user_app_brand_platform_mapping 
       WHERE user_id = $1 
         AND app_id = $2 
         AND brand_id = $3`,
      [userId, dashboardId, brandId]
    );

    const currentPlatformIds = currentPlatforms.rows
      .filter(row => row.status === 'ACTIVE')
      .map(row => row.platform_id);

    const platformsToAdd = platformIds.filter(id => !currentPlatformIds.includes(id));
    const platformsToRemove = currentPlatformIds.filter(id => !platformIds.includes(id));

    const now = new Date();
    const updatedRecords = [];

    // Add new platforms
    for (const platformId of platformsToAdd) {
      // Check if valid platform for this brand
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

      // Check if exists as INACTIVE
      const existingInactive = currentPlatforms.rows.find(
        row => row.platform_id === platformId && row.status === 'INACTIVE'
      );

      if (existingInactive) {
        // Reactivate
        const result = await client.query(
          `UPDATE public.v3_t_user_app_brand_platform_mapping 
           SET status = 'ACTIVE',
               updated_by = $1,
               updated_time_stamp = $2
           WHERE v3_t_user_app_brand_platform_mapping_id = $3
           RETURNING *`,
          [adminUserId, now, existingInactive.v3_t_user_app_brand_platform_mapping_id]
        );
        updatedRecords.push({ action: 'reactivated', ...result.rows[0] });
      } else {
        // Create new
        const result = await client.query(
          `INSERT INTO public.v3_t_user_app_brand_platform_mapping 
           (user_id, brand_id, app_id, platform_id, created_by, created_time_stamp, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')
           RETURNING *`,
          [userId, brandId, dashboardId, platformId, adminUserId, now]
        );
        updatedRecords.push({ action: 'added', ...result.rows[0] });
      }
    }

    // Remove platforms (soft delete)
    for (const platformId of platformsToRemove) {
      const mappingToRemove = currentPlatforms.rows.find(
        row => row.platform_id === platformId && row.status === 'ACTIVE'
      );

      if (mappingToRemove) {
        const result = await client.query(
          `UPDATE public.v3_t_user_app_brand_platform_mapping 
           SET status = 'INACTIVE',
               updated_by = $1,
               updated_time_stamp = $2
           WHERE v3_t_user_app_brand_platform_mapping_id = $3
           RETURNING *`,
          [adminUserId, now, mappingToRemove.v3_t_user_app_brand_platform_mapping_id]
        );
        updatedRecords.push({ action: 'removed', ...result.rows[0] });
      }
    }

    await client.query('COMMIT');

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
// Remove brand (soft delete all platforms for this brand)
const removeBrandAccess = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { userId, dashboardId, brandId } = req.params;
    const adminUserId = req.user.userId;

    await client.query('BEGIN');

    // Get all active mappings for this brand
    const mappingsToRemove = await client.query(
      `SELECT v3_t_user_app_brand_platform_mapping_id 
       FROM public.v3_t_user_app_brand_platform_mapping 
       WHERE user_id = $1 
         AND app_id = $2 
         AND brand_id = $3 
         AND status = 'ACTIVE'`,
      [userId, dashboardId, brandId]
    );

    if (mappingsToRemove.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'No active brand access found to remove'
      });
    }

    // Soft delete all mappings
    const now = new Date();
    const updateQuery = `
      UPDATE public.v3_t_user_app_brand_platform_mapping 
      SET status = 'INACTIVE',
          updated_by = $1,
          updated_time_stamp = $2
      WHERE user_id = $3 
        AND app_id = $4 
        AND brand_id = $5 
        AND status = 'ACTIVE'
      RETURNING *
    `;

    const result = await client.query(updateQuery, [
      adminUserId,
      now,
      userId,
      dashboardId,
      brandId
    ]);

    await client.query('COMMIT');

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
    return res.status(500).json({
      success: false,
      message: 'Failed to remove brand access',
      error: error.message
    });
  } finally {
    client.release();
  }
};

module.exports = {
  addBrandAccess,
  editBrandPlatforms,
  removeBrandAccess
};