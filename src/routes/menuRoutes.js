const express = require('express');
const router = express.Router();
const menuController = require('../controllers/menuController');
const stageController = require('../controllers/stageController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// Public routes for Customer QR Page (identified by Table Token)
router.get('/tables/token/:tableToken/categories', menuController.getCategoriesByToken);
router.get('/tables/token/:tableToken/items', menuController.getMenuItemsByToken);
router.get('/tables/token/:tableToken/stages', stageController.getStagesByTableToken);

// Existing Legacy Public routes (retained for backward compatibility)
router.get('/restaurants/:restaurantId/categories', menuController.getCategories);
router.get('/restaurants/:restaurantId/items', menuController.getMenuItems);

// Protected Category routes (Owner/Manager)
router.post(
  '/categories',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.createCategory
);
router.put(
  '/categories/reorder',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.reorderCategories
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

// Protected Menu Item routes (Owner/Manager)
router.post(
  '/items',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.uploadImage,
  menuController.createMenuItem
);
router.put(
  '/items/reorder',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.reorderMenuItems
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

// Protected Ingredients & Allergens routes (Owner/Manager)
router.get(
  '/ingredients',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.getIngredients
);
router.post(
  '/ingredients',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.createIngredient
);
router.delete(
  '/ingredients/:id',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.deleteIngredient
);
router.get(
  '/items/:id/ingredients',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.getMenuItemIngredients
);
router.post(
  '/items/:id/ingredients',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.linkMenuItemIngredients
);

// Protected Customizations routes (Owner/Manager)
router.get(
  '/items/:id/customizations',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.getMenuItemCustomizations
);
router.post(
  '/items/:id/customizations',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.createMenuItemCustomization
);
router.delete(
  '/customizations/:id',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.deleteMenuItemCustomization
);

// Protected FAQ routes (Owner/Manager)
router.get(
  '/faqs',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.getFAQs
);
router.post(
  '/faqs',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.createFAQ
);
router.put(
  '/faqs/:id',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.updateFAQ
);
router.delete(
  '/faqs/:id',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.deleteFAQ
);

// Protected AI general knowledge text routes (Owner/Manager)
router.get(
  '/knowledge',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.getGeneralKnowledge
);
router.post(
  '/knowledge',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  menuController.saveGeneralKnowledge
);

// Owner custom order status stages routes
router.get(
  '/restaurants/:restaurantId/stages',
  authenticateToken,
  requireRole(['OWNER', 'MANAGER']),
  stageController.getStages
);
router.post(
  '/restaurants/:restaurantId/stages',
  authenticateToken,
  requireRole(['OWNER']),
  stageController.createStage
);
router.put(
  '/restaurants/:restaurantId/stages/reorder',
  authenticateToken,
  requireRole(['OWNER']),
  stageController.reorderStages
);
router.put(
  '/restaurants/:restaurantId/stages/:stageId',
  authenticateToken,
  requireRole(['OWNER']),
  stageController.updateStage
);
router.delete(
  '/restaurants/:restaurantId/stages/:stageId',
  authenticateToken,
  requireRole(['OWNER']),
  stageController.deleteStage
);

module.exports = router;
