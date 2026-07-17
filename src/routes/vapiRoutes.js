const express  = require('express');
const router   = express.Router();
const vapiCtrl = require('../controllers/vapiController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// ─── Public (called by frontend Vapi Web Client) ────────────────────────────
// Returns Vapi assistant config for a specific table (no auth needed — token-secured)
router.post('/session/:tableToken', vapiCtrl.getVapiSession);

// ─── Vapi Platform Webhooks (no auth — Vapi signs requests) ─────────────────
// Receives call lifecycle events (call-started, call-ended, transcript)
router.post('/webhook', vapiCtrl.vapiWebhook);

// ─── Custom LLM Endpoint (called by Vapi during a live call) ────────────────
// Vapi POSTs to this endpoint when it needs an AI response.
// No Bearer auth — Vapi sends an X-Vapi-Secret header (verified via env var below).
router.post('/custom-llm', vapiCtrl.customLlmHandler);
router.post('/custom-llm/chat/completions', vapiCtrl.customLlmHandler);

// ─── Super Admin Analytics ───────────────────────────────────────────────────
router.get(
  '/usage',
  authenticateToken,
  requireRole(['SUPER_ADMIN']),
  vapiCtrl.getVoiceUsageStats
);

module.exports = router;
