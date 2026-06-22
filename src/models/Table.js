const db = require('../config/database');

class Table {
  static async findById(id) {
    const [rows] = await db.query(
      `SELECT t.*, r.name as restaurant_name 
       FROM tables t 
       JOIN restaurants r ON t.restaurant_id = r.id 
       WHERE t.id = ?`, 
      [id]
    );
    return rows[0];
  }

  static async findByRestaurantId(restaurantId) {
    const [rows] = await db.query('SELECT * FROM tables WHERE restaurant_id = ?', [restaurantId]);
    return rows;
  }

  static async create({ restaurantId, tableNumber, qrCode }) {
    const [result] = await db.query(
      'INSERT INTO tables (restaurant_id, table_number, qr_code) VALUES (?, ?, ?)',
      [restaurantId, tableNumber, qrCode]
    );
    return { id: result.insertId, restaurantId, tableNumber, qrCode };
  }

  static async updateQrCode(id, qrCode) {
    await db.query('UPDATE tables SET qr_code = ? WHERE id = ?', [qrCode, id]);
    return { id, qrCode };
  }

  static async delete(id) {
    const [result] = await db.query('DELETE FROM tables WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }
}

module.exports = Table;
