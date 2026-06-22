const db = require('../config/database');

class Order {
  static async create({ restaurantId, tableId, totalAmount, notes, items }) {
    const pool = db.getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // 1. Create order
      const [orderResult] = await connection.query(
        'INSERT INTO orders (restaurant_id, table_id, status, total_amount, notes) VALUES (?, ?, ?, ?, ?)',
        [restaurantId, tableId, 'PENDING', totalAmount, notes || '']
      );
      const orderId = orderResult.insertId;

      // 2. Insert items and customizations
      for (const item of items) {
        const [itemResult] = await connection.query(
          'INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, price) VALUES (?, ?, ?, ?, ?)',
          [orderId, item.menu_item_id, item.name, item.quantity, item.price]
        );
        const orderItemId = itemResult.insertId;

        if (item.customizations && Array.isArray(item.customizations)) {
          for (const custom of item.customizations) {
            await connection.query(
              'INSERT INTO order_customizations (order_item_id, customization) VALUES (?, ?)',
              [orderItemId, custom]
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
      `SELECT o.*, t.table_number, r.name as restaurant_name 
       FROM orders o 
       JOIN tables t ON o.table_id = t.id 
       JOIN restaurants r ON o.restaurant_id = r.id 
       WHERE o.id = ?`,
      [id]
    );

    if (orders.length === 0) return null;
    const order = orders[0];

    // Fetch items
    const [items] = await db.query(
      `SELECT oi.* 
       FROM order_items oi 
       WHERE oi.order_id = ?`,
      [id]
    );

    // Fetch customizations for each item
    for (const item of items) {
      const [customs] = await db.query(
        'SELECT customization FROM order_customizations WHERE order_item_id = ?',
        [item.id]
      );
      item.customizations = customs.map(c => c.customization);
    }

    order.items = items;
    return order;
  }

  static async findByRestaurantId(restaurantId) {
    const [orders] = await db.query(
      `SELECT o.*, t.table_number 
       FROM orders o 
       JOIN tables t ON o.table_id = t.id 
       WHERE o.restaurant_id = ? 
       ORDER BY o.created_at DESC`,
      [restaurantId]
    );

    for (const order of orders) {
      const [items] = await db.query(
        `SELECT oi.* 
         FROM order_items oi 
         WHERE oi.order_id = ?`,
        [order.id]
      );

      for (const item of items) {
        const [customs] = await db.query(
          'SELECT customization FROM order_customizations WHERE order_item_id = ?',
          [item.id]
        );
        item.customizations = customs.map(c => c.customization);
      }
      order.items = items;
    }

    return orders;
  }
}

module.exports = Order;
