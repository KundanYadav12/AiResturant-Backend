const db = require('../config/database');
const Table = require('../models/Table');

exports.getAnalytics = async (req, res) => {
  const restaurantId = req.user.restaurantId;

  try {
    // 1. Today's orders & revenue
    const [todayRows] = await db.query(
      `SELECT COUNT(id) as orderCount, COALESCE(SUM(total_amount), 0) as revenue 
       FROM orders 
       WHERE restaurant_id = ? AND status != 'REJECTED' AND DATE(created_at) = CURDATE()`,
      [restaurantId]
    );

    // 2. Weekly revenue
    const [weeklyRows] = await db.query(
      `SELECT COALESCE(SUM(total_amount), 0) as revenue 
       FROM orders 
       WHERE restaurant_id = ? AND status != 'REJECTED' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`,
      [restaurantId]
    );

    // 3. Monthly revenue
    const [monthlyRows] = await db.query(
      `SELECT COALESCE(SUM(total_amount), 0) as revenue 
       FROM orders 
       WHERE restaurant_id = ? AND status != 'REJECTED' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
      [restaurantId]
    );

    // 4. Most Ordered Items
    const [topItems] = await db.query(
      `SELECT oi.item_name, SUM(oi.quantity) as totalQty, COALESCE(SUM(oi.quantity * oi.price), 0) as totalSales 
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE o.restaurant_id = ? AND o.status != 'REJECTED'
       GROUP BY oi.menu_item_id, oi.item_name
       ORDER BY totalQty DESC
       LIMIT 5`,
      [restaurantId]
    );

    // 5. Top Tables by Revenue
    const [topTables] = await db.query(
      `SELECT t.table_number, COUNT(o.id) as orderCount, COALESCE(SUM(o.total_amount), 0) as totalRevenue 
       FROM orders o
       JOIN tables t ON o.table_id = t.id
       WHERE o.restaurant_id = ? AND o.status != 'REJECTED'
       GROUP BY o.table_id, t.table_number
       ORDER BY totalRevenue DESC
       LIMIT 5`,
      [restaurantId]
    );

    res.json({
      today: {
        orders: todayRows[0].orderCount,
        revenue: parseFloat(todayRows[0].revenue)
      },
      weekly: {
        revenue: parseFloat(weeklyRows[0].revenue)
      },
      monthly: {
        revenue: parseFloat(monthlyRows[0].revenue)
      },
      topItems,
      topTables
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({ error: 'Failed to compile dashboard reports' });
  }
};

// --- Table Management Handlers ---
exports.getTables = async (req, res) => {
  const restaurantId = req.user.restaurantId;

  try {
    const tables = await Table.findByRestaurantId(restaurantId);
    res.json(tables);
  } catch (error) {
    console.error('Get tables error:', error);
    res.status(500).json({ error: 'Failed to retrieve tables' });
  }
};

exports.createTable = async (req, res) => {
  const { tableNumber } = req.body;
  const restaurantId = req.user.restaurantId;

  if (!tableNumber) {
    return res.status(400).json({ error: 'Table number is required' });
  }

  try {
    // 1. Create table record (this automatically generates the secure table token and qrCode)
    const table = await Table.create({
      restaurantId,
      tableNumber
    });

    res.status(201).json(table);
  } catch (error) {
    console.error('Create table error:', error);
    res.status(500).json({ error: 'Failed to create table' });
  }
};

exports.deleteTable = async (req, res) => {
  const { id } = req.params;

  try {
    const success = await Table.delete(id);
    if (!success) {
      return res.status(404).json({ error: 'Table not found' });
    }
    res.json({ message: 'Table deleted successfully' });
  } catch (error) {
    console.error('Delete table error:', error);
    res.status(500).json({ error: 'Failed to delete table' });
  }
};
