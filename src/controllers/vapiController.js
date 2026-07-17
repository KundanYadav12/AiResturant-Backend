const db          = require('../config/database');
const aiService   = require('../services/aiService');
const socketService = require('../services/socketService');
const { generateId } = require('../utils/idGenerator');

// ─── Active Cart In-Memory Cache ──────────────────────────────────────────────
// Maps tableToken -> currentCart (array of items)
const activeCarts = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch a restaurant row by table token.
 * Returns null if token is invalid or restaurant is suspended.
 */
async function getRestaurantByTableToken(tableToken) {
  const [rows] = await db.query(
    `SELECT r.*
     FROM restaurants r
     JOIN tables t ON t.restaurant_id = r.id
     WHERE t.table_token = ?
       AND r.deleted_at IS NULL`,
    [tableToken]
  );
  return rows[0] || null;
}

/**
 * Reset daily voice-minute counter if it's a new calendar day.
 */
async function resetDailyMinutesIfNeeded(restaurant) {
  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  if (restaurant.voice_minutes_reset_date !== today) {
    await db.query(
      `UPDATE restaurants
         SET voice_minutes_used_today = 0,
             voice_minutes_reset_date = ?
       WHERE id = ?`,
      [today, restaurant.id]
    );
    restaurant.voice_minutes_used_today = 0;
    restaurant.voice_minutes_reset_date = today;
  }
}

// ─── POST /api/vapi/session/:tableToken ──────────────────────────────────────

/**
 * Returns the Vapi assistant configuration needed to initialise a call.
 * Called by CustomerOrder.jsx before starting a Vapi session.
 * Accepts { cart } in the body to initialize the voice session cart.
 *
 * Returns:
 *  { vapiEnabled, assistantId, greeting, language, inactivityTimeout, dailyMinutesLeft }
 */
async function getVapiSession(req, res) {
  try {
    const { tableToken } = req.params;
    const { cart = [] } = req.body;

    const restaurant = await getRestaurantByTableToken(tableToken);

    if (!restaurant) {
      return res.status(404).json({ error: 'Table not found' });
    }

    if (!restaurant.vapi_enabled) {
      return res.json({
        vapiEnabled: false,
        message: 'Vapi Premium Voice is not enabled for this restaurant.',
      });
    }

    await resetDailyMinutesIfNeeded(restaurant);

    const maxMin   = parseFloat(restaurant.max_voice_minutes_per_day) || 0;
    const usedMin  = parseFloat(restaurant.voice_minutes_used_today)  || 0;
    const leftMin  = maxMin > 0 ? Math.max(0, maxMin - usedMin) : null; // null = unlimited

    if (maxMin > 0 && usedMin >= maxMin) {
      return res.json({
        vapiEnabled: false,
        limitReached: true,
        message: `Daily voice limit of ${maxMin} minutes reached. Please use text chat.`,
      });
    }

    // Initialize/sync the active cart for this session
    activeCarts.set(tableToken, cart);

    // Build the Custom LLM URL dynamically so it points to this backend
    const backendBase = process.env.BACKEND_PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`;
    const customLlmUrl = `${backendBase}/api/vapi/custom-llm`;

    return res.json({
      vapiEnabled: true,
      assistantId: restaurant.vapi_assistant_id || null,
      customLlmUrl,
      greeting: restaurant.greeting_message || 'Hello! Welcome. How can I help you today?',
      language: restaurant.voice_language || 'en-IN',
      inactivityTimeout: restaurant.inactivity_timeout || 30,
      dailyMinutesLeft: leftMin,
      tableToken,
      restaurantName: restaurant.name,
    });
  } catch (err) {
    console.error('vapiController.getVapiSession error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── POST /api/vapi/custom-llm ───────────────────────────────────────────────

/**
 * Custom LLM endpoint — Vapi calls this during a live call when it needs an AI response.
 *
 * Vapi sends an OpenAI-compatible request body:
 * {
 *   model: "...",
 *   messages: [ { role: "system"|"user"|"assistant", content: "..." }, ... ]
 * }
 *
 * We extract the latest user message + resolve the current cart from table token,
 * call aiService.processCustomerMessage(), and return an OpenAI-style streaming SSE response.
 *
 * NOTE: Vapi requires SSE (Server-Sent Events) response in OpenAI streaming format.
 */
async function customLlmHandler(req, res) {
  try {
    const { messages = [], call } = req.body;

    // Extract table token from Vapi call metadata
    const tableToken = call?.metadata?.tableToken || req.headers['x-table-token'] || null;

    // Resolve restaurant & cart from table token if available
    let restaurantId = null;
    let currentCart  = [];

    if (tableToken) {
      const restaurant = await getRestaurantByTableToken(tableToken);
      if (restaurant) restaurantId = restaurant.id;
      // Load cart from our backend state cache
      currentCart = activeCarts.get(tableToken) || [];
    }

    // Build chat history from messages (exclude system prompt)
    const chatHistory = messages
      .filter(m => m.role !== 'system')
      .slice(0, -1) // exclude the last (current) user message
      .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    // Get the latest user message
    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
    const userText = lastUserMsg?.content || '';

    // Call AI service (voiceMode = true triggers voice optimized prompts)
    const aiResult = restaurantId
      ? await aiService.processCustomerMessage(restaurantId, userText, currentCart, chatHistory, true)
      : { items: [], assistantResponse: "I'm sorry, I couldn't identify your table. Please try again." };

    const replyText = aiResult.assistantResponse;
    const newCart   = aiResult.items || [];

    if (tableToken) {
      // Save new cart state
      activeCarts.set(tableToken, newCart);
      // Broadcast cart state change to frontend real-time room
      socketService.emitCartUpdate(tableToken, newCart, replyText);
    }

    // Return OpenAI-compatible SSE streaming response (required by Vapi)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send a single complete chunk (non-streaming fallback — still valid for Vapi)
    const chunk = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'custom-llm',
      choices: [{
        index: 0,
        delta: { role: 'assistant', content: replyText },
        finish_reason: null,
      }],
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);

    // Send final [DONE] chunk
    const doneChunk = {
      ...chunk,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    };
    res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    console.error('vapiController.customLlmHandler error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Custom LLM error' });
    } else {
      res.end();
    }
  }
}

// ─── POST /api/vapi/webhook ──────────────────────────────────────────────────

/**
 * Vapi lifecycle webhook. Receives events like:
 *  - call-started
 *  - call-ended  (contains durationSeconds)
 *  - transcript
 *  - function-call
 *
 * We use call-ended to log usage minutes for SaaS billing.
 */
async function vapiWebhook(req, res) {
  try {
    const { message } = req.body;
    if (!message) return res.json({ received: true });

    const { type, call } = message;
    const tableToken = call?.metadata?.tableToken;

    if (type === 'end-of-call-report' && call) {
      const durationSeconds = call.durationSeconds || 0;
      const durationMinutes = parseFloat((durationSeconds / 60).toFixed(4));
      const vapiCallId      = call.id || null;

      // Resolve restaurant
      const restaurant = tableToken ? await getRestaurantByTableToken(tableToken) : null;

      if (restaurant) {
        const today = new Date().toISOString().slice(0, 10);
        const logId = 'vul_' + require('crypto').randomBytes(8).toString('hex');

        // Insert voice usage log
        await db.query(
          `INSERT INTO voice_usage_logs
             (id, restaurant_id, call_date, call_duration_s, call_minutes, vapi_call_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [logId, restaurant.id, today, durationSeconds, durationMinutes, vapiCallId]
        );

        // Increment daily usage counter
        await db.query(
          `UPDATE restaurants
             SET voice_minutes_used_today = voice_minutes_used_today + ?
           WHERE id = ?`,
          [durationMinutes, restaurant.id]
        );

        console.log(`📞 Vapi call ended: ${vapiCallId} — ${durationMinutes} min — restaurant: ${restaurant.id}`);
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('vapiController.vapiWebhook error:', err);
    res.json({ received: true }); // always 200 to Vapi
  }
}

// ─── Super Admin: GET /api/vapi/usage ────────────────────────────────────────

/**
 * Returns voice usage stats for all restaurants (super admin only).
 */
async function getVoiceUsageStats(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT
         r.id,
         r.name AS restaurant_name,
         r.vapi_enabled,
         r.max_voice_minutes_per_day,
         r.voice_minutes_used_today,
         COALESCE(SUM(v.call_minutes), 0) AS total_minutes_all_time,
         COUNT(v.id) AS total_calls
       FROM restaurants r
       LEFT JOIN voice_usage_logs v ON v.restaurant_id = r.id
       WHERE r.deleted_at IS NULL
       GROUP BY r.id
       ORDER BY total_minutes_all_time DESC`
    );
    res.json({ voiceUsage: rows });
  } catch (err) {
    console.error('vapiController.getVoiceUsageStats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getVapiSession,
  customLlmHandler,
  vapiWebhook,
  getVoiceUsageStats,
};
