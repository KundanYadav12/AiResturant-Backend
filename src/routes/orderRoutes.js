const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// Public routes (used by Customer QR page)
router.post('/orders', orderController.createOrder);
router.post('/orders/chat', orderController.chatWithAI);
router.get('/orders/tables/:tableId', orderController.getTableDetails);
router.get('/orders/:id/public', orderController.getOrderById); // Customer checks single order status

// Protected routes (used by Manager Dashboard)
router.get(
  '/orders',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  orderController.getOrders
);
router.put(
  '/orders/:id/status',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  orderController.updateOrderStatus
);

module.exports = router;
