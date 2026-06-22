const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const db = require('./config/database');
const socketService = require('./services/socketService');

// Route Imports
const authRoutes = require('./routes/authRoutes');
const menuRoutes = require('./routes/menuRoutes');
const orderRoutes = require('./routes/orderRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
socketService.init(server);

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Static files for uploaded menu images
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api', orderRoutes); // orders routes are prefixed under root api
app.use('/api/dashboard', dashboardRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date() });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err.message);
  res.status(500).json({ error: err.message || 'Something went wrong on the server' });
});

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // 1. Initialize database and schema
    await db.initializeDatabase();
    
    // 2. Start HTTP & Socket server
    server.listen(PORT, () => {
      console.log(`=============================================`);
      console.log(`  AI Restaurant Backend running on port ${PORT}`);
      console.log(`  Real-time Socket.IO enabled`);
      console.log(`=============================================`);
    });
  } catch (error) {
    console.error('Could not start server due to database init failure:', error);
    process.exit(1);
  }
}

startServer();
