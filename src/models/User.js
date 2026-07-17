const db = require('../config/database');
const bcrypt = require('bcrypt');
const { userId: generateUserId } = require('../utils/idGenerator');

class User {
  static async findByEmail(email) {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    return rows[0] || null;
  }

  static async findById(id) {
    const [rows] = await db.query(
      `SELECT u.id, u.restaurant_id, u.name, u.email, u.role, u.last_login, u.created_at,
              r.name AS restaurant_name, r.status AS restaurant_status,
              r.subscription_plan, r.subscription_expires_at
       FROM users u
       LEFT JOIN restaurants r ON u.restaurant_id = r.id
       WHERE u.id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  static async findByRestaurantId(restaurantId) {
    const [rows] = await db.query(
      'SELECT id, name, email, role, last_login, created_at FROM users WHERE restaurant_id = ?',
      [restaurantId]
    );
    return rows;
  }

  static async create({ restaurantId, name, email, password, role }) {
    const id = generateUserId();
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query(
      'INSERT INTO users (id, restaurant_id, name, email, password, role) VALUES (?, ?, ?, ?, ?, ?)',
      [id, restaurantId || null, name, email, hashedPassword, role]
    );
    return { id, restaurantId: restaurantId || null, name, email, role };
  }

  static async updatePassword(id, newPassword) {
    const hashed = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password = ? WHERE id = ?', [hashed, id]);
    return true;
  }

  static async updateLastLogin(id) {
    await db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [id]);
  }
}

module.exports = User;
