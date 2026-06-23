const db = require('../config/database');
const bcrypt = require('bcrypt');

class User {
  static async findByEmail(email) {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    return rows[0];
  }

  static async findById(id) {
    const [rows] = await db.query(
      `SELECT u.*, r.name as restaurant_name 
       FROM users u 
       LEFT JOIN restaurants r ON u.restaurant_id = r.id 
       WHERE u.id = ?`,
      [id]
    );
    return rows[0];
  }

  static async create({ restaurantId, name, email, password, role }) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO users (restaurant_id, name, email, password, role) VALUES (?, ?, ?, ?, ?)',
      [restaurantId, name, email, hashedPassword, role]
    );
    return { id: result.insertId, restaurantId, name, email, role };
  }
}

module.exports = User;
