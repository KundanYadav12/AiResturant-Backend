const db = require('../config/database');
const bcrypt = require('bcrypt');

// Get Super Admin platform metrics
exports.getPlatformStats = async (req, res) => {
  try {
    const [totalRestaurants] = await db.query('SELECT COUNT(*) as count FROM restaurants');
    const [activeRestaurants] = await db.query("SELECT COUNT(*) as count FROM restaurants WHERE status = 'ACTIVE'");
    const [trialRestaurants] = await db.query("SELECT COUNT(*) as count FROM restaurants WHERE status = 'TRIAL'");
    const [expiredRestaurants] = await db.query("SELECT COUNT(*) as count FROM restaurants WHERE status = 'EXPIRED'");
    const [suspendedRestaurants] = await db.query("SELECT COUNT(*) as count FROM restaurants WHERE status = 'SUSPENDED'");
    
    // Revenue calculations: PRO = ₹2,499/mo, ENTERPRISE = ₹9,999/mo, TRIAL/FREE = 0
    const [planCounts] = await db.query(
      `SELECT subscription_plan, COUNT(*) as count 
       FROM restaurants 
       WHERE status = 'ACTIVE' 
       GROUP BY subscription_plan`
    );
    
    let monthlyRevenue = 0;
    planCounts.forEach(row => {
      if (row.subscription_plan === 'PRO') {
        monthlyRevenue += row.count * 2499;
      } else if (row.subscription_plan === 'ENTERPRISE') {
        monthlyRevenue += row.count * 9999;
      }
    });

    const [totalOrders] = await db.query('SELECT COUNT(*) as count FROM orders');
    
    // Simulate AI requests (averaging 7 chats per order + some browsing chats)
    const aiRequestsCount = (totalOrders[0].count * 7) + 342;

    res.json({
      totalRestaurants: totalRestaurants[0].count,
      activeRestaurants: activeRestaurants[0].count,
      trialRestaurants: trialRestaurants[0].count,
      expiredRestaurants: expiredRestaurants[0].count,
      suspendedRestaurants: suspendedRestaurants[0].count,
      monthlyRevenue,
      totalOrders: totalOrders[0].count,
      aiRequests: aiRequestsCount
    });
  } catch (error) {
    console.error('SaaS stats error:', error);
    res.status(500).json({ error: 'Failed to retrieve platform stats' });
  }
};

// List all restaurants with subscriptions and owner details
exports.getRestaurantsList = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT r.*, u.name as owner_name, u.email as owner_email 
      FROM restaurants r 
      LEFT JOIN users u ON u.restaurant_id = r.id AND u.role = 'OWNER'
      ORDER BY r.created_at DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error('Get restaurants list error:', error);
    res.status(500).json({ error: 'Failed to retrieve restaurants list' });
  }
};

// Update restaurant subscription status, plan type, and expiration date
exports.updateRestaurantSubscription = async (req, res) => {
  const { id } = req.params;
  const { status, subscription_plan, subscription_expires_at } = req.body;

  const validStatuses = ['ACTIVE', 'SUSPENDED', 'TRIAL', 'EXPIRED'];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid subscription status' });
  }

  const validPlans = ['FREE', 'PRO', 'ENTERPRISE'];
  if (subscription_plan && !validPlans.includes(subscription_plan)) {
    return res.status(400).json({ error: 'Invalid subscription plan' });
  }

  try {
    let updateFields = [];
    let params = [];

    if (status) {
      updateFields.push('status = ?');
      params.push(status);
    }
    if (subscription_plan) {
      updateFields.push('subscription_plan = ?');
      params.push(subscription_plan);
    }
    if (subscription_expires_at !== undefined) {
      updateFields.push('subscription_expires_at = ?');
      params.push(subscription_expires_at ? new Date(subscription_expires_at) : null);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    params.push(id);
    const queryStr = `UPDATE restaurants SET ${updateFields.join(', ')} WHERE id = ?`;
    
    await db.query(queryStr, params);

    // Fetch updated restaurant data
    const [rows] = await db.query('SELECT * FROM restaurants WHERE id = ?', [id]);
    res.json({
      message: 'Subscription updated successfully',
      restaurant: rows[0]
    });
  } catch (error) {
    console.error('Update subscription error:', error);
    res.status(500).json({ error: 'Failed to update subscription' });
  }
};

// Create a new restaurant and owner from Super Admin
exports.createRestaurantAndOwner = async (req, res) => {
  const { restaurantName, phone, address, ownerName, ownerEmail, ownerPassword, subscriptionPlan } = req.body;

  if (!restaurantName || !ownerName || !ownerEmail || !ownerPassword) {
    return res.status(400).json({ error: 'Restaurant Name, Owner Name, Email, and Password are required' });
  }

  try {
    // Check if email already registered
    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [ownerEmail]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Insert restaurant
    const expiryDate = new Date();
    expiryDate.setMonth(expiryDate.getMonth() + 1); // 1 month trial

    const [restResult] = await db.query(
      `INSERT INTO restaurants (name, phone, email, address, status, subscription_plan, subscription_expires_at) 
       VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      [restaurantName, phone || '', ownerEmail, address || '', subscriptionPlan || 'FREE', expiryDate]
    );
    const restaurantId = restResult.insertId;

    // Create Owner user
    const hashedPassword = await bcrypt.hash(ownerPassword, 10);
    await db.query(
      'INSERT INTO users (restaurant_id, name, email, password, role) VALUES (?, ?, ?, ?, \'OWNER\')',
      [restaurantId, ownerName, ownerEmail, hashedPassword]
    );

    res.status(201).json({
      message: 'Restaurant and Owner account created successfully',
      restaurantId
    });
  } catch (error) {
    console.error('SaaS create tenant error:', error);
    res.status(500).json({ error: 'Failed to create restaurant and owner' });
  }
};
