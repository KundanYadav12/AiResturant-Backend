const db = require('../config/database');
const ids = require('../utils/idGenerator');

class Order {
  static async create({ restaurantId, tableId, totalAmount, notes, items }) {
    const pool = db.getPool ? db.getPool() : db;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const orderId = ids.orderId();

      // Generate POS display ID (daily sequential count reset daily)
      const [countResult] = await connection.query(
        'SELECT COUNT(*) as count FROM orders WHERE restaurant_id = ? AND DATE(created_at) = CURDATE()',
        [restaurantId]
      );
      const dailySeq = String(countResult[0].count + 1).padStart(3, '0');
      const posDisplayId = `#${dailySeq}`;

      // Generate Numeric Hash display ID (deterministic hash of the secure random order ID)
      let hash = 0;
      for (let i = 0; i < orderId.length; i++) {
        hash = orderId.charCodeAt(i) + ((hash << 5) - hash);
      }
      const numericCode = Math.abs(hash % 10000).toString().padStart(4, '0');
      const numericDisplayId = `#${numericCode}`;

      // Fetch first active stage for the restaurant dynamically
      const [stages] = await connection.query(
        "SELECT name FROM restaurant_order_stages WHERE restaurant_id = ? AND is_active = TRUE ORDER BY rank_order ASC LIMIT 1",
        [restaurantId]
      );
      const initialStatus = stages.length > 0 ? stages[0].name : 'Order Received';

      await connection.query(
        `INSERT INTO orders (id, restaurant_id, table_id, status, total_amount, notes, pos_display_id, numeric_display_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderId, restaurantId, tableId, initialStatus, totalAmount || 0, notes || '', posDisplayId, numericDisplayId]
      );

      for (const item of items) {
        const orderItemId = ids.orderItemId();
        const quantity = parseInt(item.quantity, 10) || 1;
        const price = parseFloat(item.price) || 0;

        await connection.query(
          'INSERT INTO order_items (id, order_id, menu_item_id, item_name, quantity, price) VALUES (?, ?, ?, ?, ?, ?)',
          [orderItemId, orderId, item.menu_item_id, item.name, quantity, price]
        );
        if (item.customizations && Array.isArray(item.customizations) && item.customizations.length > 0) {
          for (const custom of item.customizations) {
            const customId = ids.orderCustomizationId();
            await connection.query(
              'INSERT INTO order_customizations (id, order_item_id, customization) VALUES (?, ?, ?)',
              [customId, orderItemId, custom]
            );
          }
        }
      }

      await connection.commit();
      return orderId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async updateStatus(orderId, status) {
    const [result] = await db.query('UPDATE orders SET status = ? WHERE id = ?', [status, orderId]);
    return result.affectedRows > 0;
  }

  static async findById(id) {
    const [orders] = await db.query(
      `SELECT o.*, t.table_number, r.name AS restaurant_name, r.order_display_format
       FROM orders o
       JOIN tables t ON o.table_id = t.id
       JOIN restaurants r ON o.restaurant_id = r.id
       WHERE o.id = ?`,
      [id]
    );
    if (orders.length === 0) return null;
    const order = orders[0];

    const format = order.order_display_format || 'POS_STYLE';
    order.display_id = format === 'NUMERIC_HASH' ? order.numeric_display_id : order.pos_display_id;

    const [items] = await db.query('SELECT * FROM order_items WHERE order_id = ?', [id]);
    for (const item of items) {
      const [customs] = await db.query(
        'SELECT customization FROM order_customizations WHERE order_item_id = ?',
        [item.id]
      );
      item.customizations = customs.map((c) => c.customization);
    }
    order.items = items;
    return order;
  }

  static async findByRestaurantId(restaurantId) {
    const [orders] = await db.query(
      `SELECT o.*, t.table_number, r.order_display_format
       FROM orders o
       JOIN tables t ON o.table_id = t.id
       JOIN restaurants r ON o.restaurant_id = r.id
       WHERE o.restaurant_id = ? AND o.is_archived = FALSE
       ORDER BY o.created_at DESC`,
      [restaurantId]
    );
    for (const order of orders) {
      const format = order.order_display_format || 'POS_STYLE';
      order.display_id = format === 'NUMERIC_HASH' ? order.numeric_display_id : order.pos_display_id;

      const [items] = await db.query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
      for (const item of items) {
        const [customs] = await db.query(
          'SELECT customization FROM order_customizations WHERE order_item_id = ?',
          [item.id]
        );
        item.customizations = customs.map((c) => c.customization);
      }
      order.items = items;
    }
    return orders;
  }
}

module.exports = Order;
