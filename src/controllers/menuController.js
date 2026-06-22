const Menu = require('../models/Menu');
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
    // If there's a new image and the old item had one, we could delete it here
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
