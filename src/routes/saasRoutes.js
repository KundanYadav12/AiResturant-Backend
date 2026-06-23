const express = require('express');
const router = express.Router();
const saasController = require('../controllers/saasController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

router.use(authenticateToken);
router.use(requireRole(['SUPER_ADMIN']));

// Super Admin platform metrics
router.get('/stats', saasController.getPlatformStats);

// List all restaurants
router.get('/restaurants', saasController.getRestaurantsList);

// Update restaurant subscription plan & status
router.put('/restaurants/:id/subscription', saasController.updateRestaurantSubscription);

// Create new restaurant and owner from Super Admin portal
router.post('/restaurants', saasController.createRestaurantAndOwner);

module.exports = router;
