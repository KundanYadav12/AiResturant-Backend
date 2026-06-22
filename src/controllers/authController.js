const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const db = require('../config/database');
require('dotenv').config();

exports.signup = async (req, res) => {
  const { restaurantName, name, email, password, role, phone, address } = req.body;

  try {
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Name, email, password, and role are required' });
    }

    if (role !== 'OWNER' && role !== 'MANAGER') {
      return res.status(400).json({ error: 'Role must be OWNER or MANAGER' });
    }

    // Use transaction if creating a new restaurant
    let restaurantId = req.body.restaurantId;

    if (!restaurantId) {
      if (!restaurantName) {
        return res.status(400).json({ error: 'Restaurant name is required to create a new restaurant' });
      }

      // Check if email already exists
      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      // Create restaurant
      const restaurant = await Restaurant.create({
        name: restaurantName,
        phone: phone || '',
        email: email,
        address: address || ''
      });
      restaurantId = restaurant.id;
    }

    // Create user
    const user = await User.create({
      restaurantId,
      name,
      email,
      password,
      role
    });

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, restaurantId: user.restaurantId, role: user.role, name: user.name },
      process.env.JWT_SECRET || 'ai_restaurant_jwt_secure_secret_9988!',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Signup successful',
      token,
      user: {
        id: user.id,
        restaurantId: user.restaurantId,
        name: user.name,
        email: user.email,
        role: user.role
      }
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
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Get restaurant info
    const restaurant = await Restaurant.findById(user.restaurant_id);

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, restaurantId: user.restaurant_id, role: user.role, name: user.name },
      process.env.JWT_SECRET || 'ai_restaurant_jwt_secure_secret_9988!',
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
        role: user.role
      },
      restaurant: restaurant
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ error: 'Failed to retrieve profile' });
  }
};
