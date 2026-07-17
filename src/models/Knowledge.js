const db = require('../config/database');
const ids = require('../utils/idGenerator');

class Knowledge {
  // ── Ingredients & Allergens ────────────────────────────────────────────────

  static async getIngredients(restaurantId) {
    const [rows] = await db.query(
      'SELECT * FROM ingredients WHERE restaurant_id = ? ORDER BY name ASC',
      [restaurantId]
    );
    return rows;
  }

  static async createIngredient(restaurantId, name) {
    const id = ids.ingredientId();
    await db.query(
      'INSERT INTO ingredients (id, restaurant_id, name) VALUES (?, ?, ?)',
      [id, restaurantId, name]
    );
    return { id, restaurantId, name };
  }

  static async deleteIngredient(id) {
    await db.query('DELETE FROM menu_item_ingredients WHERE ingredient_id = ?', [id]);
    const [result] = await db.query('DELETE FROM ingredients WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  static async getMenuItemIngredients(menuItemId) {
    const [rows] = await db.query(
      `SELECT mii.*, i.name
       FROM menu_item_ingredients mii
       JOIN ingredients i ON mii.ingredient_id = i.id
       WHERE mii.menu_item_id = ?`,
      [menuItemId]
    );
    return rows;
  }

  static async linkMenuItemIngredients(menuItemId, links) {
    await db.query('DELETE FROM menu_item_ingredients WHERE menu_item_id = ?', [menuItemId]);
    if (links.length > 0) {
      const values = links.map((link) => [menuItemId, link.ingredientId, link.isAllergen ? 1 : 0]);
      await db.query(
        'INSERT INTO menu_item_ingredients (menu_item_id, ingredient_id, is_allergen) VALUES ?',
        [values]
      );
    }
    return true;
  }

  // ── Customizations ─────────────────────────────────────────────────────────

  static async getCustomizationsByMenuItem(menuItemId) {
    const [rows] = await db.query(
      'SELECT * FROM menu_item_customizations WHERE menu_item_id = ?',
      [menuItemId]
    );
    return rows;
  }

  static async createCustomization(menuItemId, name, price) {
    const id = ids.customizationId();
    await db.query(
      'INSERT INTO menu_item_customizations (id, menu_item_id, name, price) VALUES (?, ?, ?, ?)',
      [id, menuItemId, name, price]
    );
    return { id, menuItemId, name, price };
  }

  static async deleteCustomization(id) {
    const [result] = await db.query('DELETE FROM menu_item_customizations WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  // ── FAQs ───────────────────────────────────────────────────────────────────

  static async getFAQs(restaurantId) {
    const [rows] = await db.query(
      'SELECT * FROM faqs WHERE restaurant_id = ? ORDER BY created_at DESC',
      [restaurantId]
    );
    return rows;
  }

  static async createFAQ(restaurantId, question, answer) {
    const id = ids.faqId();
    await db.query(
      'INSERT INTO faqs (id, restaurant_id, question, answer) VALUES (?, ?, ?, ?)',
      [id, restaurantId, question, answer]
    );
    return { id, restaurantId, question, answer };
  }

  static async updateFAQ(id, question, answer) {
    await db.query('UPDATE faqs SET question = ?, answer = ? WHERE id = ?', [question, answer, id]);
    return { id, question, answer };
  }

  static async deleteFAQ(id) {
    const [result] = await db.query('DELETE FROM faqs WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  // ── General AI Knowledge Document ─────────────────────────────────────────

  static async getGeneralKnowledge(restaurantId) {
    const [rows] = await db.query(
      'SELECT * FROM ai_knowledge WHERE restaurant_id = ? ORDER BY created_at DESC LIMIT 1',
      [restaurantId]
    );
    return rows[0] || null;
  }

  static async saveGeneralKnowledge(restaurantId, content) {
    const existing = await this.getGeneralKnowledge(restaurantId);
    if (existing) {
      await db.query('UPDATE ai_knowledge SET content = ? WHERE id = ?', [content, existing.id]);
      return { id: existing.id, restaurantId, content };
    } else {
      const id = ids.knowledgeId();
      await db.query(
        'INSERT INTO ai_knowledge (id, restaurant_id, content) VALUES (?, ?, ?)',
        [id, restaurantId, content]
      );
      return { id, restaurantId, content };
    }
  }

  // ── Table Status & Assistance Requests ────────────────────────────────────

  static async createTableRequest(restaurantId, tableId, requestType) {
    const id = ids.tableRequestId();
    await db.query(
      `INSERT INTO table_requests (id, restaurant_id, table_id, request_type, status)
       VALUES (?, ?, ?, ?, 'PENDING')`,
      [id, restaurantId, tableId, requestType]
    );

    const statusMap = {
      WAITER: 'REQUESTED_WAITER',
      WATER:  'REQUESTED_WATER',
      BILL:   'WAITING_FOR_BILL',
    };
    const newStatus = statusMap[requestType] || 'OCCUPIED';
    await db.query('UPDATE tables SET status = ? WHERE id = ?', [newStatus, tableId]);

    return { id, restaurantId, tableId, requestType, status: 'PENDING' };
  }

  static async getPendingTableRequests(restaurantId) {
    const [rows] = await db.query(
      `SELECT tr.*, t.table_number
       FROM table_requests tr
       JOIN tables t ON tr.table_id = t.id
       WHERE tr.restaurant_id = ? AND tr.status = 'PENDING'
       ORDER BY tr.created_at DESC`,
      [restaurantId]
    );
    return rows;
  }

  static async completeTableRequest(requestId, tableId) {
    await db.query(`UPDATE table_requests SET status = 'COMPLETED' WHERE id = ?`, [requestId]);
    await db.query(`UPDATE tables SET status = 'FREE' WHERE id = ?`, [tableId]);
    return true;
  }

  static async completeAllRequestsForTable(tableId) {
    await db.query(
      `UPDATE table_requests SET status = 'COMPLETED' WHERE table_id = ? AND status = 'PENDING'`,
      [tableId]
    );
    await db.query(`UPDATE tables SET status = 'FREE' WHERE id = ?`, [tableId]);
    return true;
  }
}

module.exports = Knowledge;
