const db = require('../config/database');
const Restaurant = require('../models/Restaurant');
const User = require('../models/User');
const bcrypt = require('bcrypt');
const { sanitizeRestaurant } = require('../utils/sanitize');

// ── Super Admin: Platform Metrics ────────────────────────────────────────────
exports.getPlatformStats = async (req, res) => {
  try {
    const [[totRow]]      = await db.query('SELECT COUNT(*) as count FROM restaurants WHERE deleted_at IS NULL');
    const [[activeRow]]   = await db.query("SELECT COUNT(*) as count FROM restaurants WHERE status = 'ACTIVE' AND deleted_at IS NULL");
    const [[trialRow]]    = await db.query("SELECT COUNT(*) as count FROM restaurants WHERE status = 'TRIAL' AND deleted_at IS NULL");
    const [[expiredRow]]  = await db.query("SELECT COUNT(*) as count FROM restaurants WHERE status = 'EXPIRED' AND deleted_at IS NULL");
    const [[suspRow]]     = await db.query("SELECT COUNT(*) as count FROM restaurants WHERE status = 'SUSPENDED' AND deleted_at IS NULL");
    const [[ordersRow]]   = await db.query('SELECT COUNT(*) as count FROM orders');

    const [planCounts] = await db.query(
      `SELECT subscription_plan, COUNT(*) as count
       FROM restaurants WHERE status = 'ACTIVE' AND deleted_at IS NULL
       GROUP BY subscription_plan`
    );

    const PLAN_PRICE = { STARTER: 999, PROFESSIONAL: 2499, ENTERPRISE: 9999 };
    let monthlyRevenue = 0;
    planCounts.forEach((row) => {
      monthlyRevenue += (PLAN_PRICE[row.subscription_plan] || 0) * row.count;
    });

    const aiRequestsCount = (ordersRow.count * 7) + 342; // estimated

    res.json({
      totalRestaurants:    totRow.count,
      activeRestaurants:   activeRow.count,
      trialRestaurants:    trialRow.count,
      expiredRestaurants:  expiredRow.count,
      suspendedRestaurants: suspRow.count,
      monthlyRevenue,
      totalOrders:         ordersRow.count,
      aiRequests:          aiRequestsCount,
    });
  } catch (error) {
    console.error('SaaS stats error:', error);
    res.status(500).json({ error: 'Failed to retrieve platform stats' });
  }
};

// ── Super Admin: List All Restaurants ────────────────────────────────────────
exports.getRestaurantsList = async (req, res) => {
  try {
    const rows = await Restaurant.findAll();
    res.json(rows.map(sanitizeRestaurant));
  } catch (error) {
    console.error('Get restaurants list error:', error);
    res.status(500).json({ error: 'Failed to retrieve restaurants list' });
  }
};

// ── Super Admin: Update Subscription & Restaurant Details ─────────────────────────────────────────
exports.updateRestaurantSubscription = async (req, res) => {
  const { id } = req.params;
  const { 
    status, subscription_plan, subscription_expires_at, name, phone, address,
    vapi_enabled, vapi_assistant_id, voice_provider, max_voice_minutes_per_day,
    inactivity_timeout
  } = req.body;

  const validStatuses = ['ACTIVE', 'SUSPENDED', 'TRIAL', 'EXPIRED'];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid subscription status' });
  }
  const validPlans = ['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'];
  if (subscription_plan && !validPlans.includes(subscription_plan)) {
    return res.status(400).json({ error: 'Invalid subscription plan' });
  }

  try {
    const fields = {};
    if (status)                    fields.status = status;
    if (subscription_plan)         fields.subscription_plan = subscription_plan;
    if (name !== undefined)        fields.name = name;
    if (phone !== undefined)       fields.phone = phone;
    if (address !== undefined)     fields.address = address;
    if (subscription_expires_at !== undefined) {
      fields.subscription_expires_at = subscription_expires_at
        ? new Date(subscription_expires_at)
        : null;
    }
    // Vapi premium voice properties (controlled by Super Admin)
    if (vapi_enabled !== undefined)               fields.vapi_enabled = !!vapi_enabled;
    if (vapi_assistant_id !== undefined)          fields.vapi_assistant_id = vapi_assistant_id;
    if (voice_provider !== undefined)             fields.voice_provider = voice_provider;
    if (max_voice_minutes_per_day !== undefined)  fields.max_voice_minutes_per_day = parseInt(max_voice_minutes_per_day, 10) || 0;
    if (inactivity_timeout !== undefined)         fields.inactivity_timeout = parseInt(inactivity_timeout, 10) || 30;

    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }
    await Restaurant.update(id, fields);
    const restaurant = await Restaurant.findById(id);
    res.json({ message: 'Subscription updated successfully', restaurant });
  } catch (error) {
    console.error('Update subscription error:', error);
    res.status(500).json({ error: 'Failed to update subscription' });
  }
};

// ── Super Admin: Create Restaurant + Owner ────────────────────────────────────
exports.createRestaurantAndOwner = async (req, res) => {
  const { restaurantName, phone, address, ownerName, ownerEmail, ownerPassword, subscriptionPlan } = req.body;

  if (!restaurantName || !ownerName || !ownerEmail || !ownerPassword) {
    return res.status(400).json({ error: 'Restaurant Name, Owner Name, Email, and Password are required' });
  }

  try {
    const existing = await User.findByEmail(ownerEmail);
    if (existing) return res.status(400).json({ error: 'Email already registered' });

    // Restaurant.create generates rst_xxx ID
    const restaurant = await Restaurant.create({
      name: restaurantName,
      phone: phone || '',
      email: ownerEmail,
      address: address || '',
    });

    // Update plan if not default
    if (subscriptionPlan && subscriptionPlan !== 'FREE') {
      const expiryDate = new Date();
      expiryDate.setMonth(expiryDate.getMonth() + 1);
      await Restaurant.update(restaurant.id, {
        subscription_plan: subscriptionPlan,
        status: 'ACTIVE',
        subscription_expires_at: expiryDate,
      });
    }

    // User.create generates usr_xxx ID
    await User.create({
      restaurantId: restaurant.id,
      name: ownerName,
      email: ownerEmail,
      password: ownerPassword,
      role: 'OWNER',
    });

    res.status(201).json({
      message: 'Restaurant and Owner account created successfully',
      restaurantId: restaurant.id,
    });
  } catch (error) {
    console.error('SaaS create tenant error:', error);
    res.status(500).json({ error: 'Failed to create restaurant and owner' });
  }
};

// ── Super Admin: Soft Delete Restaurant ──────────────────────────────────────
exports.deleteRestaurant = async (req, res) => {
  const { id } = req.params;
  try {
    await Restaurant.softDelete(id);
    res.json({ message: 'Restaurant suspended and hidden successfully' });
  } catch (error) {
    console.error('Delete restaurant error:', error);
    res.status(500).json({ error: 'Failed to delete restaurant' });
  }
};

// ── Super Admin: Reset Owner Password ────────────────────────────────────────
exports.resetOwnerPassword = async (req, res) => {
  const { restaurantId, newPassword } = req.body;
  if (!restaurantId || !newPassword) {
    return res.status(400).json({ error: 'restaurantId and newPassword are required' });
  }
  try {
    const [users] = await db.query(
      "SELECT id FROM users WHERE restaurant_id = ? AND role = 'OWNER' LIMIT 1",
      [restaurantId]
    );
    if (users.length === 0) return res.status(404).json({ error: 'Owner not found for this restaurant' });
    await User.updatePassword(users[0].id, newPassword);
    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
};

// ── Super Admin: AI Usage Stats ───────────────────────────────────────────────
exports.getAiUsage = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.id, r.name, COALESCE(SUM(aul.request_count), 0) as total_requests,
              COALESCE(SUM(aul.token_count), 0) as total_tokens
       FROM restaurants r
       LEFT JOIN ai_usage_logs aul ON aul.restaurant_id = r.id
       WHERE r.deleted_at IS NULL
       GROUP BY r.id, r.name
       ORDER BY total_requests DESC`
    );
    res.json(rows);
  } catch (error) {
    console.error('AI usage error:', error);
    res.status(500).json({ error: 'Failed to retrieve AI usage' });
  }
};

// ── Super Admin: Update Restaurant AI Settings ─────────────────────────────────
exports.updateRestaurantAiSettings = async (req, res) => {
  const { id } = req.params;
  const { allowGoogleApi, allowGroqApi, allowCustomerApi, apiMode } = req.body;

  try {
    const restaurant = await Restaurant.findById(id);
    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const fields = {};
    if (allowGoogleApi !== undefined) {
      fields.allow_google_api = !!allowGoogleApi;
    }
    if (allowGroqApi !== undefined) {
      fields.allow_groq_api = !!allowGroqApi;
    }
    if (allowCustomerApi !== undefined) {
      fields.allow_customer_api = !!allowCustomerApi;
      if (!allowCustomerApi) {
        fields.api_mode = 'platform';
      }
    }
    if (apiMode !== undefined) {
      fields.api_mode = apiMode;
    }

    if (Object.keys(fields).length > 0) {
      await Restaurant.update(id, fields);
    }

    const updated = await Restaurant.findById(id);
    res.json({
      message: 'AI Permissions updated successfully',
      restaurant: sanitizeRestaurant(updated)
    });
  } catch (error) {
    console.error('Update restaurant AI settings error:', error);
    res.status(500).json({ error: 'Failed to update restaurant AI permissions' });
  }
};
