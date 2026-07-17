const express = require('express');
const router = express.Router();
const saasController = require('../controllers/saasController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// All Super Admin routes require a valid JWT + SUPER_ADMIN role
router.use(authenticateToken);
router.use(requireRole(['SUPER_ADMIN']));

// ── Platform Stats ────────────────────────────────────────────────────────────
router.get('/stats', saasController.getPlatformStats);

// ── Restaurant Management ─────────────────────────────────────────────────────
router.get('/restaurants',                               saasController.getRestaurantsList);
router.post('/restaurants',                              saasController.createRestaurantAndOwner);
router.put('/restaurants/:id/subscription',              saasController.updateRestaurantSubscription);
router.put('/restaurants/:id/ai-settings',                saasController.updateRestaurantAiSettings);
router.delete('/restaurants/:id',                        saasController.deleteRestaurant);

// ── Owner Password Reset ──────────────────────────────────────────────────────
router.post('/restaurants/reset-password',               saasController.resetOwnerPassword);

// ── AI Usage Tracking ─────────────────────────────────────────────────────────
router.get('/ai-usage',                                  saasController.getAiUsage);

module.exports = router;
