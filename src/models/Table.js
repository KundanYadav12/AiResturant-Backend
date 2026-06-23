const db = require('../config/database');

// Helper to generate a secure random token for tables
function generateTableToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = 'tbl_';
  for (let i = 0; i < 15; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

class Table {
  static async findById(id) {
    const [rows] = await db.query(
      `SELECT t.*, r.name as restaurant_name, r.status as restaurant_status, r.subscription_expires_at
       FROM tables t 
       JOIN restaurants r ON t.restaurant_id = r.id 
       WHERE t.id = ?`, 
      [id]
    );
    return rows[0];
  }

  static async findByToken(token) {
    const [rows] = await db.query(
      `SELECT t.id, t.restaurant_id, t.table_number, t.table_token, t.qr_code, t.status, 
              r.name as restaurant_name, r.status as restaurant_status, r.subscription_expires_at, r.subscription_plan
       FROM tables t 
       JOIN restaurants r ON t.restaurant_id = r.id 
       WHERE t.table_token = ?`, 
      [token]
    );
    return rows[0];
  }

  static async findByRestaurantId(restaurantId) {
    const [rows] = await db.query('SELECT * FROM tables WHERE restaurant_id = ?', [restaurantId]);
    return rows;
  }

  static async create({ restaurantId, tableNumber }) {
    const token = generateTableToken();
    const qrCode = `/order/${token}`;
    const [result] = await db.query(
      'INSERT INTO tables (restaurant_id, table_number, table_token, qr_code) VALUES (?, ?, ?, ?)',
      [restaurantId, tableNumber, token, qrCode]
    );
    return { id: result.insertId, restaurantId, tableNumber, tableToken: token, qrCode };
  }

  static async updateQrCode(id, qrCode) {
    await db.query('UPDATE tables SET qr_code = ? WHERE id = ?', [qrCode, id]);
    return { id, qrCode };
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
