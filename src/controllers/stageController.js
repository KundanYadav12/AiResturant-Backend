const db = require('../config/database');
const crypto = require('crypto');

// Get custom stages for customers (Public route via tableToken)
exports.getStagesByTableToken = async (req, res) => {
  const { tableToken } = req.params;
  try {
    const [tables] = await db.query(
      `SELECT t.*, r.id as restaurant_id FROM tables t
       JOIN restaurants r ON t.restaurant_id = r.id
       WHERE t.table_token = ?`,
      [tableToken]
    );

    if (tables.length === 0) {
      return res.status(404).json({ error: 'Table or QR code is invalid' });
    }
    const restaurantId = tables[0].restaurant_id;

    // Fetch active stages ordered by ranking
    let [stages] = await db.query(
      'SELECT id, name, rank_order, is_active FROM restaurant_order_stages WHERE restaurant_id = ? AND is_active = TRUE ORDER BY rank_order ASC',
      [restaurantId]
    );

    // Dynamic Seeder Fallback: if no stages configured yet, seed the defaults and return them
    if (stages.length === 0) {
      const defaultStages = ['Order Received', 'Accepted', 'Preparing', 'Ready', 'Delivered'];
      console.log(`🌱 Dynamic seeder: Seeding default stages for restaurant ${restaurantId}`);
      for (let i = 0; i < defaultStages.length; i++) {
        const id = `stage-${restaurantId}-${i}`;
        await db.query(
          'INSERT INTO restaurant_order_stages (id, restaurant_id, name, rank_order, is_active) VALUES (?, ?, ?, ?, TRUE)',
          [id, restaurantId, defaultStages[i], i]
        );
      }
      // Re-fetch
      [stages] = await db.query(
        'SELECT id, name, rank_order, is_active FROM restaurant_order_stages WHERE restaurant_id = ? AND is_active = TRUE ORDER BY rank_order ASC',
        [restaurantId]
      );
    }

    res.json(stages);
  } catch (error) {
    console.error('Get stages by table token error:', error);
    res.status(500).json({ error: 'Failed to retrieve order stages' });
  }
};

// Get all stages for owner / manager (Admin route)
exports.getStages = async (req, res) => {
  const restaurantId = req.params.restaurantId || req.user?.restaurantId;
  if (!restaurantId) {
    return res.status(400).json({ error: 'Restaurant ID is required' });
  }

  try {
    let [stages] = await db.query(
      'SELECT * FROM restaurant_order_stages WHERE restaurant_id = ? ORDER BY rank_order ASC',
      [restaurantId]
    );

    // Fallback dynamic seeder
    if (stages.length === 0) {
      const defaultStages = ['Order Received', 'Accepted', 'Preparing', 'Ready', 'Delivered'];
      for (let i = 0; i < defaultStages.length; i++) {
        const id = `stage-${restaurantId}-${i}`;
        await db.query(
          'INSERT INTO restaurant_order_stages (id, restaurant_id, name, rank_order, is_active) VALUES (?, ?, ?, ?, TRUE)',
          [id, restaurantId, defaultStages[i], i]
        );
      }
      [stages] = await db.query(
        'SELECT * FROM restaurant_order_stages WHERE restaurant_id = ? ORDER BY rank_order ASC',
        [restaurantId]
      );
    }

    res.json(stages);
  } catch (error) {
    console.error('Get stages error:', error);
    res.status(500).json({ error: 'Failed to retrieve order stages' });
  }
};

// Create a new stage (Owner)
exports.createStage = async (req, res) => {
  const restaurantId = req.params.restaurantId || req.user?.restaurantId;
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Stage name is required' });
  }

  try {
    const [maxRank] = await db.query(
      'SELECT MAX(rank_order) as max_rank FROM restaurant_order_stages WHERE restaurant_id = ?',
      [restaurantId]
    );
    const nextRank = (maxRank[0].max_rank || 0) + 1;
    const stageId = 'stg_' + crypto.randomBytes(8).toString('hex');

    await db.query(
      'INSERT INTO restaurant_order_stages (id, restaurant_id, name, rank_order, is_active) VALUES (?, ?, ?, ?, TRUE)',
      [stageId, restaurantId, name.trim(), nextRank]
    );

    res.status(201).json({
      message: 'Order stage created successfully',
      stage: { id: stageId, restaurant_id: restaurantId, name: name.trim(), rank_order: nextRank, is_active: true }
    });
  } catch (error) {
    console.error('Create stage error:', error);
    res.status(500).json({ error: 'Failed to create order stage' });
  }
};

// Reorder stages rankings (Owner)
exports.reorderStages = async (req, res) => {
  const restaurantId = req.params.restaurantId || req.user?.restaurantId;
  const { stages } = req.body; // array of { id, rank_order }

  if (!stages || !Array.isArray(stages)) {
    return res.status(400).json({ error: 'Stages reorder array is required' });
  }

  const pool = db.getPool ? db.getPool() : db;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const stg of stages) {
      await connection.query(
        'UPDATE restaurant_order_stages SET rank_order = ? WHERE id = ? AND restaurant_id = ?',
        [stg.rank_order, stg.id, restaurantId]
      );
    }

    await connection.commit();
    res.json({ message: 'Stages reordered successfully' });
  } catch (error) {
    await connection.rollback();
    console.error('Reorder stages error:', error);
    res.status(500).json({ error: 'Failed to reorder stages' });
  } finally {
    connection.release();
  }
};

// Update stage details name / status (Owner)
exports.updateStage = async (req, res) => {
  const restaurantId = req.params.restaurantId || req.user?.restaurantId;
  const { stageId } = req.params;
  const { name, is_active } = req.body;

  try {
    const [existing] = await db.query(
      'SELECT * FROM restaurant_order_stages WHERE id = ? AND restaurant_id = ?',
      [stageId, restaurantId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: 'Order stage not found' });
    }

    const updatedName = name !== undefined ? name.trim() : existing[0].name;
    const updatedActive = is_active !== undefined ? !!is_active : existing[0].is_active;

    await db.query(
      'UPDATE restaurant_order_stages SET name = ?, is_active = ? WHERE id = ? AND restaurant_id = ?',
      [updatedName, updatedActive, stageId, restaurantId]
    );

    res.json({
      message: 'Stage updated successfully',
      stage: { id: stageId, restaurant_id: restaurantId, name: updatedName, is_active: updatedActive }
    });
  } catch (error) {
    console.error('Update stage error:', error);
    res.status(500).json({ error: 'Failed to update order stage' });
  }
};

// Delete a stage (Owner)
exports.deleteStage = async (req, res) => {
  const restaurantId = req.params.restaurantId || req.user?.restaurantId;
  const { stageId } = req.params;

  try {
    const [existing] = await db.query(
      'SELECT * FROM restaurant_order_stages WHERE id = ? AND restaurant_id = ?',
      [stageId, restaurantId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: 'Order stage not found' });
    }

    const stageName = existing[0].name;

    // VALIDATION RULE: A stage currently being used by active orders cannot be deleted
    // Check if any order currently has this status and is not delivered or rejected
    const [activeOrders] = await db.query(
      "SELECT COUNT(*) as count FROM orders WHERE restaurant_id = ? AND status = ? AND status NOT IN ('Delivered', 'REJECTED')",
      [restaurantId, stageName]
    );

    if (activeOrders[0].count > 0) {
      return res.status(400).json({
        error: `This status is currently assigned to active orders. Please move those orders to another status before deleting this stage.`
      });
    }

    await db.query(
      'DELETE FROM restaurant_order_stages WHERE id = ? AND restaurant_id = ?',
      [stageId, restaurantId]
    );

    res.json({ message: 'Order stage deleted successfully' });
  } catch (error) {
    console.error('Delete stage error:', error);
    res.status(500).json({ error: 'Failed to delete order stage' });
  }
};
