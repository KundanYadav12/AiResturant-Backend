const db = require('../config/database');
const { tableId: generateTableId } = require('../utils/idGenerator');

class Table {
  static async findById(id) {
    const [rows] = await db.query(
      `SELECT t.*, r.name AS restaurant_name, r.status AS restaurant_status,
              r.subscription_expires_at, r.subscription_plan
       FROM tables t
       JOIN restaurants r ON t.restaurant_id = r.id
       WHERE t.id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  static async findByToken(token) {
    const [rows] = await db.query(
      `SELECT t.id, t.restaurant_id, t.table_number, t.table_token, t.qr_code, t.status,
              r.name AS restaurant_name, r.status AS restaurant_status,
              r.subscription_expires_at, r.subscription_plan,
              r.ai_waiter_enabled, r.voice_interaction_enabled, r.continuous_voice_enabled,
              r.greeting_message, r.voice_language, r.voice_gender, r.voice_speed,
              r.auto_listening_timeout, r.wake_word, r.vapi_enabled, r.voice_provider
       FROM tables t
       JOIN restaurants r ON t.restaurant_id = r.id
       WHERE t.table_token = ?`,
      [token]
    );
    return rows[0] || null;
  }

  static async findByRestaurantId(restaurantId) {
    const [rows] = await db.query(
      'SELECT * FROM tables WHERE restaurant_id = ? ORDER BY created_at ASC',
      [restaurantId]
    );
    return rows;
  }

  static async create({ restaurantId, tableNumber }) {
    // table id and table_token are the same secure tbl_xxx value
    const token = generateTableId();
    const qrCode = `/order/${token}`;
    await db.query(
      'INSERT INTO tables (id, restaurant_id, table_number, table_token, qr_code) VALUES (?, ?, ?, ?, ?)',
      [token, restaurantId, tableNumber, token, qrCode]
    );
    return { id: token, restaurantId, tableNumber: tableNumber, tableToken: token, qrCode, status: 'FREE' };
  }

  static async updateStatus(id, status) {
    await db.query('UPDATE tables SET status = ? WHERE id = ?', [status, id]);
    return true;
  }

  static async updateStatusByToken(token, status) {
    await db.query('UPDATE tables SET status = ? WHERE table_token = ?', [status, token]);
    return true;
  }

  static async delete(id) {
    const [result] = await db.query('DELETE FROM tables WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }
}

module.exports = Table;
