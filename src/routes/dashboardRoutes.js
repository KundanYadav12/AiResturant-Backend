const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

router.use(authenticateToken);
router.use(requireRole(['OWNER', 'MANAGER']));

// Analytics reports
router.get('/analytics', dashboardController.getAnalytics);

// Table management
router.get('/tables', dashboardController.getTables);
router.post('/tables', dashboardController.createTable);
router.delete('/tables/:id', dashboardController.deleteTable);

// AI Waiter & Voice settings
router.get('/settings', dashboardController.getSettings);
router.put('/settings', dashboardController.updateSettings);

// AI Provider Settings
router.get('/settings/ai', dashboardController.getAiProviderSettings);
router.put('/settings/ai', dashboardController.updateAiProviderSettings);

module.exports = router;
