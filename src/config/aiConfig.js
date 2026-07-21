/**
 * Centralized AI Model Configuration for AI Restaurant SaaS Backend
 * All AI services & controllers import model names from this single source of truth.
 */
module.exports = {
  // Standard Gemini model for text chat, menu scanning, and order parsing
  GEMINI_MODEL: 'gemini-2.5-flash',

  // Gemini model for Multimodal Live Bidi WebSocket stream
  GEMINI_LIVE_MODEL: 'models/gemini-2.5-flash'
};
