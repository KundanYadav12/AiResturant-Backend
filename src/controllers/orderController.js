const Order = require('../models/Order');
const Menu = require('../models/Menu');
const Table = require('../models/Table');
const Knowledge = require('../models/Knowledge');
const aiService = require('../services/aiService');
const socketService = require('../services/socketService');
const db = require('../config/database');

// Helper to check if a restaurant's subscription is active
async function checkSubscription(restaurantId) {
  const [rows] = await db.query(
    'SELECT status, subscription_expires_at FROM restaurants WHERE id = ?',
    [restaurantId]
  );
  if (rows.length === 0) return { active: false, reason: 'Restaurant not found' };
  
  const rest = rows[0];
  if (rest.status === 'SUSPENDED') {
    return { active: false, reason: 'This restaurant service has been suspended by the platform administrator.' };
  }
  if (rest.status === 'EXPIRED') {
    return { active: false, reason: 'This restaurant subscription has expired.' };
  }
  if (rest.subscription_expires_at) {
    const expiry = new Date(rest.subscription_expires_at);
    if (expiry < new Date()) {
      // Update DB to EXPIRED
      await db.query("UPDATE restaurants SET status = 'EXPIRED' WHERE id = ?", [restaurantId]);
      return { active: false, reason: 'This restaurant subscription has expired.' };
    }
  }
  return { active: true };
}

exports.createOrder = async (req, res) => {
  const { tableToken, totalAmount, notes, items } = req.body;

  try {
    if (!tableToken || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Table Token and order items are required' });
    }

    // 1. Resolve table and restaurant by token
    const table = await Table.findByToken(tableToken);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    // 2. Check SaaS subscription
    const subCheck = await checkSubscription(table.restaurant_id);
    if (!subCheck.active) {
      return res.status(403).json({ error: subCheck.reason });
    }

    // 3. Create the order
    const orderId = await Order.create({
      restaurantId: table.restaurant_id,
      tableId: table.id,
      totalAmount,
      notes,
      items
    });

    // 4. Update table status to PREPARING_ORDER
    await Table.updateStatus(table.id, 'PREPARING_ORDER');

    // 5. Fetch full order details
    const completeOrder = await Order.findById(orderId);

    // 6. Notify managers
    socketService.emitNewOrder(table.restaurant_id, completeOrder);
    
    // Also notify of table status update
    socketService.emitTableRequest(table.restaurant_id, {
      tableId: table.id,
      tableNumber: table.table_number,
      status: 'PREPARING_ORDER'
    });

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

    const updatedOrder = await Order.findById(id);

    // Update table status in database if delivered
    let tableStatus = 'OCCUPIED';
    if (status === 'DELIVERED') {
      tableStatus = 'FREE';
      await Table.updateStatus(updatedOrder.table_id, 'FREE');
    } else if (status === 'PREPARING') {
      tableStatus = 'PREPARING_ORDER';
      await Table.updateStatus(updatedOrder.table_id, 'PREPARING_ORDER');
    }

    // Emit real-time updates
    socketService.emitOrderStatusUpdate(id, updatedOrder, `ORDER_${status}`);
    socketService.emitNewOrder(updatedOrder.restaurant_id, updatedOrder);
    
    // Notify table status change
    socketService.emitTableRequest(updatedOrder.restaurant_id, {
      tableId: updatedOrder.table_id,
      tableNumber: updatedOrder.table_number,
      status: tableStatus
    });

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
  const { tableToken, message, cart, chatHistory } = req.body;

  if (!tableToken || !message) {
    return res.status(400).json({ error: 'Table token and customer message are required' });
  }

  try {
    // 1. Resolve table/restaurant
    const table = await Table.findByToken(tableToken);
    if (!table) {
      return res.status(404).json({ error: 'Table or QR code is invalid' });
    }

    // 2. Check SaaS subscription status
    const subCheck = await checkSubscription(table.restaurant_id);
    if (!subCheck.active) {
      return res.json({
        items: cart || [],
        assistantResponse: `Sorry, this service is currently unavailable. ${subCheck.reason}`
      });
    }

    // 3. Process AI Waiter message
    const parsedResult = await aiService.processCustomerMessage(
      table.restaurant_id,
      message,
      cart || [],
      chatHistory || []
    );

    res.json(parsedResult);
  } catch (error) {
    console.error('AI Chat controller error:', error);
    res.status(500).json({ error: 'Failed to process AI message' });
  }
};

// Fetch table info by secure token (publicly accessible)
exports.getTableDetailsByToken = async (req, res) => {
  const { tableToken } = req.params;

  try {
    const table = await Table.findByToken(tableToken);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    // Check SaaS subscription status
    const subCheck = await checkSubscription(table.restaurant_id);
    if (!subCheck.active) {
      return res.status(403).json({ error: subCheck.reason });
    }

    // Mask numeric IDs from public details
    res.json({
      table_token: table.table_token,
      table_number: table.table_number,
      restaurant_name: table.restaurant_name,
      status: table.status
    });
  } catch (error) {
    console.error('Get table details by token error:', error);
    res.status(500).json({ error: 'Failed to retrieve table details' });
  }
};

// Call waiter / Request water / Request bill
exports.createTableRequest = async (req, res) => {
  const { tableToken } = req.params;
  const { requestType } = req.body; // 'WAITER', 'WATER', 'BILL'

  const validTypes = ['WAITER', 'WATER', 'BILL'];
  if (!validTypes.includes(requestType)) {
    return res.status(400).json({ error: 'Invalid request type' });
  }

  try {
    const table = await Table.findByToken(tableToken);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    // Check SaaS subscription
    const subCheck = await checkSubscription(table.restaurant_id);
    if (!subCheck.active) {
      return res.status(403).json({ error: subCheck.reason });
    }

    const request = await Knowledge.createTableRequest(table.restaurant_id, table.id, requestType);
    
    // Add table number to broadcast payload
    request.table_number = table.table_number;

    // Real-time socket broadcast
    socketService.emitTableRequest(table.restaurant_id, request);

    res.status(201).json({
      message: 'Request logged successfully',
      request
    });
  } catch (error) {
    console.error('Create table request error:', error);
    res.status(500).json({ error: 'Failed to create request' });
  }
};

// --- Manager Protected Endpoints for Requests ---
exports.getPendingRequests = async (req, res) => {
  const restaurantId = req.user.restaurantId;
  try {
    const requests = await Knowledge.getPendingTableRequests(restaurantId);
    res.json(requests);
  } catch (error) {
    console.error('Get pending requests error:', error);
    res.status(500).json({ error: 'Failed to fetch table requests' });
  }
};

exports.completeRequest = async (req, res) => {
  const { requestId } = req.params;
  const { tableId } = req.body;

  try {
    await Knowledge.completeTableRequest(requestId, tableId);
    
    // Retrieve table number
    const table = await Table.findById(tableId);

    // Notify of table status refresh
    socketService.emitTableRequest(req.user.restaurantId, {
      tableId,
      table_number: table ? table.table_number : '',
      status: 'FREE'
    });

    res.json({ message: 'Request resolved successfully' });
  } catch (error) {
    console.error('Complete request error:', error);
    res.status(500).json({ error: 'Failed to resolve request' });
  }
};

exports.getTableStatuses = async (req, res) => {
  const restaurantId = req.user.restaurantId;
  try {
    const tables = await Table.findByRestaurantId(restaurantId);
    res.json(tables);
  } catch (error) {
    console.error('Get table statuses error:', error);
    res.status(500).json({ error: 'Failed to retrieve table statuses' });
  }
};
