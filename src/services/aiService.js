// const { GoogleGenerativeAI } = require('@google/generative-ai');
// const Groq = require('groq-sdk');
// const db = require('../config/database');
// require('dotenv').config();
// let groqClient;
// let geminiClient;

// function getGroqClient() {
//   if (!groqClient) {
//     const apiKey = process.env.GROQ_API_KEY;
//     if (!apiKey) {
//       throw new Error('GROQ_API_KEY is not defined in environment variables. Get a free key at https://console.groq.com');
//     }
//     groqClient = new Groq({ apiKey });
//   }
//   return groqClient;
// }

// function getGeminiClient() {
//   if (!geminiClient) {
//     const apiKey = process.env.GEMINI_API_KEY;
//     if (!apiKey) {
//       throw new Error('GEMINI_API_KEY is not defined in environment variables. Get a key from Google AI Studio.');
//     }
//     const genAI = new GoogleGenerativeAI(apiKey);
//     geminiClient = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
//   }
//   return geminiClient;
// }

// /**
//  * Parses customer message to update the current cart and provide a conversational response.
//  * Uses Groq (free, 14,400 req/day) with llama-3.1-8b-instant for instant responses.
//  * @param {number} restaurantId - The ID of the restaurant.
//  * @param {string} customerMessage - The text message sent by the customer.
//  * @param {Array} currentCart - Current list of items in the cart.
//  * @param {Array} chatHistory - Previous chat history for context.
//  */
// async function processCustomerMessage(restaurantId, customerMessage, currentCart = [], chatHistory = []) {
//   try {
//     const client = getGroqClient();

//     // 1. Fetch RAG Context from Database
//     const [menu] = await db.query(
//       `SELECT m.*, c.name as category_name 
//        FROM menu_items m 
//        JOIN categories c ON m.category_id = c.id 
//        WHERE m.restaurant_id = ?`,
//       [restaurantId]
//     );

//     const [ingredients] = await db.query(
//       `SELECT mii.menu_item_id, i.name as ingredient_name, mii.is_allergen 
//        FROM menu_item_ingredients mii 
//        JOIN ingredients i ON mii.ingredient_id = i.id 
//        WHERE i.restaurant_id = ?`,
//       [restaurantId]
//     );

//     const [customizations] = await db.query(
//       `SELECT mic.* 
//        FROM menu_item_customizations mic 
//        JOIN menu_items m ON mic.menu_item_id = m.id 
//        WHERE m.restaurant_id = ?`,
//       [restaurantId]
//     );

//     const [faqs] = await db.query(
//       `SELECT * FROM faqs WHERE restaurant_id = ?`,
//       [restaurantId]
//     );

//     const [knowledgeRows] = await db.query(
//       `SELECT content FROM ai_knowledge WHERE restaurant_id = ? LIMIT 1`,
//       [restaurantId]
//     );
//     const knowledgeBase = knowledgeRows.length > 0 ? knowledgeRows[0].content : 'No additional guidelines.';

//     // 2. Format Menu with Customizations and Ingredients
//     const formattedMenu = menu.map(item => {
//       const itemIngredients = ingredients
//         .filter(ing => ing.menu_item_id === item.id)
//         .map(ing => `${ing.ingredient_name}${ing.is_allergen ? ' (ALLERGEN)' : ''}`);

//       const itemCustomizations = customizations
//         .filter(cust => cust.menu_item_id === item.id)
//         .map(cust => `${cust.name} (+Rs.${cust.price})`);

//       return {
//         id: item.id,
//         name: item.name,
//         price: parseFloat(item.price),
//         description: item.description,
//         category: item.category_name,
//         ingredients: itemIngredients,
//         customizations: itemCustomizations,
//         status: item.is_active ? 'AVAILABLE' : 'OUT_OF_STOCK'
//       };
//     });

//     // 3. Format FAQs
//     const formattedFAQs = faqs.map(faq => `Q: ${faq.question}\nA: ${faq.answer}`).join('\n\n');

//     // 4. Build the System Prompt
//     const systemPrompt = `You are a friendly and professional AI Restaurant Waiter. Help customers order food, answer menu questions, handle allergen queries, and maintain their shopping cart.

// === RESTAURANT MENU ===
// ${JSON.stringify(formattedMenu, null, 2)}

// === FAQs ===
// ${formattedFAQs || 'No FAQs available.'}

// === KITCHEN KNOWLEDGE ===
// ${knowledgeBase}

// RULES:
// 1. Parse what the customer wants based on their message and current cart context.
// 2. Match items by name to the menu. If not found, say it's unavailable.
// 3. OUT_OF_STOCK items: never add them to the cart.
// 4. Handle add, remove, update quantity, and customizations naturally.
// 5. Upsell naturally — suggest drinks or desserts when mains are ordered.
// 6. Answer allergen/dietary queries strictly from the ingredients list.
// 7. Respond in English, Hindi, or Hinglish based on how the customer speaks.
// 8. You MUST respond ONLY with a valid JSON object. No markdown, no explanation, no backticks.

// REQUIRED JSON OUTPUT FORMAT:
// {
//   "items": [
//     {
//       "menu_item_id": <number>,
//       "name": "<string>",
//       "price": <number>,
//       "quantity": <number>,
//       "customizations": ["<string>"]
//     }
//   ],
//   "assistantResponse": "<your friendly message to the customer>"
// }`;

//     // 5. Build messages array with chat history context
//     const messages = [
//       { role: 'system', content: systemPrompt },
//       ...chatHistory.slice(-6).map(m => ({
//         role: m.role === 'user' ? 'user' : 'model',
//         content: m.content
//       })),
//       {
//         role: 'user',
//         content: `Current Cart: ${JSON.stringify(currentCart)}\n\nCustomer says: "${customerMessage}"`
//       }
//     ];

//     // 6. Try Gemini first
//     try {
//       const gemini = getGeminiClient();
//       const prompt = messages.map(m => `${m.role === 'system' ? 'System' : m.role}: ${m.content}`).join('\n\n');
//       const geminiResp = await gemini.generateContent({
//         contents: [{ role: 'user', parts: [{ text: prompt }] }],
//         generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
//       });
//       const geminiText = geminiResp.response.text();
//       const result = JSON.parse(geminiText.trim());
//       return {
//         items: Array.isArray(result.items) ? result.items : currentCart,
//         assistantResponse: result.assistantResponse || "I'm here to help! What would you like to order?"
//       };
//     } catch (geminiErr) {
//       console.warn('Gemini failed, falling back to Groq:', geminiErr.message || geminiErr);
//     }

//     // 7. Fallback to Groq
//     const groq = getGroqClient();
//     const completion = await groq.chat.completions.create({
//       model: 'llama-3.1-8b-instant',
//       messages,
//       temperature: 0.2,
//       max_tokens: 1024,
//       response_format: { type: 'json_object' }
//     });

//     const responseText = completion.choices[0].message.content.trim();
//     const result = JSON.parse(responseText);

//     return {
//       items: Array.isArray(result.items) ? result.items : currentCart,
//       assistantResponse: result.assistantResponse || "I'm here to help! What would you like to order?"
//     };

//   } catch (error) {
//     console.error('AI Service overall error:', error.message || error);
//     return {
//       items: currentCart,
//       assistantResponse: "Sorry, I'm having a little trouble right now. Please try again or call the waiter for assistance."
//     };
//   }
// }

// module.exports = {
//   processCustomerMessage
// };



const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');
const db = require('../config/database');
require('dotenv').config();

let groqClient;
let geminiClient;

function getGroqClient() {
  if (!groqClient) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY is not defined in environment variables.');
    groqClient = new Groq({ apiKey });
  }
  return groqClient;
}

function getGeminiClient() {
  if (!geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not defined in environment variables.');
    const genAI = new GoogleGenerativeAI(apiKey);
    // FIX 1: 'gemini-1.5-flash' is deprecated/removed — use 'gemini-2.0-flash'
    geminiClient = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  }
  return geminiClient;
}

async function processCustomerMessage(restaurantId, customerMessage, currentCart = [], chatHistory = []) {
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

    // 2. Format Menu with Customizations and Ingredients
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

    // 4. Build the System Prompt
    const systemPrompt = `You are a friendly and professional AI Restaurant Waiter. Help customers order food, answer menu questions, handle allergen queries, and maintain their shopping cart.

=== RESTAURANT MENU ===
${JSON.stringify(formattedMenu, null, 2)}

=== FAQs ===
${formattedFAQs || 'No FAQs available.'}

=== KITCHEN KNOWLEDGE ===
${knowledgeBase}

RULES:
1. Parse what the customer wants based on their message and current cart context.
2. Match items by name to the menu. If not found, say it's unavailable.
3. OUT_OF_STOCK items: never add them to the cart.
4. Handle add, remove, update quantity, and customizations naturally.
5. Upsell naturally — suggest drinks or desserts when mains are ordered.
6. Answer allergen/dietary queries strictly from the ingredients list.
7. Respond in English, Hindi, or Hinglish based on how the customer speaks.
8. You MUST respond ONLY with a valid JSON object. No markdown, no explanation, no backticks.

REQUIRED JSON OUTPUT FORMAT:
{
  "items": [
    {
      "menu_item_id": <number>,
      "name": "<string>",
      "price": <number>,
      "quantity": <number>,
      "customizations": ["<string>"]
    }
  ],
  "assistantResponse": "<your friendly message to the customer>"
}`;

    // 5. FIX 2: Clean chat history — sanitize roles for both Groq AND Gemini
    //    Groq/OpenAI: 'user' | 'assistant'  (NOT 'model', NOT 'bot')
    //    Google Gemini: 'user' | 'model'    (NOT 'assistant')
    //    We store ONE clean history and convert per-provider below.
    const cleanHistory = chatHistory.slice(-6).map(m => ({
      // Normalize any incoming role ('bot', 'model', 'assistant') → 'user' or 'assistant'
      role: m.role === 'user' ? 'user' : 'assistant',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    }));

    const userTurnContent = `Current Cart: ${JSON.stringify(currentCart)}\n\nCustomer says: "${customerMessage}"`;

    // 6. Try Gemini FIRST (better quality)
    try {
      const gemini = getGeminiClient();

      // Gemini needs its own role format: 'user' | 'model'
      // Also Gemini's generateContent does NOT support a system role in contents[],
      // so we prepend the system prompt as the first user turn.
      const geminiContents = [
        // System prompt injected as first user message (Gemini SDK v1 approach)
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'model', parts: [{ text: 'Understood. I am ready to assist customers.' }] },
        // Chat history converted to Gemini format
        ...cleanHistory.map(m => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content }]
        })),
        // Current user message
        { role: 'user', parts: [{ text: userTurnContent }] }
      ];

      const geminiResp = await gemini.generateContent({
        contents: geminiContents,
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
      });

      const geminiText = geminiResp.response.text();
      const result = JSON.parse(geminiText.trim());
      console.log('AI: Gemini responded successfully');
      return {
        items: Array.isArray(result.items) ? result.items : currentCart,
        assistantResponse: result.assistantResponse || "I'm here to help! What would you like to order?"
      };
    } catch (geminiErr) {
      console.warn('Gemini failed, falling back to Groq:', geminiErr.message || geminiErr);
    }

    // 7. Fallback: Groq (uses OpenAI format: 'user' | 'assistant' | 'system')
    const groqMessages = [
      { role: 'system', content: systemPrompt },
      ...cleanHistory, // already in 'user'|'assistant' format
      { role: 'user', content: userTurnContent }
    ];

    const groq = getGroqClient();
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile', // upgraded: better JSON accuracy than 8b
      messages: groqMessages,
      temperature: 0.2,
      max_tokens: 1024,
      response_format: { type: 'json_object' }
    });

    const responseText = completion.choices[0].message.content.trim();
    const result = JSON.parse(responseText);
    console.log('AI: Groq responded successfully');

    return {
      items: Array.isArray(result.items) ? result.items : currentCart,
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

module.exports = { processCustomerMessage };