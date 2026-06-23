const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// Public customer routes (accessed by secure tokens - no raw IDs exposed)
router.get('/orders/tables/token/:tableToken', orderController.getTableDetailsByToken);
router.post('/orders/tables/token/:tableToken/request', orderController.createTableRequest);
router.post('/orders/chat', orderController.chatWithAI);
router.post('/orders', orderController.createOrder);
router.get('/orders/:id/public', orderController.getOrderById); // single order tracking

// Manager protected routes
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

// Manager dashboard table requests & status tracking
router.get(
  '/dashboard/requests',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  orderController.getPendingRequests
);
router.put(
  '/dashboard/requests/:requestId/complete',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  orderController.completeRequest
);
router.get(
  '/dashboard/tables/status',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  orderController.getTableStatuses
);

module.exports = router;
