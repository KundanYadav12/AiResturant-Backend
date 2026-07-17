const db = require('../config/database');
const ids = require('../utils/idGenerator');

class Menu {
  // ── Categories ──────────────────────────────────────────────────────────────

  static async getCategoriesByRestaurant(restaurantId) {
    const [rows] = await db.query(
      'SELECT * FROM categories WHERE restaurant_id = ? ORDER BY rank_order ASC, created_at ASC',
      [restaurantId]
    );
    return rows;
  }

  static async createCategory({ restaurantId, name }) {
    const id = ids.categoryId();
    // Default ranking is set to max current ranking + 1
    const [maxRank] = await db.query('SELECT MAX(rank_order) as max_rank FROM categories WHERE restaurant_id = ?', [restaurantId]);
    const nextRank = (maxRank[0].max_rank || 0) + 1;
    
    await db.query(
      'INSERT INTO categories (id, restaurant_id, name, rank_order) VALUES (?, ?, ?, ?)',
      [id, restaurantId, name, nextRank]
    );
    return { id, restaurantId, name, rank_order: nextRank };
  }

  static async updateCategory(id, { name }) {
    await db.query('UPDATE categories SET name = ? WHERE id = ?', [name, id]);
    return { id, name };
  }

  static async updateCategoryRankings(rankings) {
    for (const item of rankings) {
      await db.query('UPDATE categories SET rank_order = ? WHERE id = ?', [item.rank_order, item.id]);
    }
  }

  static async deleteCategory(id) {
    // A category cannot be deleted if it still contains one or more menu items
    const [items] = await db.query('SELECT COUNT(*) as count FROM menu_items WHERE category_id = ?', [id]);
    if (items[0].count > 0) {
      throw new Error('This category contains menu items. Please delete or move all menu items before deleting this category.');
    }
    const [result] = await db.query('DELETE FROM categories WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  // ── Menu Items ───────────────────────────────────────────────────────────────

  static async getMenuItemsByRestaurant(restaurantId, includeInactive = false) {
    const activeFilter = includeInactive ? '' : 'AND m.is_active = TRUE';
    const [rows] = await db.query(
      `SELECT m.*, c.name AS category_name
       FROM menu_items m
       JOIN categories c ON m.category_id = c.id
       WHERE m.restaurant_id = ? ${activeFilter}
       ORDER BY c.rank_order ASC, c.created_at ASC, m.rank_order ASC, m.name ASC`,
      [restaurantId]
    );
    return rows;
  }

  static async getMenuItemById(id) {
    const [rows] = await db.query('SELECT * FROM menu_items WHERE id = ?', [id]);
    return rows[0] || null;
  }

  static async createMenuItem({ restaurantId, categoryId, name, description, price, image, isActive = true, isVeg = true }) {
    const id = ids.menuItemId();
    // Default ranking is set to max current ranking inside the category + 1
    const [maxRank] = await db.query('SELECT MAX(rank_order) as max_rank FROM menu_items WHERE category_id = ?', [categoryId]);
    const nextRank = (maxRank[0].max_rank || 0) + 1;

    await db.query(
      'INSERT INTO menu_items (id, restaurant_id, category_id, name, description, price, image, is_active, rank_order, is_veg) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, restaurantId, categoryId, name, description || '', price, image || null, isActive, nextRank, isVeg]
    );
    return { id, restaurantId, categoryId, name, description, price, image, isActive, rank_order: nextRank, is_veg: isVeg };
  }

  static async updateMenuItem(id, { categoryId, name, description, price, image, isActive, isVeg }) {
    let query = 'UPDATE menu_items SET category_id = ?, name = ?, description = ?, price = ?, is_active = ?, is_veg = ?';
    const params = [categoryId, name, description || '', price, isActive, isVeg];
    if (image !== undefined) { query += ', image = ?'; params.push(image); }
    query += ' WHERE id = ?';
    params.push(id);
    await db.query(query, params);
    return { id, categoryId, name, description, price, image, isActive, is_veg: isVeg };
  }

  static async updateMenuItemRankings(rankings) {
    for (const item of rankings) {
      await db.query('UPDATE menu_items SET rank_order = ? WHERE id = ?', [item.rank_order, item.id]);
    }
  }

  static async deleteMenuItem(id) {
    const [result] = await db.query('DELETE FROM menu_items WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }
}

module.exports = Menu;
