const db = require('../config/database');

class Restaurant {
  static async findById(id) {
    const [rows] = await db.query('SELECT * FROM restaurants WHERE id = ?', [id]);
    return rows[0];
  }

  static async create({ name, phone, email, address }) {
    const [result] = await db.query(
      'INSERT INTO restaurants (name, phone, email, address) VALUES (?, ?, ?, ?)',
      [name, phone, email, address]
    );
    return { id: result.insertId, name, phone, email, address };
  }
}

module.exports = Restaurant;
