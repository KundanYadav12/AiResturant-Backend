const db = require('../config/database');

class Menu {
  // --- Category Operations ---
  static async getCategoriesByRestaurant(restaurantId) {
    const [rows] = await db.query('SELECT * FROM categories WHERE restaurant_id = ? ORDER BY id ASC', [restaurantId]);
    return rows;
  }

  static async createCategory({ restaurantId, name }) {
    const [result] = await db.query('INSERT INTO categories (restaurant_id, name) VALUES (?, ?)', [restaurantId, name]);
    return { id: result.insertId, restaurantId, name };
  }

  static async updateCategory(id, { name }) {
    await db.query('UPDATE categories SET name = ? WHERE id = ?', [name, id]);
    return { id, name };
  }

  static async deleteCategory(id) {
    const [result] = await db.query('DELETE FROM categories WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  // --- Menu Item Operations ---
  static async getMenuItemsByRestaurant(restaurantId, includeInactive = false) {
    const queryStr = includeInactive
      ? 'SELECT m.*, c.name as category_name FROM menu_items m JOIN categories c ON m.category_id = c.id WHERE m.restaurant_id = ? ORDER BY c.id ASC, m.name ASC'
      : 'SELECT m.*, c.name as category_name FROM menu_items m JOIN categories c ON m.category_id = c.id WHERE m.restaurant_id = ? AND m.is_active = TRUE ORDER BY c.id ASC, m.name ASC';
    const [rows] = await db.query(queryStr, [restaurantId]);
    return rows;
  }

  static async getMenuItemById(id) {
    const [rows] = await db.query('SELECT * FROM menu_items WHERE id = ?', [id]);
    return rows[0];
  }

  static async createMenuItem({ restaurantId, categoryId, name, description, price, image, isActive = true }) {
    const [result] = await db.query(
      'INSERT INTO menu_items (restaurant_id, category_id, name, description, price, image, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [restaurantId, categoryId, name, description, price, image, isActive]
    );
    return { id: result.insertId, restaurantId, categoryId, name, description, price, image, isActive };
  }

  static async updateMenuItem(id, { categoryId, name, description, price, image, isActive }) {
    let queryStr = 'UPDATE menu_items SET category_id = ?, name = ?, description = ?, price = ?, is_active = ?';
    const params = [categoryId, name, description, price, isActive];

    if (image !== undefined) {
      queryStr += ', image = ?';
      params.push(image);
    }

    queryStr += ' WHERE id = ?';
    params.push(id);

    await db.query(queryStr, params);
    return { id, categoryId, name, description, price, image, isActive };
  }

  static async deleteMenuItem(id) {
    const [result] = await db.query('DELETE FROM menu_items WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }
}

module.exports = Menu;
