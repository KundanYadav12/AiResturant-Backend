const { Anthropic } = require('@anthropic-ai/sdk');
require('dotenv').config();

let anthropic;

function getAnthropicClient() {
  if (!anthropic) {
    if (!process.env.CLAUDE_API_KEY) {
      throw new Error('CLAUDE_API_KEY is not defined in environment variables.');
    }
    anthropic = new Anthropic({
      apiKey: process.env.CLAUDE_API_KEY,
    });
  }
  return anthropic;
}

/**
 * Parses customer message to update the current cart and provide a conversational response.
 * @param {string} customerMessage - The text message sent by the customer.
 * @param {Array} menu - Array of menu items available.
 * @param {Array} currentCart - Current list of items in the cart.
 * @param {Array} chatHistory - (Optional) Previous chat history for context.
 */
async function processCustomerMessage(customerMessage, menu, currentCart = [], chatHistory = []) {
  try {
    const client = getAnthropicClient();

    const formattedMenu = menu.map(item => ({
      id: item.id,
      name: item.name,
      price: item.price,
      description: item.description,
      category: item.category_name,
      is_active: item.is_active
    }));

    const systemPrompt = `You are a friendly, efficient AI Restaurant Waiter for a restaurant.
Your job is to assist the customer in ordering, answer questions about the menu, and maintain their shopping cart (the "items" list).

Here is the current active Menu of the restaurant:
${JSON.stringify(formattedMenu, null, 2)}

Instructions:
1. Parse the customer's input message in the context of the current cart and the chat history.
2. The user might want to add items, remove items, clear the cart, change quantities, or specify customizations (e.g. "Less Spicy", "Extra Cheese", "no onions").
3. Always match items mentioned by the customer to items in the Menu. Match as closely as possible. If an item is not on the menu, explain that it's unavailable in your response, and do not add it to the cart.
4. Keep track of the cart. Each item in the cart MUST have:
   - "menu_item_id": the integer ID of the item from the Menu.
   - "name": the exact name of the item from the Menu.
   - "price": the decimal price of the item from the Menu.
   - "quantity": the integer quantity. If they say "add a coke" when they already have 2, update quantity to 3. If they say "remove a coke", update quantity to 1. If quantity becomes 0, remove the item.
   - "customizations": an array of strings representing preferences or additions (e.g., ["Less Spicy", "Extra Cheese"]).
5. If the customer is asking a question (e.g. "Is the Paneer Tikka spicy?" or "What beverages do you have?"), answer it friendly in the "assistantResponse" and leave the "items" list unchanged.
6. Speak naturally. You can respond in English, Hindi, or a mix of both (Hinglish) depending on how the customer speaks. Keep replies polite, short, and welcoming.
7. Return your response in STRICT JSON format matching the schema below. Do not include any markdown, explanation or text outside the JSON block.

JSON Schema to return:
{
  "items": [
    {
      "menu_item_id": 1,
      "name": "Paneer Tikka",
      "price": 250.00,
      "quantity": 1,
      "customizations": ["Less Spicy", "Extra Cheese"]
    }
  ],
  "assistantResponse": "Sure! I have added one Paneer Tikka with less spicy and extra cheese to your cart. Anything else you'd like?"
}`;

    const userMessageContent = `
Current Cart: ${JSON.stringify(currentCart)}
Recent Chat History: ${JSON.stringify(chatHistory.slice(-6))}
Customer Message: "${customerMessage}"
`;

    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1500,
      temperature: 0.1,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userMessageContent
        }
      ]
    });

    const responseText = response.content[0].text.trim();
    
    // Attempt to extract JSON from response text (just in case Claude wraps it in ```json ... ```)
    let jsonString = responseText;
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonString = jsonMatch[1];
    }

    const result = JSON.parse(jsonString);
    return result;
  } catch (error) {
    console.error('Error in Claude AI Service:', error);
    // Return standard fallback response in case of API failure
    return {
      items: currentCart,
      assistantResponse: "Sorry, I'm having trouble understanding right now. Please try again, or ask a waiter for assistance."
    };
  }
}

module.exports = {
  processCustomerMessage
};
