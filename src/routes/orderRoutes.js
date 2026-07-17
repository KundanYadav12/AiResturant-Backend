const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// Public customer routes (accessed by secure tokens - no raw IDs exposed)
router.get('/orders/tables/token/:tableToken', orderController.getTableDetailsByToken);
router.post('/orders/tables/token/:tableToken/request', orderController.createTableRequest);
router.post('/orders/chat', orderController.chatWithAI);

// Secure ElevenLabs key retrieval (exposes configured ElevenLabs key to client)
router.get('/elevenlabs-key', (req, res) => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'ELEVENLABS_API_KEY is not configured in server .env' });
  }
  res.json({ key });
});
router.post('/orders', orderController.createOrder);
router.get('/orders/:id/receipt', orderController.downloadReceipt);
router.get('/orders/:id/public', orderController.getOrderById); // single order tracking
router.post('/orders/:id/items', orderController.appendOrderItems);

// Manager protected routes
router.get(
  '/orders/history',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  orderController.getOrderHistory
);
router.get(
  '/orders/export',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER', 'SUPER_ADMIN']),
  orderController.exportOrderHistory
);
router.put(
  '/orders/:id/archive',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  orderController.archiveOrder
);
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
