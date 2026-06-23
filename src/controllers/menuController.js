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
  const { categoryId, name, description, price, isActive } = req.body;
  const restaurantId = req.user.restaurantId;

  if (!categoryId || !name || !price) {
    return res.status(400).json({ error: 'Category ID, name, and price are required' });
  }

  const image = req.file ? `/uploads/${req.file.filename}` : null;

  try {
    const item = await Menu.createMenuItem({
      restaurantId,
      categoryId,
      name,
      description: description || '',
      price: parseFloat(price),
      image,
      isActive: isActive === undefined ? true : isActive === 'true' || isActive === true
    });
    res.status(201).json(item);
  } catch (error) {
    console.error('Create menu item error:', error);
    res.status(500).json({ error: 'Failed to create menu item' });
  }
};

exports.updateMenuItem = async (req, res) => {
  const { id } = req.params;
  const { categoryId, name, description, price, isActive } = req.body;

  if (!categoryId || !name || !price) {
    return res.status(400).json({ error: 'Category ID, name, and price are required' });
  }

  const image = req.file ? `/uploads/${req.file.filename}` : undefined;

  try {
    const oldItem = await Menu.getMenuItemById(id);
    if (image && oldItem && oldItem.image) {
      const oldPath = path.join(__dirname, '../../', oldItem.image);
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
      isActive: isActive === 'true' || isActive === true
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
