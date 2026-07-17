const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { sanitizeRestaurant } = require('../utils/sanitize');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'ai_restaurant_jwt_secure_secret_9988!';

exports.signup = async (req, res) => {
  const { restaurantName, name, email, password, role, phone, address } = req.body;

  try {
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Name, email, password, and role are required' });
    }
    if (role !== 'OWNER' && role !== 'MANAGER') {
      return res.status(400).json({ error: 'Role must be OWNER or MANAGER' });
    }

    let restaurantId = req.body.restaurantId;

    if (!restaurantId) {
      if (!restaurantName) {
        return res.status(400).json({ error: 'Restaurant name is required to create a new restaurant' });
      }
      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: 'Email already registered' });
      }
      // Creates restaurant with rst_xxx ID
      const restaurant = await Restaurant.create({ name: restaurantName, phone, email, address });
      restaurantId = restaurant.id;
    }

    // Creates user with usr_xxx ID
    const user = await User.create({ restaurantId, name, email, password, role });

    const token = jwt.sign(
      { id: user.id, restaurantId: user.restaurantId, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Signup successful',
      token,
      user: { id: user.id, restaurantId: user.restaurantId, name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Failed to complete signup' });
  }
};

exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid email or password' });

    // Update last login timestamp
    await User.updateLastLogin(user.id);

    // Fetch restaurant (null for SUPER_ADMIN)
    let restaurant = user.restaurant_id ? await Restaurant.findById(user.restaurant_id) : null;
    if (restaurant) {
      restaurant = sanitizeRestaurant(restaurant);
    }

    const token = jwt.sign(
      { id: user.id, restaurantId: user.restaurant_id, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        restaurantId: user.restaurant_id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      restaurant,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ error: 'Failed to retrieve profile' });
  }
};
