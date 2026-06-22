const Order = require('../models/Order');
const Menu = require('../models/Menu');
const Restaurant = require('../models/Restaurant');
const Table = require('../models/Table');
const aiService = require('../services/aiService');
const socketService = require('../services/socketService');

exports.createOrder = async (req, res) => {
  const { restaurantId, tableId, totalAmount, notes, items } = req.body;

  try {
    if (!restaurantId || !tableId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Restaurant ID, Table ID, and order items are required' });
    }

    // Insert order in database (via transaction)
    const orderId = await Order.create({
      restaurantId,
      tableId,
      totalAmount,
      notes,
      items
    });

    // Fetch the complete order with join tables to broadcast
    const completeOrder = await Order.findById(orderId);

    // Emit real-time socket event to the manager dashboard
    socketService.emitNewOrder(restaurantId, completeOrder);

    res.status(201).json({
      message: 'Order placed successfully',
      order: completeOrder
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Failed to place order' });
  }
};

exports.getOrders = async (req, res) => {
  const restaurantId = req.user.restaurantId;

  try {
    const orders = await Order.findByRestaurantId(restaurantId);
    res.json(orders);
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Failed to retrieve orders' });
  }
};

exports.getOrderById = async (req, res) => {
  const { id } = req.params;

  try {
    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(order);
  } catch (error) {
    console.error('Get order by ID error:', error);
    res.status(500).json({ error: 'Failed to retrieve order' });
  }
};

exports.updateOrderStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ['PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERED', 'REJECTED'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid order status' });
  }

  try {
    const success = await Order.updateStatus(id, status);
    if (!success) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Fetch updated order
    const updatedOrder = await Order.findById(id);

    // Emit real-time update to the customer/order tracking page
    socketService.emitOrderStatusUpdate(id, updatedOrder);
    
    // Also notify other managers in case multiple dashboards are open
    socketService.emitNewOrder(updatedOrder.restaurant_id, updatedOrder);

    res.json({
      message: 'Order status updated successfully',
      order: updatedOrder
    });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ error: 'Failed to update order status' });
  }
};

// AI Ordering parser endpoint
exports.chatWithAI = async (req, res) => {
  const { restaurantId, message, cart, chatHistory } = req.body;

  if (!restaurantId || !message) {
    return res.status(400).json({ error: 'Restaurant ID and customer message are required' });
  }

  try {
    // 1. Fetch menu items for this restaurant
    const menu = await Menu.getMenuItemsByRestaurant(restaurantId, false);

    // 2. Call AI service to parse ordering instructions
    const parsedResult = await aiService.processCustomerMessage(
      message,
      menu,
      cart || [],
      chatHistory || []
    );

    res.json(parsedResult);
  } catch (error) {
    console.error('AI Chat controller error:', error);
    res.status(500).json({ error: 'Failed to parse AI message' });
  }
};

// Public route to fetch table info (used on initial QR scan)
exports.getTableDetails = async (req, res) => {
  const { tableId } = req.params;

  try {
    const table = await Table.findById(tableId);
    if (!table) {
      return res.status(404).json({ error: 'Table or Restaurant not found' });
    }
    res.json(table);
  } catch (error) {
    console.error('Get table details error:', error);
    res.status(500).json({ error: 'Failed to retrieve table information' });
  }
};
