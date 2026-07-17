const db = require('../config/database');
const { restaurantId: generateRestaurantId } = require('../utils/idGenerator');
const crypto = require('crypto');

class Restaurant {
  static async findById(id) {
    const [rows] = await db.query(
      'SELECT * FROM restaurants WHERE id = ? AND deleted_at IS NULL',
      [id]
    );
    return rows[0] || null;
  }

  static async findAll() {
    const [rows] = await db.query(
      `SELECT r.*, u.name AS owner_name, u.email AS owner_email
       FROM restaurants r
       LEFT JOIN users u ON u.restaurant_id = r.id AND u.role = 'OWNER'
       WHERE r.deleted_at IS NULL
       ORDER BY r.created_at DESC`
    );
    return rows;
  }

  static async create({ name, phone, email, address }) {
    const id = generateRestaurantId();
    const apiKey = 'ak_' + crypto.randomBytes(24).toString('hex');
    await db.query(
      `INSERT INTO restaurants (id, name, phone, email, address, api_key, status, subscription_plan)
       VALUES (?, ?, ?, ?, ?, ?, 'TRIAL', 'FREE')`,
      [id, name, phone || '', email || '', address || '', apiKey]
    );
    return { id, name, phone, email, address, apiKey };
  }

  static async update(id, fields) {
    const allowed = [
      'name', 'phone', 'email', 'address', 'logo', 'status', 'subscription_plan', 'subscription_expires_at',
      'ai_waiter_enabled', 'voice_interaction_enabled', 'continuous_voice_enabled', 'greeting_message',
      'voice_language', 'voice_gender', 'voice_speed', 'auto_listening_timeout', 'wake_word',
      // Vapi Premium Voice (platform-owner controlled)
      'vapi_enabled', 'vapi_assistant_id', 'voice_provider', 'voice_volume',
      'inactivity_timeout', 'max_voice_minutes_per_day',
      'voice_minutes_used_today', 'voice_minutes_reset_date',
      'order_display_format',
      // Invoice customization settings
      'gst_number', 'footer_message', 'theme_color', 'currency_symbol', 'tax_settings',
      'auto_archive_timeout',
      // Dynamic AI Provider Key & Access controls
      'google_api_key', 'groq_api_key', 'api_mode', 'allow_google_api', 'allow_groq_api', 'allow_customer_api'
    ];
    const setClauses = [];
    const params = [];
    for (const [k, v] of Object.entries(fields)) {
      if (allowed.includes(k)) { setClauses.push(`${k} = ?`); params.push(v); }
    }
    if (setClauses.length === 0) return false;
    params.push(id);
    await db.query(`UPDATE restaurants SET ${setClauses.join(', ')} WHERE id = ?`, params);
    return true;
  }

  static async softDelete(id) {
    await db.query('UPDATE restaurants SET deleted_at = NOW() WHERE id = ?', [id]);
    return true;
  }
}

module.exports = Restaurant;
