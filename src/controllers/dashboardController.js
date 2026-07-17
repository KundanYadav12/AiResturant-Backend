const db = require('../config/database');
const Table = require('../models/Table');
const { sanitizeRestaurant } = require('../utils/sanitize');

exports.getAnalytics = async (req, res) => {
  const restaurantId = req.user.restaurantId;

  try {
    // 1. Today's orders & revenue
    const [todayRows] = await db.query(
      `SELECT COUNT(id) as orderCount, COALESCE(SUM(total_amount), 0) as revenue 
       FROM orders 
       WHERE restaurant_id = ? AND status != 'REJECTED' AND DATE(created_at) = CURDATE()`,
      [restaurantId]
    );

    // 2. Weekly revenue
    const [weeklyRows] = await db.query(
      `SELECT COALESCE(SUM(total_amount), 0) as revenue 
       FROM orders 
       WHERE restaurant_id = ? AND status != 'REJECTED' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`,
      [restaurantId]
    );

    // 3. Monthly revenue
    const [monthlyRows] = await db.query(
      `SELECT COALESCE(SUM(total_amount), 0) as revenue 
       FROM orders 
       WHERE restaurant_id = ? AND status != 'REJECTED' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
      [restaurantId]
    );

    // 4. Most Ordered Items
    const [topItems] = await db.query(
      `SELECT oi.item_name, SUM(oi.quantity) as totalQty, COALESCE(SUM(oi.quantity * oi.price), 0) as totalSales 
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE o.restaurant_id = ? AND o.status != 'REJECTED'
       GROUP BY oi.menu_item_id, oi.item_name
       ORDER BY totalQty DESC
       LIMIT 5`,
      [restaurantId]
    );

    // 5. Top Tables by Revenue
    const [topTables] = await db.query(
      `SELECT t.table_number, COUNT(o.id) as orderCount, COALESCE(SUM(o.total_amount), 0) as totalRevenue 
       FROM orders o
       JOIN tables t ON o.table_id = t.id
       WHERE o.restaurant_id = ? AND o.status != 'REJECTED'
       GROUP BY o.table_id, t.table_number
       ORDER BY totalRevenue DESC
       LIMIT 5`,
      [restaurantId]
    );

    res.json({
      today: {
        orders: todayRows[0].orderCount,
        revenue: parseFloat(todayRows[0].revenue)
      },
      weekly: {
        revenue: parseFloat(weeklyRows[0].revenue)
      },
      monthly: {
        revenue: parseFloat(monthlyRows[0].revenue)
      },
      topItems,
      topTables
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({ error: 'Failed to compile dashboard reports' });
  }
};

// --- Table Management Handlers ---
exports.getTables = async (req, res) => {
  const restaurantId = req.user.restaurantId;

  try {
    const tables = await Table.findByRestaurantId(restaurantId);
    res.json(tables);
  } catch (error) {
    console.error('Get tables error:', error);
    res.status(500).json({ error: 'Failed to retrieve tables' });
  }
};

exports.createTable = async (req, res) => {
  const { tableNumber } = req.body;
  const restaurantId = req.user.restaurantId;

  if (!tableNumber) {
    return res.status(400).json({ error: 'Table number is required' });
  }

  try {
    // 1. Create table record (this automatically generates the secure table token and qrCode)
    const table = await Table.create({
      restaurantId,
      tableNumber
    });

    res.status(201).json(table);
  } catch (error) {
    console.error('Create table error:', error);
    res.status(500).json({ error: 'Failed to create table' });
  }
};

exports.deleteTable = async (req, res) => {
  const { id } = req.params;

  try {
    const success = await Table.delete(id);
    if (!success) {
      return res.status(404).json({ error: 'Table not found' });
    }
    res.json({ message: 'Table deleted successfully' });
  } catch (error) {
    console.error('Delete table error:', error);
    res.status(500).json({ error: 'Failed to delete table' });
  }
};

const Restaurant = require('../models/Restaurant');

exports.updateSettings = async (req, res) => {
  const restaurantId = req.user.restaurantId;
  const {
    ai_waiter_enabled,
    voice_interaction_enabled,
    continuous_voice_enabled,
    greeting_message,
    voice_language,
    voice_gender,
    voice_speed,
    auto_listening_timeout,
    wake_word,
    order_display_format,
    name,
    phone,
    email,
    address,
    logo,
    gst_number,
    footer_message,
    theme_color,
    currency_symbol,
    tax_settings,
    auto_archive_timeout
  } = req.body;

  try {
    const fields = {};
    if (ai_waiter_enabled !== undefined)       fields.ai_waiter_enabled = ai_waiter_enabled;
    if (voice_interaction_enabled !== undefined) fields.voice_interaction_enabled = voice_interaction_enabled;
    if (continuous_voice_enabled !== undefined) fields.continuous_voice_enabled = continuous_voice_enabled;
    if (greeting_message !== undefined)        fields.greeting_message = greeting_message;
    if (voice_language !== undefined)          fields.voice_language = voice_language;
    if (voice_gender !== undefined)            fields.voice_gender = voice_gender;
    if (voice_speed !== undefined)             fields.voice_speed = voice_speed;
    if (auto_listening_timeout !== undefined)  fields.auto_listening_timeout = auto_listening_timeout;
    if (wake_word !== undefined)               fields.wake_word = wake_word;
    if (order_display_format !== undefined)     fields.order_display_format = order_display_format;
    if (name !== undefined)                    fields.name = name;
    if (phone !== undefined)                   fields.phone = phone;
    if (email !== undefined)                   fields.email = email;
    if (address !== undefined)                 fields.address = address;
    if (logo !== undefined)                    fields.logo = logo;
    if (gst_number !== undefined)              fields.gst_number = gst_number;
    if (footer_message !== undefined)          fields.footer_message = footer_message;
    if (theme_color !== undefined)             fields.theme_color = theme_color;
    if (currency_symbol !== undefined)          fields.currency_symbol = currency_symbol;
    if (tax_settings !== undefined)             fields.tax_settings = parseFloat(tax_settings);
    if (auto_archive_timeout !== undefined)     fields.auto_archive_timeout = parseInt(auto_archive_timeout, 10);

    const success = await Restaurant.update(restaurantId, fields);
    if (!success) {
      return res.status(400).json({ error: 'Failed to update settings' });
    }

    const updatedRestaurant = await Restaurant.findById(restaurantId);
    res.json({ message: 'Settings updated successfully', restaurant: sanitizeRestaurant(updatedRestaurant) });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
};

exports.getSettings = async (req, res) => {
  const restaurantId = req.user.restaurantId;
  try {
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }
    res.json(sanitizeRestaurant(restaurant));
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to retrieve settings' });
  }
};

// GET AI Provider Configuration (Owner/Manager dashboard view)
exports.getAiProviderSettings = async (req, res) => {
  const restaurantId = req.user.restaurantId;
  try {
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    res.json({
      apiMode: restaurant.api_mode || 'platform',
      googleConfigured: !!restaurant.google_api_key,
      groqConfigured: !!restaurant.groq_api_key,
      customerApiAllowed: !!restaurant.allow_customer_api,
      googleEnabled: !!restaurant.allow_google_api,
      groqEnabled: !!restaurant.allow_groq_api
    });
  } catch (error) {
    console.error('Get AI settings error:', error);
    res.status(500).json({ error: 'Failed to retrieve AI settings' });
  }
};

// PUT AI Provider Configuration (Owner/Manager update keys/mode)
exports.updateAiProviderSettings = async (req, res) => {
  const restaurantId = req.user.restaurantId;
  const { apiMode, googleApiKey, groqApiKey } = req.body;

  try {
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const customerAllowed = !!restaurant.allow_customer_api;

    if (apiMode === 'customer' && !customerAllowed) {
      return res.status(403).json({ error: 'Using your own API keys has not been enabled by the Platform Owner.' });
    }

    const fields = {};
    if (apiMode !== undefined) {
      fields.api_mode = apiMode;
    }

    // Only allow setting keys if Platform Owner has enabled customer API keys
    if (customerAllowed) {
      if (googleApiKey !== undefined && googleApiKey !== '****************') {
        fields.google_api_key = googleApiKey === '' ? null : googleApiKey;
      }
      if (groqApiKey !== undefined && groqApiKey !== '****************') {
        fields.groq_api_key = groqApiKey === '' ? null : groqApiKey;
      }
    }

    if (Object.keys(fields).length > 0) {
      const success = await Restaurant.update(restaurantId, fields);
      if (!success) {
        return res.status(400).json({ error: 'Failed to update AI settings' });
      }
    }

    const updated = await Restaurant.findById(restaurantId);
    res.json({
      message: 'AI Settings updated successfully',
      settings: {
        apiMode: updated.api_mode || 'platform',
        googleConfigured: !!updated.google_api_key,
        groqConfigured: !!updated.groq_api_key,
        customerApiAllowed: !!updated.allow_customer_api,
        googleEnabled: !!updated.allow_google_api,
        groqEnabled: !!updated.allow_groq_api
      }
    });
  } catch (error) {
    console.error('Update AI settings error:', error);
    res.status(500).json({ error: 'Failed to update AI settings' });
  }
};

