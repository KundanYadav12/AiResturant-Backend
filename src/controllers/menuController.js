const Menu = require('../models/Menu');
const Table = require('../models/Table');
const Knowledge = require('../models/Knowledge');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Configure Multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only images are allowed!'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

exports.uploadImage = upload.single('image');

// --- Public Token-Based Categories and Menu Items (No Raw IDs) ---
exports.getCategoriesByToken = async (req, res) => {
  const { tableToken } = req.params;
  try {
    const table = await Table.findByToken(tableToken);
    if (!table) {
      return res.status(404).json({ error: 'Table or QR code is invalid' });
    }
    const categories = await Menu.getCategoriesByRestaurant(table.restaurant_id);
    res.json(categories);
  } catch (error) {
    console.error('Get categories by token error:', error);
    res.status(500).json({ error: 'Failed to retrieve categories' });
  }
};

exports.getMenuItemsByToken = async (req, res) => {
  const { tableToken } = req.params;
  try {
    const table = await Table.findByToken(tableToken);
    if (!table) {
      return res.status(404).json({ error: 'Table or QR code is invalid' });
    }
    // Fetch only active items for customers
    const items = await Menu.getMenuItemsByRestaurant(table.restaurant_id, false);
    res.json(items);
  } catch (error) {
    console.error('Get menu items by token error:', error);
    res.status(500).json({ error: 'Failed to retrieve menu items' });
  }
};

// --- Category Handlers ---
exports.getCategories = async (req, res) => {
  const restaurantId = req.params.restaurantId || req.user?.restaurantId;

  if (!restaurantId) {
    return res.status(400).json({ error: 'Restaurant ID is required' });
  }

  try {
    const categories = await Menu.getCategoriesByRestaurant(restaurantId);
    res.json(categories);
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Failed to retrieve categories' });
  }
};

exports.createCategory = async (req, res) => {
  const { name } = req.body;
  const restaurantId = req.user.restaurantId;

  if (!name) {
    return res.status(400).json({ error: 'Category name is required' });
  }

  try {
    const category = await Menu.createCategory({ restaurantId, name });
    res.status(201).json(category);
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
};

exports.updateCategory = async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Category name is required' });
  }

  try {
    const category = await Menu.updateCategory(id, { name });
    res.json(category);
  } catch (error) {
    console.error('Update category error:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
};

exports.deleteCategory = async (req, res) => {
  const { id } = req.params;

  try {
    const success = await Menu.deleteCategory(id);
    if (!success) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Delete category error:', error);
    if (error.message.includes('contains menu items')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to delete category' });
  }
};

// --- Menu Item Handlers ---
exports.getMenuItems = async (req, res) => {
  const restaurantId = req.params.restaurantId || req.user?.restaurantId;
  const includeInactive = req.query.includeInactive === 'true';

  if (!restaurantId) {
    return res.status(400).json({ error: 'Restaurant ID is required' });
  }

  try {
    const items = await Menu.getMenuItemsByRestaurant(restaurantId, includeInactive);
    res.json(items);
  } catch (error) {
    console.error('Get menu items error:', error);
    res.status(500).json({ error: 'Failed to retrieve menu items' });
  }
};

exports.createMenuItem = async (req, res) => {
  const { categoryId, name, description, price, isActive, isVeg } = req.body;
  const restaurantId = req.user.restaurantId;

  if (!categoryId || !name || !price) {
    return res.status(400).json({ error: 'Category ID, name, and price are required' });
  }

  const image = req.file ? `/api/uploads/${req.file.filename}` : null;

  try {
    const item = await Menu.createMenuItem({
      restaurantId,
      categoryId,
      name,
      description: description || '',
      price: parseFloat(price),
      image,
      isActive: isActive === undefined ? true : isActive === 'true' || isActive === true,
      isVeg: isVeg === undefined ? true : isVeg === 'true' || isVeg === true
    });
    res.status(201).json(item);
  } catch (error) {
    console.error('Create menu item error:', error);
    res.status(500).json({ error: 'Failed to create menu item' });
  }
};

exports.updateMenuItem = async (req, res) => {
  const { id } = req.params;
  const { categoryId, name, description, price, isActive, isVeg } = req.body;

  if (!categoryId || !name || !price) {
    return res.status(400).json({ error: 'Category ID, name, and price are required' });
  }

  const image = req.file ? `/api/uploads/${req.file.filename}` : undefined;

  try {
    const oldItem = await Menu.getMenuItemById(id);
    if (image && oldItem && oldItem.image) {
      const filename = path.basename(oldItem.image);
      const oldPath = path.join(__dirname, '../../uploads', filename);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    const item = await Menu.updateMenuItem(id, {
      categoryId,
      name,
      description: description || '',
      price: parseFloat(price),
      image,
      isActive: isActive === 'true' || isActive === true,
      isVeg: isVeg === 'true' || isVeg === true
    });
    res.json(item);
  } catch (error) {
    console.error('Update menu item error:', error);
    res.status(500).json({ error: 'Failed to update menu item' });
  }
};

exports.deleteMenuItem = async (req, res) => {
  const { id } = req.params;

  try {
    const oldItem = await Menu.getMenuItemById(id);
    if (oldItem && oldItem.image) {
      const oldPath = path.join(__dirname, '../../', oldItem.image);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    const success = await Menu.deleteMenuItem(id);
    if (!success) {
      return res.status(404).json({ error: 'Menu item not found' });
    }
    res.json({ message: 'Menu item deleted successfully' });
  } catch (error) {
    console.error('Delete menu item error:', error);
    res.status(500).json({ error: 'Failed to delete menu item' });
  }
};

// --- Ingredients & Allergens Handlers ---
exports.getIngredients = async (req, res) => {
  try {
    const data = await Knowledge.getIngredients(req.user.restaurantId);
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to get ingredients' });
  }
};

exports.createIngredient = async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const data = await Knowledge.createIngredient(req.user.restaurantId, name);
    res.status(201).json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create ingredient' });
  }
};

exports.deleteIngredient = async (req, res) => {
  try {
    await Knowledge.deleteIngredient(req.params.id);
    res.json({ message: 'Ingredient deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete ingredient' });
  }
};

exports.getMenuItemIngredients = async (req, res) => {
  try {
    const data = await Knowledge.getMenuItemIngredients(req.params.id);
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to get menu item ingredients' });
  }
};

exports.linkMenuItemIngredients = async (req, res) => {
  const { links } = req.body; // array of { ingredientId, isAllergen }
  if (!Array.isArray(links)) return res.status(400).json({ error: 'Links array required' });
  try {
    await Knowledge.linkMenuItemIngredients(req.params.id, links);
    res.json({ message: 'Ingredients updated successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to link ingredients' });
  }
};

// --- Customizations Handlers ---
exports.getMenuItemCustomizations = async (req, res) => {
  try {
    const data = await Knowledge.getCustomizationsByMenuItem(req.params.id);
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to get customizations' });
  }
};

exports.createMenuItemCustomization = async (req, res) => {
  const { name, price } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const data = await Knowledge.createCustomization(req.params.id, name, parseFloat(price || 0));
    res.status(201).json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create customization' });
  }
};

exports.deleteMenuItemCustomization = async (req, res) => {
  try {
    await Knowledge.deleteCustomization(req.params.id);
    res.json({ message: 'Customization deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete customization' });
  }
};

// --- FAQ Handlers ---
exports.getFAQs = async (req, res) => {
  try {
    const data = await Knowledge.getFAQs(req.user.restaurantId);
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to get FAQs' });
  }
};

exports.createFAQ = async (req, res) => {
  const { question, answer } = req.body;
  if (!question || !answer) return res.status(400).json({ error: 'Question and answer required' });
  try {
    const data = await Knowledge.createFAQ(req.user.restaurantId, question, answer);
    res.status(201).json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create FAQ' });
  }
};

exports.updateFAQ = async (req, res) => {
  const { question, answer } = req.body;
  try {
    const data = await Knowledge.updateFAQ(req.params.id, question, answer);
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update FAQ' });
  }
};

exports.deleteFAQ = async (req, res) => {
  try {
    await Knowledge.deleteFAQ(req.params.id);
    res.json({ message: 'FAQ deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete FAQ' });
  }
};

// --- General AI Knowledge Handlers ---
exports.getGeneralKnowledge = async (req, res) => {
  try {
    const data = await Knowledge.getGeneralKnowledge(req.user.restaurantId);
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to get knowledge content' });
  }
};

exports.saveGeneralKnowledge = async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Content is required' });
  try {
    const data = await Knowledge.saveGeneralKnowledge(req.user.restaurantId, content);
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to save knowledge content' });
  }
};

// --- Reorder Categories and Menu Items Handlers ---
exports.reorderCategories = async (req, res) => {
  const { rankings } = req.body;
  if (!Array.isArray(rankings)) {
    return res.status(400).json({ error: 'Rankings array is required' });
  }
  try {
    await Menu.updateCategoryRankings(rankings);
    res.json({ message: 'Categories reordered successfully' });
  } catch (error) {
    console.error('Reorder categories error:', error);
    res.status(500).json({ error: 'Failed to reorder categories' });
  }
};

exports.reorderMenuItems = async (req, res) => {
  const { rankings } = req.body;
  if (!Array.isArray(rankings)) {
    return res.status(400).json({ error: 'Rankings array is required' });
  }
  try {
    await Menu.updateMenuItemRankings(rankings);
    res.json({ message: 'Menu items reordered successfully' });
  } catch (error) {
    console.error('Reorder menu items error:', error);
    res.status(500).json({ error: 'Failed to reorder menu items' });
  }
};

// --- AI Menu Scanner Handlers ---

const scanStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'scan-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const uploadScan = multer({
  storage: scanStorage,
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|webp|pdf/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype) || file.mimetype === 'application/pdf';

    if (mimetype || extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only images and PDF files are allowed!'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

exports.uploadScanFile = uploadScan.single('menuFile');

function getSupportedMimeType(file) {
  let mime = (file.mimetype || '').toLowerCase();
  const ext = path.extname(file.originalname).toLowerCase();

  if (mime === 'image/jpg' || ext === '.jpg' || ext === '.jpeg') {
    return 'image/jpeg';
  }
  if (ext === '.png' || mime === 'image/png') {
    return 'image/png';
  }
  if (ext === '.webp' || mime === 'image/webp') {
    return 'image/webp';
  }
  if (ext === '.pdf' || mime === 'application/pdf') {
    return 'application/pdf';
  }
  return mime || 'image/jpeg';
}

function fileToGenerativePart(buffer, file) {
  const mimeType = getSupportedMimeType(file);
  return {
    inlineData: {
      data: buffer.toString('base64'),
      mimeType
    }
  };
}

exports.importMenuImage = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No menu file uploaded' });
  }

  const restaurantId = req.user.restaurantId;

  try {
    const { getGeminiKey } = require('../utils/aiKeys');
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    
    // Resolve Gemini key
    const apiKey = await getGeminiKey(restaurantId);
    if (!apiKey) {
      return res.status(400).json({ error: 'Gemini API key is not configured.' });
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    const filePath = path.join(__dirname, '../../uploads', req.file.filename);
    const fileBuffer = fs.readFileSync(filePath);
    const filePart = fileToGenerativePart(fileBuffer, req.file);

    const prompt = `
      Analyze this restaurant menu (it could be an image or a PDF).
      Extract all categories and their respective items.
      For each item, extract:
      - Name
      - Price (as a decimal number, default to 0 if not visible)
      - Description (brief summary, keep it empty if not visible)
      - isVeg (boolean: true if it is vegetarian, false if it is non-vegetarian or not specified. Assume true only if there is a green dot, leaf, or it explicitly says veg/vegetarian).
      - customizations: extract optional customizations/add-ons/sizes with prices if visible (e.g. Small/Large size, Extra Cheese).
      
      Also, identify if the uploaded file represents a photo of a specific single dish rather than a full menu card:
      - set "does_contain_item_image" to true if this image represents a photo of a single specific dish that we can associate as the item's main image.
      - set "image_matching_item" to the exact name of the item it represents (only if does_contain_item_image is true).
      
      Rules:
      - Ignore decorative text, logos, contact info, headers, footers, GST/tax info.
      - Output strictly clean, valid JSON matching the schema below.
      - Do not wrap the JSON output in markdown code fences or backticks.
      
      Output JSON format:
      {
        "does_contain_item_image": false,
        "image_matching_item": null,
        "categories": [
          {
            "name": "Category Name",
            "items": [
              {
                "name": "Item Name",
                "price": 250,
                "description": "Item Description",
                "isVeg": true,
                "customizations": [
                  { "name": "Extra Cheese", "price": 50 }
                ]
              }
            ]
          }
        ]
      }
    `;

    const modelsToTry = ['gemini-2.5-flash', 'gemini-flash-latest'];
    let responseText = null;
    let lastErr = null;

    for (const modelName of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent([prompt, filePart]);
        responseText = result.response.text();
        console.log(`[Menu Scanner] ✅ Successfully scanned menu using model "${modelName}"`);
        break;
      } catch (err) {
        lastErr = err;
        console.warn(`[Menu Scanner] ⚠️ Model "${modelName}" failed during scan: ${err.message || err}`);
      }
    }

    if (!responseText) {
      throw lastErr || new Error('All Gemini models failed to process the menu scanner file.');
    }

    const { cleanAndParseJSON } = require('../services/aiService');
    const parsed = cleanAndParseJSON(responseText);

    res.json({
      success: true,
      data: parsed,
      uploadedFilePath: `/api/uploads/${req.file.filename}`
    });
  } catch (error) {
    console.error('[Menu Scanner] Error scanning menu:', error);
    try {
      const filePath = path.join(__dirname, '../../uploads', req.file.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (cleanupErr) {
      console.error('[Menu Scanner] Cleanup error:', cleanupErr);
    }
    res.status(500).json({ error: error.message || 'Failed to analyze menu using AI.' });
  }
};

exports.confirmImportMenu = async (req, res) => {
  const { categories, doesContainItemImage, imageMatchingItem, uploadedFilePath } = req.body;
  const restaurantId = req.user.restaurantId;
  const ids = require('../utils/idGenerator');
  const db = require('../config/database');

  if (!categories || !Array.isArray(categories)) {
    return res.status(400).json({ error: 'Categories list is required' });
  }

  try {
    for (const cat of categories) {
      if (!cat.name || !cat.items || !Array.isArray(cat.items)) continue;

      let categoryId;
      const [existingCat] = await db.query(
        'SELECT id FROM categories WHERE restaurant_id = ? AND name = ?',
        [restaurantId, cat.name]
      );

      if (existingCat.length > 0) {
        categoryId = existingCat[0].id;
      } else {
        const catId = ids.categoryId();
        const [maxRank] = await db.query('SELECT MAX(rank_order) as max_rank FROM categories WHERE restaurant_id = ?', [restaurantId]);
        const nextRank = (maxRank[0].max_rank || 0) + 1;
        await db.query(
          'INSERT INTO categories (id, restaurant_id, name, rank_order) VALUES (?, ?, ?, ?)',
          [catId, restaurantId, cat.name, nextRank]
        );
        categoryId = catId;
      }

      for (const item of cat.items) {
        if (!item.name) continue;

        const [existingItem] = await db.query(
          'SELECT id FROM menu_items WHERE category_id = ? AND name = ?',
          [categoryId, item.name]
        );

        if (existingItem.length > 0) {
          continue;
        }

        let itemImagePath = null;
        if (doesContainItemImage && imageMatchingItem && item.name.toLowerCase().trim() === imageMatchingItem.toLowerCase().trim()) {
          itemImagePath = uploadedFilePath || null;
        }

        const itemId = ids.menuItemId();
        const [maxRank] = await db.query('SELECT MAX(rank_order) as max_rank FROM menu_items WHERE category_id = ?', [categoryId]);
        const nextRank = (maxRank[0].max_rank || 0) + 1;

        await db.query(
          `INSERT INTO menu_items (id, restaurant_id, category_id, name, description, price, image, is_active, rank_order, is_veg) 
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [
            itemId,
            restaurantId,
            categoryId,
            item.name,
            item.description || '',
            parseFloat(item.price) || 0,
            itemImagePath,
            nextRank,
            item.isVeg === true || item.isVeg === 1 ? 1 : 0
          ]
        );

        if (item.customizations && Array.isArray(item.customizations)) {
          for (const cust of item.customizations) {
            if (!cust.name) continue;
            const custId = ids.customizationId();
            await db.query(
              `INSERT INTO menu_item_customizations (id, menu_item_id, name, price) 
               VALUES (?, ?, ?, ?)`,
              [
                custId,
                itemId,
                cust.name,
                parseFloat(cust.price) || 0
              ]
            );
          }
        }
      }
    }

    res.json({ success: true, message: 'Menu imported successfully!' });
  } catch (error) {
    console.error('[Menu Scanner] Error confirming import:', error);
    res.status(500).json({ error: 'Failed to import menu.' });
  }
};

exports.getStaff = async (req, res) => {
  const restaurantId = req.user.restaurantId;
  const db = require('../config/database');
  try {
    const [rows] = await db.query(
      'SELECT id, name, email, role, last_login, created_at FROM users WHERE restaurant_id = ? AND role = "MANAGER"',
      [restaurantId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching staff:', err);
    res.status(500).json({ error: 'Failed to fetch staff' });
  }
};

exports.deleteStaff = async (req, res) => {
  const restaurantId = req.user.restaurantId;
  const { id } = req.params;
  const db = require('../config/database');
  try {
    const [result] = await db.query(
      'DELETE FROM users WHERE id = ? AND restaurant_id = ? AND role = "MANAGER"',
      [id, restaurantId]
    );
    if (result.affectedRows > 0) {
      res.json({ success: true, message: 'Staff member deleted successfully' });
    } else {
      res.status(404).json({ error: 'Staff member not found' });
    }
  } catch (err) {
    console.error('Error deleting staff:', err);
    res.status(500).json({ error: 'Failed to delete staff' });
  }
};
