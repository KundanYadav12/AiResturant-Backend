const db = require('../config/database');

async function getRestaurantAiConfig(restaurantId) {
  try {
    const [rows] = await db.query(
      'SELECT api_mode, allow_google_api, allow_groq_api, allow_customer_api, google_api_key, groq_api_key FROM restaurants WHERE id = ?',
      [restaurantId]
    );
    if (rows.length > 0) {
      return rows[0];
    }
  } catch (err) {
    console.error('Error fetching restaurant AI config:', err);
  }
  return null;
}

async function getGeminiKey(restaurantId) {
  const platformKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '';
  if (!restaurantId) return platformKey;
  
  const config = await getRestaurantAiConfig(restaurantId);
  if (!config) return platformKey;

  const allowGoogle = config.allow_google_api !== false && config.allow_google_api !== 0;
  const allowCustomer = config.allow_customer_api === true || config.allow_customer_api === 1;

  if (config.api_mode === 'customer' && allowCustomer && allowGoogle) {
    const customerKey = config.google_api_key ? config.google_api_key.trim() : '';
    return customerKey || platformKey; // Fallback to platform key if customer key is empty
  }
  return platformKey;
}

async function getGroqKey(restaurantId) {
  const platformKey = process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.trim() : '';
  if (!restaurantId) return platformKey;

  const config = await getRestaurantAiConfig(restaurantId);
  if (!config) return platformKey;

  const allowGroq = config.allow_groq_api !== false && config.allow_groq_api !== 0;
  const allowCustomer = config.allow_customer_api === true || config.allow_customer_api === 1;

  if (config.api_mode === 'customer' && allowCustomer && allowGroq) {
    const customerKey = config.groq_api_key ? config.groq_api_key.trim() : '';
    return customerKey || platformKey; // Fallback to platform key if customer key is empty
  }
  return platformKey;
}

module.exports = {
  getGeminiKey,
  getGroqKey,
  getRestaurantAiConfig
};
