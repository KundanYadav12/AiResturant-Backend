const express = require('express');
const router = express.Router();
const menuController = require('../controllers/menuController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// Public routes (used by Customer QR page)
router.get('/restaurants/:restaurantId/categories', menuController.getCategories);
router.get('/restaurants/:restaurantId/items', menuController.getMenuItems);

// Protected routes (used by Owner/Manager dashboard)
router.post(
  '/categories',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.createCategory
);
router.put(
  '/categories/:id',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.updateCategory
);
router.delete(
  '/categories/:id',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.deleteCategory
);

router.post(
  '/items',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.uploadImage,
  menuController.createMenuItem
);
router.put(
  '/items/:id',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.uploadImage,
  menuController.updateMenuItem
);
router.delete(
  '/items/:id',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.deleteMenuItem
);

module.exports = router;
