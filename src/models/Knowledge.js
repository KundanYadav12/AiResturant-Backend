const db = require('../config/database');

class Knowledge {
  // ==========================================
  // INGREDIENTS & ALLERGENS
  // ==========================================
  static async getIngredients(restaurantId) {
    const [rows] = await db.query('SELECT * FROM ingredients WHERE restaurant_id = ? ORDER BY name ASC', [restaurantId]);
    return rows;
  }

  static async createIngredient(restaurantId, name) {
    const [result] = await db.query('INSERT INTO ingredients (restaurant_id, name) VALUES (?, ?)', [restaurantId, name]);
    return { id: result.insertId, restaurantId, name };
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
    // links is array of { ingredientId, isAllergen }
    await db.query('DELETE FROM menu_item_ingredients WHERE menu_item_id = ?', [menuItemId]);
    if (links.length > 0) {
      const values = links.map(link => [menuItemId, link.ingredientId, link.isAllergen]);
      await db.query(
        'INSERT INTO menu_item_ingredients (menu_item_id, ingredient_id, is_allergen) VALUES ?',
        [values]
      );
    }
    return true;
  }

  // ==========================================
  // CUSTOMIZATIONS
  // ==========================================
  static async getCustomizationsByMenuItem(menuItemId) {
    const [rows] = await db.query('SELECT * FROM menu_item_customizations WHERE menu_item_id = ?', [menuItemId]);
    return rows;
  }

  static async createCustomization(menuItemId, name, price) {
    const [result] = await db.query(
      'INSERT INTO menu_item_customizations (menu_item_id, name, price) VALUES (?, ?, ?)',
      [menuItemId, name, price]
    );
    return { id: result.insertId, menuItemId, name, price };
  }

  static async deleteCustomization(id) {
    const [result] = await db.query('DELETE FROM menu_item_customizations WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  // ==========================================
  // FAQS
  // ==========================================
  static async getFAQs(restaurantId) {
    const [rows] = await db.query('SELECT * FROM faqs WHERE restaurant_id = ? ORDER BY id DESC', [restaurantId]);
    return rows;
  }

  static async createFAQ(restaurantId, question, answer) {
    const [result] = await db.query('INSERT INTO faqs (restaurant_id, question, answer) VALUES (?, ?, ?)', [restaurantId, question, answer]);
    return { id: result.insertId, restaurantId, question, answer };
  }

  static async updateFAQ(id, question, answer) {
    await db.query('UPDATE faqs SET question = ?, answer = ? WHERE id = ?', [question, answer, id]);
    return { id, question, answer };
  }

  static async deleteFAQ(id) {
    const [result] = await db.query('DELETE FROM faqs WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  // ==========================================
  // GENERAL KNOWLEDGE DOCUMENTS
  // ==========================================
  static async getGeneralKnowledge(restaurantId) {
    const [rows] = await db.query('SELECT * FROM ai_knowledge WHERE restaurant_id = ? ORDER BY id DESC', [restaurantId]);
    return rows[0] || null;
  }

  static async saveGeneralKnowledge(restaurantId, content) {
    const existing = await this.getGeneralKnowledge(restaurantId);
    if (existing) {
      await db.query('UPDATE ai_knowledge SET content = ? WHERE id = ?', [content, existing.id]);
      return { id: existing.id, restaurantId, content };
    } else {
      const [result] = await db.query('INSERT INTO ai_knowledge (restaurant_id, content) VALUES (?, ?)', [restaurantId, content]);
      return { id: result.insertId, restaurantId, content };
    }
  }

  // ==========================================
  // TABLE STATUS & ASSISTANCE REQUESTS
  // ==========================================
  static async createTableRequest(restaurantId, tableId, requestType) {
    const [result] = await db.query(
      'INSERT INTO table_requests (restaurant_id, table_id, request_type, status) VALUES (?, ?, ?, \'PENDING\')',
      [restaurantId, tableId, requestType]
    );

    // Update table status
    let statusText = 'OCCUPIED';
    if (requestType === 'WAITER') statusText = 'REQUESTED_WAITER';
    else if (requestType === 'WATER') statusText = 'REQUESTED_WATER';
    else if (requestType === 'BILL') statusText = 'WAITING_FOR_BILL';

    await db.query('UPDATE tables SET status = ? WHERE id = ?', [statusText, tableId]);

    return { id: result.insertId, restaurantId, tableId, requestType, status: 'PENDING' };
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
    await db.query("UPDATE table_requests SET status = 'COMPLETED' WHERE id = ?", [requestId]);
    // Set table back to FREE or OCCUPIED (default FREE for simplicity, or we can check if they have active orders)
    await db.query("UPDATE tables SET status = 'FREE' WHERE id = ?", [tableId]);
    return true;
  }

  static async completeAllRequestsForTable(tableId) {
    await db.query("UPDATE table_requests SET status = 'COMPLETED' WHERE table_id = ? AND status = 'PENDING'", [tableId]);
    await db.query("UPDATE tables SET status = 'FREE' WHERE id = ?", [tableId]);
    return true;
  }
}

module.exports = Knowledge;
