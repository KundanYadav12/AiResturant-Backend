// src/utils/idGenerator.js
// Generates secure prefixed IDs for all entities using Node.js built-in crypto.
// No external packages needed.
const crypto = require('crypto');

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function generateId(prefix, length = 16) {
  const bytes = crypto.randomBytes(length);
  let id = prefix + '_';
  for (let i = 0; i < length; i++) {
    id += CHARS[bytes[i] % CHARS.length];
  }
  return id;
}

module.exports = {
  restaurantId:          () => generateId('rst'),
  userId:                () => generateId('usr'),
  tableId:               () => generateId('tbl'),
  categoryId:            () => generateId('cat'),
  menuItemId:            () => generateId('itm'),
  ingredientId:          () => generateId('ing'),
  customizationId:       () => generateId('cst'),
  faqId:                 () => generateId('faq'),
  knowledgeId:           () => generateId('knw'),
  tableRequestId:        () => generateId('trq'),
  orderId:               () => generateId('ord'),
  orderItemId:           () => generateId('ori'),
  orderCustomizationId:  () => generateId('orc'),
  auditId:               () => generateId('aud'),
  aiUsageId:             () => generateId('aiu'),
};
