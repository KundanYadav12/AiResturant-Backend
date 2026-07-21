const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('../config/database');
require('dotenv').config();

const parseQuantity = (val) => {
  if (val === null || val === undefined) return 1;
  if (typeof val === 'number') {
    return Number.isNaN(val) ? 1 : val;
  }
  const str = String(val).toLowerCase().trim();
  const parsed = parseInt(str, 10);
  if (!Number.isNaN(parsed)) return parsed;

  const wordMap = {
    'one': 1, 'ek': 1, 'do': 2, 'two': 2, 'three': 3, 'teen': 3,
    'four': 4, 'char': 4, 'five': 5, 'paanch': 5, 'six': 6, 'che': 6,
    'seven': 7, 'saat': 7, 'eight': 8, 'aath': 8, 'nine': 9, 'nau': 9,
    'ten': 10, 'das': 10
  };
  return wordMap[str] || 1;
};

const { getGeminiKey } = require('../utils/aiKeys');

async function getGeminiClientForRestaurant(restaurantId) {
  const apiKey = await getGeminiKey(restaurantId);
  if (!apiKey) throw new Error('GEMINI_API_KEY is not defined (platform or custom).');
  return new GoogleGenerativeAI(apiKey);
}

const { GEMINI_MODEL } = require('../config/aiConfig');

/**
 * Helper to call Gemini API with automatic retries for 503 Service Unavailable / 429 High Demand errors.
 */
async function callGeminiWithFallback(genAI, systemPrompt, geminiContents, voiceMode) {
  const modelName = GEMINI_MODEL;
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const geminiModel = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: systemPrompt
        });

        const geminiResp = await geminiModel.generateContent({
          contents: geminiContents,
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
            maxOutputTokens: voiceMode ? 300 : 1024,
          }
        });

        console.log(`[aiService] ✅ Gemini responded successfully using model "${modelName}" (attempt ${attempt})`);
        return geminiResp.response.text();
      } catch (err) {
        lastError = err;
        const errStr = String(err.message || err);
        const isTemporaryError = errStr.includes('503') || errStr.includes('429') || errStr.toLowerCase().includes('high demand') || errStr.toLowerCase().includes('temporarily') || errStr.toLowerCase().includes('unavailable');

        console.warn(`[aiService] ⚠️ Gemini call failed on model "${modelName}" (attempt ${attempt}/2): ${errStr}`);

        if (isTemporaryError && attempt === 1) {
          await new Promise(res => setTimeout(res, 600));
        } else {
          break;
        }
      }
    }

  throw lastError || new Error(`Gemini model ${GEMINI_MODEL} failed due to high demand or service unavailability.`);
}

// ── Voice-mode aware prompt builder ──────────────────────────────────────────

function buildSystemPrompt(formattedMenu, formattedFAQs, knowledgeBase, voiceMode = false) {
  const toneInstructions = voiceMode
    ? `VOICE MODE — Speak in natural, fluent Delhi/Mumbai style Hinglish (Hindi written phonetically in English/Latin letters).
       CRITICAL: Keep your response extremely brief (MAXIMUM 5 to 7 words). Absolutely never exceed 7 words.
       Do not say welcomes or repeat greetings. Do not say polite fillers. Speak like a busy waiter.
       NEVER write Devanagari characters (like नमस्ते, आपका) — use phonetic spelling (e.g., "Namaste", "Aapka").
       Examples: "Namaste! Aaj kya lenge ji?" (5 words), "Got it, paneer tikka add ho gaya." (7 words), "Aur kuch chahiye?" (3 words), "Sorry, noodles menu me nahi hai." (5 words).`
    : `TEXT MODE — you may use short structured replies.
       Keep responses friendly and concise (max 3 lines).
       No markdown headers, no bullet points.`;

  return `You are Raju, a friendly and smart AI Restaurant Waiter. Help customers order food and answer questions.

=== RESTAURANT MENU ===
${JSON.stringify(formattedMenu, null, 2)}

=== FAQs ===
${formattedFAQs || 'No FAQs available.'}

=== KITCHEN KNOWLEDGE ===
${knowledgeBase}

RULES:
1. Parse what the customer wants and update the cart accordingly.
2. Match items by name to the menu. If the item requested is close to a menu item (e.g. "Paneer Butter" vs "Paneer Butter Masala"), match it to the correct menu item. If not found, say it is unavailable.
3. OUT_OF_STOCK items: never add them to the cart.
4. Handle add, remove, update quantity, and customizations naturally.
5. Upsell naturally — suggest drinks or desserts when mains are ordered.
6. Answer allergen/dietary queries strictly from the ingredients list.
7. Respond in the same language the customer is using (English, Hindi, or Hinglish).
8. ${toneInstructions}
9. Intelligently split the customer's request if they order multiple items in a single sentence (e.g., "Paneer Tikka Masala, Masala Shikanji" or "Paneer Butter Masala, 2 Butter Naan and one Coke"). Extract quantities (e.g., "do" = 2, "ek" = 1, "two" = 2, "one" = 1) and add each menu item separately to the cart list.
10. You MUST respond ONLY with a valid JSON object. No markdown, no backticks.

REQUIRED JSON OUTPUT FORMAT:
{
  "items": [
    {
      "menu_item_id": "<string>",
      "name": "<string>",
      "price": <number>,
      "quantity": <number>,
      "customizations": ["<string>"]
    }
  ],
  "assistantResponse": "<your spoken reply to the customer>"
}`;
}

function cleanAndParseJSON(text) {
  if (!text) return null;
  let cleanText = text.trim();
  
  // Remove markdown code block wrappers
  cleanText = cleanText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  // Extract JSON object or array between first '{' or '[' and last '}' or ']'
  const firstBrace = cleanText.indexOf('{');
  const firstBracket = cleanText.indexOf('[');
  let startIdx = -1;

  if (firstBrace !== -1 && firstBracket !== -1) {
    startIdx = Math.min(firstBrace, firstBracket);
  } else if (firstBrace !== -1) {
    startIdx = firstBrace;
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
  }

  const lastBrace = cleanText.lastIndexOf('}');
  const lastBracket = cleanText.lastIndexOf(']');
  const endIdx = Math.max(lastBrace, lastBracket);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    cleanText = cleanText.substring(startIdx, endIdx + 1);
  }

  try {
    return JSON.parse(cleanText);
  } catch (err) {
    console.error('[aiService] Standard JSON.parse failed. Attempting cleanup... Text:', cleanText);
    
    let fixed = cleanText
      .replace(/,\s*([\]}])/g, '$1')
      .replace(/[\r\n]+/g, ' ')
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
      .trim();
      
    try {
      return JSON.parse(fixed);
    } catch (err2) {
      console.error('[aiService] Cleanup JSON parse also failed:', err2.message);
      throw err;
    }
  }
}

// ── Main exported function ────────────────────────────────────────────────────

/**
 * Processes a customer message with full RAG context.
 * @param {string}  restaurantId    - The restaurant's ID.
 * @param {string}  customerMessage - The customer's text/voice message.
 * @param {Array}   currentCart     - Current cart items.
 * @param {Array}   chatHistory     - Last N conversation turns.
 * @param {boolean} voiceMode       - If true, AI replies are optimized for TTS (short, no markdown).
 */
async function processCustomerMessage(restaurantId, customerMessage, currentCart = [], chatHistory = [], voiceMode = false) {
  try {
    // 1. Fetch RAG Context from Database
    const [menu] = await db.query(
      `SELECT m.*, c.name as category_name
       FROM menu_items m
       JOIN categories c ON m.category_id = c.id
       WHERE m.restaurant_id = ?`,
      [restaurantId]
    );

    const [ingredients] = await db.query(
      `SELECT mii.menu_item_id, i.name as ingredient_name, mii.is_allergen
       FROM menu_item_ingredients mii
       JOIN ingredients i ON mii.ingredient_id = i.id
       WHERE i.restaurant_id = ?`,
      [restaurantId]
    );

    const [customizations] = await db.query(
      `SELECT mic.*
       FROM menu_item_customizations mic
       JOIN menu_items m ON mic.menu_item_id = m.id
       WHERE m.restaurant_id = ?`,
      [restaurantId]
    );

    const [faqs] = await db.query(
      `SELECT * FROM faqs WHERE restaurant_id = ?`,
      [restaurantId]
    );

    const [knowledgeRows] = await db.query(
      `SELECT content FROM ai_knowledge WHERE restaurant_id = ? LIMIT 1`,
      [restaurantId]
    );
    const knowledgeBase = knowledgeRows.length > 0 ? knowledgeRows[0].content : 'No additional guidelines.';

    // 2. Format Menu
    const formattedMenu = menu.map(item => {
      const itemIngredients = ingredients
        .filter(ing => ing.menu_item_id === item.id)
        .map(ing => `${ing.ingredient_name}${ing.is_allergen ? ' (ALLERGEN)' : ''}`);

      const itemCustomizations = customizations
        .filter(cust => cust.menu_item_id === item.id)
        .map(cust => `${cust.name} (+Rs.${cust.price})`);

      return {
        id: item.id,
        name: item.name,
        price: parseFloat(item.price),
        description: item.description,
        category: item.category_name,
        ingredients: itemIngredients,
        customizations: itemCustomizations,
        status: item.is_active ? 'AVAILABLE' : 'OUT_OF_STOCK'
      };
    });

    // 3. Format FAQs
    const formattedFAQs = faqs.map(faq => `Q: ${faq.question}\nA: ${faq.answer}`).join('\n\n');

    // 4. Build system prompt (voice-mode-aware)
    const systemPrompt = buildSystemPrompt(formattedMenu, formattedFAQs, knowledgeBase, voiceMode);

    // 5. Clean chat history — normalize roles for both Groq and Gemini
    const cleanHistory = chatHistory.slice(-6).map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
    }));

    const userTurnContent = `Current Cart: ${JSON.stringify(currentCart)}\n\nCustomer says: "${customerMessage}"`;

    // 6. Call Gemini
    let genAI;
    try {
      genAI = await getGeminiClientForRestaurant(restaurantId);
    } catch (err) {
      console.warn('[aiService] Failed to load custom Gemini client, falling back to platform client:', err.message);
      const platformKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '';
      genAI = new GoogleGenerativeAI(platformKey);
    }
    
    const geminiContents = [
      ...cleanHistory,
      { role: 'user', parts: [{ text: userTurnContent }] }
    ];

    const geminiText = await callGeminiWithFallback(genAI, systemPrompt, geminiContents, voiceMode);
    const result = cleanAndParseJSON(geminiText);
    console.log('AI: Gemini responded successfully (voiceMode:', voiceMode, ')');

    const { matchMenuItem } = require('../utils/menuMatcher');
    const mappedItems = [];
    (result.items || []).forEach(item => {
      const matchResult = matchMenuItem(item.name, formattedMenu);
      const qty = parseQuantity(item.quantity);
      
      if (matchResult) {
        mappedItems.push({
          menu_item_id: matchResult.item.id,
          name: matchResult.item.name,
          price: parseFloat(matchResult.item.price) || 0,
          quantity: qty,
          customizations: item.customizations || []
        });
      } else {
        console.warn(`[aiService] ⚠ No menu match found for text chat item: "${item.name}"`);
      }
    });

    return {
      items: mappedItems,
      assistantResponse: result.assistantResponse || "I'm here to help! What would you like to order?"
    };
  } catch (error) {
    console.error('AI Service overall error:', error.message || error);
    return {
      items: currentCart,
      assistantResponse: "Sorry, I'm having a little trouble right now. Please try again or call the waiter for assistance."
    };
  }
}

/**
 * Fetches RAG context for a dining table by token and compiles a customized system instruction
 * for the Gemini Multimodal Live API.
 */
async function getVoiceAgentContext(tableToken, clientLanguageCode) {
  try {
    // 1. Fetch table and restaurant details using raw SQL JOIN
    const [tables] = await db.query(
      `SELECT t.*, r.name as restaurant_name, r.greeting_message, r.voice_language, r.voice_gender, r.voice_speed, r.auto_listening_timeout, r.wake_word, r.vapi_enabled, r.voice_provider
       FROM tables t
       JOIN restaurants r ON t.restaurant_id = r.id
       WHERE t.table_token = ?`,
      [tableToken]
    );

    if (tables.length === 0) {
      throw new Error('Table or QR code is invalid');
    }
    const table = tables[0];
    const restaurantId = table.restaurant_id;

    // 2. Fetch RAG Context from Database (Menu, Ingredients, Customizations, FAQs, guidelines)
    const [menu] = await db.query(
      `SELECT m.*, c.name as category_name
       FROM menu_items m
       JOIN categories c ON m.category_id = c.id
       WHERE m.restaurant_id = ?`,
      [restaurantId]
    );

    const [ingredients] = await db.query(
      `SELECT mii.menu_item_id, i.name as ingredient_name, mii.is_allergen
       FROM menu_item_ingredients mii
       JOIN ingredients i ON mii.ingredient_id = i.id
       WHERE i.restaurant_id = ?`,
      [restaurantId]
    );

    const [customizations] = await db.query(
      `SELECT mic.*
       FROM menu_item_customizations mic
       JOIN menu_items m ON mic.menu_item_id = m.id
       WHERE m.restaurant_id = ?`,
      [restaurantId]
    );

    const [faqs] = await db.query(
      `SELECT * FROM faqs WHERE restaurant_id = ?`,
      [restaurantId]
    );

    const [knowledgeRows] = await db.query(
      `SELECT content FROM ai_knowledge WHERE restaurant_id = ? LIMIT 1`,
      [restaurantId]
    );
    const knowledgeBase = knowledgeRows.length > 0 ? knowledgeRows[0].content : 'No additional guidelines.';

    // 3. Format Menu
    const formattedMenu = menu.map(item => {
      const itemIngredients = ingredients
        .filter(ing => ing.menu_item_id === item.id)
        .map(ing => `${ing.ingredient_name}${ing.is_allergen ? ' (ALLERGEN)' : ''}`);

      const itemCustomizations = customizations
        .filter(cust => cust.menu_item_id === item.id)
        .map(cust => `${cust.name} (+Rs.${cust.price})`);

      return {
        id: item.id,
        name: item.name,
        price: parseFloat(item.price),
        description: item.description,
        category: item.category_name,
        ingredients: itemIngredients,
        customizations: itemCustomizations,
        status: item.is_active ? 'AVAILABLE' : 'OUT_OF_STOCK'
      };
    });

    // 4. Format FAQs
    const formattedFAQs = faqs.map(faq => `Q: ${faq.question}\nA: ${faq.answer}`).join('\n\n');

    // 5. Compile customized system instruction depending on table.voice_language config or client override
    const activeLang = clientLanguageCode || table.voice_language || 'en-IN';
    const isHindi = activeLang.startsWith('hi');
    const languageInstruction = isHindi
      ? `Speak in natural, friendly bilingual Hinglish or Hindi (Delhi/urban style). Keep responses phonetic in standard Latin script (e.g. "Haan ji, aapka Paneer Tikka Masala add kar diya hai") so that it displays nicely in the text logs. Avoid Devanagari script (like "नमस्ते").`
      : `Speak in natural, polite Indian English or standard English. Write your response text in standard English (e.g. "Certainly! I have added one Butter Naan to your cart").`;

    const systemPrompt = `You are "Raju", a polite, friendly, and smart voice waiter at the restaurant "${table.restaurant_name}", assisting customers at dining Table ${table.table_number}.

VOICE CONVERSATION RULES:
1. Speak in a warm, friendly, natural, and conversational voice like Alexa or Siri (with a natural Indian accent).
2. ${languageInstruction} Match the customer's language.
3. Keep your responses extremely short, natural, and conversational (max 10 to 15 words, 1-2 sentences). Reply immediately.
4. Confirm user customizations (e.g. "haan ji, bina onion ke" or "spicy kar dunga").
5. Do not say welcomes or repeat greetings. Do not say polite fillers. Speak like a professional busy waiter.
6. Suggest sides/drinks naturally (e.g. "Garlic Naan Butter Chicken ke sath?" or "Lassi lenge?").
7. Answer allergen/dietary queries strictly from the ingredients list.
8. CRITICAL: Whenever the customer adds, removes, or modifies items in their order, you MUST call the "update_cart" tool with the complete, updated cart items list. Use exact menu names in your updates.
9. If the customer orders multiple items in a single turn (e.g., "Paneer Butter Masala, 2 Butter Naan and one Coke"), understand that they are separate items and add all of them to the cart in one tool call. Parse quantities/numbers carefully (e.g., "do" = 2, "ek" = 1, "two" = 2, "one" = 1).
10. If the customer requests something close to a menu item (e.g. "Paneer Tikka"), check the menu. If there is a similar item like "Paneer Tikka Masala", ask them: "Did you mean Paneer Tikka Masala?".
11. If the customer says "place order", "confirm order", "that's all", or indicates they are done ordering, summarize their final order items and ask clearly for confirmation (e.g. "Should I place this order now?"). If they confirm, you MUST call the "place_order" tool immediately to finalize the checkout.

=== RESTAURANT MENU ===
${JSON.stringify(formattedMenu, null, 2)}

=== FAQs ===
${formattedFAQs || 'No FAQs available.'}

=== KITCHEN/RESTAURANT RULES ===
${knowledgeBase}`;

    return {
      systemPrompt,
      table
    };
  } catch (error) {
    console.error('getVoiceAgentContext error:', error);
    throw error;
  }
}

module.exports = { processCustomerMessage, getVoiceAgentContext, cleanAndParseJSON };