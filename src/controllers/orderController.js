const Order = require('../models/Order');
const Menu = require('../models/Menu');
const Table = require('../models/Table');
const Knowledge = require('../models/Knowledge');
const aiService = require('../services/aiService');
const socketService = require('../services/socketService');
const Restaurant = require('../models/Restaurant');
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

  try {
    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const restaurantId = order.restaurant_id;

    // Fetch active custom stages
    const [stages] = await db.query(
      'SELECT name FROM restaurant_order_stages WHERE restaurant_id = ? AND is_active = TRUE ORDER BY rank_order ASC',
      [restaurantId]
    );
    const validCustomStatuses = stages.map(s => s.name.toUpperCase());
    const systemStatuses = ['PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERED', 'REJECTED', 'CANCELLED'];
    const allValid = new Set([...validCustomStatuses, ...systemStatuses]);

    if (!allValid.has(status.toUpperCase())) {
      return res.status(400).json({ error: 'Invalid order status: ' + status });
    }

    const success = await Order.updateStatus(id, status);
    if (!success) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const updatedOrder = await Order.findById(id);

    // Update table status dynamically
    const finalStageName = stages.length > 0 ? stages[stages.length - 1].name : 'Delivered';
    const firstStageName = stages.length > 0 ? stages[0].name : 'Order Received';

    const statusLower = status.toLowerCase();
    if (statusLower === finalStageName.toLowerCase() || statusLower === 'delivered') {
      await Table.updateStatus(updatedOrder.table_id, 'FREE');
    } else if (statusLower !== firstStageName.toLowerCase() && statusLower !== 'pending' && statusLower !== 'rejected' && statusLower !== 'cancelled') {
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

    // Return table info + restaurant voice config for the customer UI
    res.json({
      table_token: table.table_token,
      table_number: table.table_number,
      restaurant_name: table.restaurant_name,
      status: table.status,
      // Voice configuration (from restaurant settings)
      ai_waiter_enabled: table.ai_waiter_enabled !== false,
      voice_interaction_enabled: table.voice_interaction_enabled !== false,
      continuous_voice_enabled: table.continuous_voice_enabled !== false,
      greeting_message: table.greeting_message || '',
      voice_language: table.voice_language || 'en-IN',
      voice_gender: table.voice_gender || 'female',
      voice_speed: parseFloat(table.voice_speed) || 1.0,
      auto_listening_timeout: parseInt(table.auto_listening_timeout) || 5,
      wake_word: table.wake_word || ''
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

exports.downloadReceipt = async (req, res) => {
  const { id } = req.params;
  const { print } = req.query;

  try {
    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).send('Order not found');
    }

    const restaurant = await Restaurant.findById(order.restaurant_id);
    if (!restaurant) {
      return res.status(404).send('Restaurant not found');
    }

    const items = order.items || [];
    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const taxRate = parseFloat(restaurant.tax_settings || 5.00);
    const taxAmount = subtotal * (taxRate / 100);
    const grandTotal = subtotal + taxAmount;
    const currency = restaurant.currency_symbol || '₹';
    const themeColor = restaurant.theme_color || '#0d6efd';

    const formattedDate = new Date(order.created_at).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    const formattedTime = new Date(order.created_at).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit'
    });

    const displayId = order.display_id && String(order.display_id).toLowerCase() !== 'null'
      ? order.display_id
      : '#' + order.id.slice(-6);

    const displayTableNumber = String(order.table_number).toLowerCase().startsWith('table')
      ? order.table_number
      : `Table ${order.table_number}`;

    const receiptHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Order Receipt ${displayId}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&family=Outfit:wght@400;600;800&display=swap');
    
    * {
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Outfit', sans-serif;
      margin: 0;
      padding: 40px 20px;
      background-color: #f1f3f5;
      color: #212529;
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }
    
    .receipt-container {
      width: 100%;
      max-width: 420px;
      background: #ffffff;
      padding: 32px 24px;
      border-radius: 12px;
      box-shadow: 0 15px 35px rgba(0, 0, 0, 0.08), 0 5px 15px rgba(0, 0, 0, 0.04);
      border: 1px solid #dee2e6;
    }
    
    .header {
      text-align: center;
      margin-bottom: 20px;
    }
    
    .logo-container img {
      max-width: 70px;
      border-radius: 50%;
      margin-bottom: 8px;
    }
    
    .restaurant-name {
      font-size: 1.4rem;
      font-weight: 800;
      margin: 0 0 4px 0;
      color: ${themeColor};
    }
    
    .restaurant-info {
      font-size: 0.82rem;
      color: #6c757d;
      margin: 2px 0;
    }
    
    .divider {
      border-top: 1px dashed #ced4da;
      margin: 16px 0;
    }
    
    .info-grid {
      display: grid;
      grid-template-columns: auto 1fr;
      column-gap: 16px;
      row-gap: 8px;
      font-size: 0.85rem;
      margin-bottom: 16px;
      align-items: center;
    }
    
    .info-label {
      color: #6c757d;
    }
    
    .info-value {
      font-weight: 600;
      text-align: right;
      word-break: break-word;
      white-space: normal;
    }
    
    .items-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
      margin: 12px 0;
      table-layout: fixed;
    }
    
    .items-table th {
      border-bottom: 2px solid #212529;
      padding: 8px 4px;
      text-align: left;
      color: #495057;
      font-weight: 800;
    }
    
    .items-table td {
      padding: 10px 4px;
      border-bottom: 1px solid #f1f3f5;
      word-wrap: break-word;
      word-break: break-word;
      white-space: normal;
      vertical-align: top;
    }
    
    .text-right {
      text-align: right;
    }
    
    .item-name {
      font-weight: 600;
    }
    
    .item-customs {
      font-size: 0.72rem;
      color: #6c757d;
      margin-top: 2px;
      display: block;
    }
    
    .summary-grid {
      display: grid;
      grid-template-columns: 1fr auto;
      row-gap: 8px;
      font-size: 0.88rem;
      margin-top: 12px;
    }
    
    .summary-value {
      text-align: right;
      font-weight: 600;
    }
    
    .grand-total-row {
      font-size: 1.2rem;
      font-weight: 800;
      color: ${themeColor};
      border-top: 2px solid #212529;
      border-bottom: 2px solid #212529;
      padding: 12px 0;
      margin-top: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .footer {
      text-align: center;
      margin-top: 24px;
      font-size: 0.8rem;
      color: #6c757d;
    }
    
    .footer-msg {
      font-weight: 600;
      color: #495057;
      margin-bottom: 6px;
    }
    
    .brand-tag {
      margin-top: 16px;
      font-size: 0.7rem;
      color: #adb5bd;
    }
    
    @media print {
      body {
        background-color: #ffffff;
        padding: 0;
        margin: 0;
      }
      .receipt-container {
        box-shadow: none;
        border: none;
        padding: 0px;
        max-width: 100%;
        width: 100%;
      }
      .no-print {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div class="receipt-container">
    <div class="header">
      ${restaurant.logo ? `
        <div class="logo-container">
          <img src="${restaurant.logo}" alt="Logo">
        </div>
      ` : ''}
      <h2 class="restaurant-name">${restaurant.name}</h2>
      ${restaurant.address ? `<p class="restaurant-info">${restaurant.address}</p>` : ''}
      ${restaurant.phone ? `<p class="restaurant-info">Phone: ${restaurant.phone}</p>` : ''}
      ${restaurant.gst_number ? `<p class="restaurant-info">GSTIN: ${restaurant.gst_number}</p>` : ''}
      <h3 style="font-size: 1rem; font-weight: 700; color: #495057; margin: 12px 0 0 0; text-transform: uppercase; letter-spacing: 0.05em;">Order Receipt ${displayId}</h3>
    </div>

    <div class="divider"></div>

    <div class="info-grid">
      <span class="info-label">Order Number</span>
      <span class="info-value">${displayId}</span>
      
      <span class="info-label">Table Number</span>
      <span class="info-value">${displayTableNumber}</span>
      
      <span class="info-label">Date & Time</span>
      <span class="info-value">${formattedDate} at ${formattedTime}</span>
      
      <span class="info-label">Status</span>
      <span class="info-value" style="color: ${themeColor};">${order.status}</span>
    </div>

    <div class="divider"></div>

    <table class="items-table">
      <thead>
        <tr>
          <th style="width: 50%;">Item</th>
          <th class="text-right" style="width: 12%;">Qty</th>
          <th class="text-right" style="width: 18%;">Price</th>
          <th class="text-right" style="width: 20%;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(item => `
          <tr>
            <td>
              <span class="item-name">${item.item_name}</span>
              ${item.customizations && item.customizations.length > 0 ? `
                <span class="item-customs">+ ${item.customizations.join(', ')}</span>
              ` : ''}
            </td>
            <td class="text-right">${item.quantity}</td>
            <td class="text-right">${currency}${parseFloat(item.price).toFixed(0)}</td>
            <td class="text-right">${currency}${(item.price * item.quantity).toFixed(0)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="divider"></div>

    <div class="summary-grid">
      <span class="info-label">Subtotal</span>
      <span class="summary-value">${currency}${subtotal.toFixed(0)}</span>
      
      <span class="info-label">GST (${taxRate.toFixed(2)}%)</span>
      <span class="summary-value">${currency}${taxAmount.toFixed(0)}</span>
    </div>
    
    <div class="summary-grid grand-total-row">
      <span>Grand Total</span>
      <span>${currency}${grandTotal.toFixed(0)}</span>
    </div>

    <div class="footer">
      <p class="footer-msg">${restaurant.footer_message || 'Thank you for dining with us!'}</p>
      <p>Have a wonderful day!</p>
      
      <div class="brand-tag">
        Powered by AI Waiter
      </div>
    </div>
  </div>

  ${print === 'true' ? `
    <script>
      window.onload = function() {
        window.print();
        setTimeout(function() {
          window.close();
        }, 300);
      };
    </script>
  ` : ''}
</body>
</html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.send(receiptHtml);

  } catch (error) {
    console.error('Download receipt error:', error);
    res.status(500).send('Failed to generate receipt');
  }
};

exports.appendOrderItems = async (req, res) => {
  const { id } = req.params;
  const { items } = req.body;

  try {
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Order items are required' });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const status = (order.status || '').toUpperCase();
    if (status === 'DELIVERED' || status === 'REJECTED') {
      return res.status(400).json({ error: 'Cannot add items to a completed or rejected order.' });
    }

    const pool = db.getPool ? db.getPool() : db;
    const connection = await pool.getConnection();
    const ids = require('../utils/idGenerator');
    try {
      await connection.beginTransaction();

      for (const item of items) {
        const orderItemId = ids.orderItemId();
        const quantity = parseInt(item.quantity, 10) || 1;
        const price = parseFloat(item.price) || 0;

        await connection.query(
          'INSERT INTO order_items (id, order_id, menu_item_id, item_name, quantity, price) VALUES (?, ?, ?, ?, ?, ?)',
          [orderItemId, id, item.menu_item_id, item.name, quantity, price]
        );

        if (item.customizations && Array.isArray(item.customizations) && item.customizations.length > 0) {
          for (const custom of item.customizations) {
            const customId = ids.orderCustomizationId();
            await connection.query(
              'INSERT INTO order_customizations (id, order_item_id, customization) VALUES (?, ?, ?)',
              [customId, orderItemId, custom]
            );
          }
        }
      }

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    const [orderItems] = await db.query('SELECT * FROM order_items WHERE order_id = ?', [id]);
    const newTotal = orderItems.reduce((sum, item) => sum + (parseFloat(item.price) * parseInt(item.quantity)), 0);

    await db.query(
      'UPDATE orders SET total_amount = ? WHERE id = ?',
      [newTotal, id]
    );

    const completeOrder = await Order.findById(id);

    // Notify customer tracking page
    socketService.emitOrderStatusUpdate(id, completeOrder, 'ORDER_STATUS_UPDATED');

    // Notify restaurant managers
    socketService.emitNewOrder(completeOrder.restaurant_id, completeOrder);

    res.json({
      message: 'Items appended to order successfully',
      order: completeOrder
    });
  } catch (error) {
    console.error('Append order items error:', error);
    res.status(500).json({ error: 'Failed to append items to order' });
  }
};

exports.getOrderHistory = async (req, res) => {
  const restaurantId = req.user.restaurantId;
  const { date, tableNumber, orderId, status } = req.query;

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 15;
  const sortBy = req.query.sortBy || 'created_at';
  const sortOrder = req.query.sortOrder || 'DESC';

  const cleanLimit = Math.min(Math.max(limit, 1), 100);
  const offset = (page - 1) * cleanLimit;

  try {
    const whereClauses = ['o.restaurant_id = ?'];
    const params = [restaurantId];

    if (date && date.trim()) {
      whereClauses.push('DATE(o.created_at) = ?');
      params.push(date.trim());
    }
    if (tableNumber && tableNumber.trim()) {
      whereClauses.push('t.table_number = ?');
      params.push(tableNumber.trim());
    }
    if (orderId && orderId.trim()) {
      whereClauses.push('(o.id LIKE ? OR o.pos_display_id LIKE ? OR o.numeric_display_id LIKE ?)');
      params.push(`%${orderId.trim()}%`, `%${orderId.trim()}%`, `%${orderId.trim()}%`);
    }
    if (status && status.trim()) {
      whereClauses.push('o.status = ?');
      params.push(status.trim());
    } else {
      whereClauses.push("(o.is_archived = TRUE OR o.status IN ('Delivered', 'DELIVERED', 'REJECTED', 'CANCELLED'))");
    }

    // 1. Fetch total count for pagination metadata
    const countSql = `SELECT COUNT(DISTINCT o.id) as total
                      FROM orders o
                      JOIN tables t ON o.table_id = t.id
                      WHERE ${whereClauses.join(' AND ')}`;
    const [[{ total: totalCount }]] = await db.query(countSql, params);

    // 2. Fetch paginated orders listing (utilizing idx_orders_restaurant_created index)
    const allowedSortFields = ['created_at', 'total_amount', 'status'];
    const cleanSortBy = allowedSortFields.includes(sortBy) ? `o.${sortBy}` : 'o.created_at';
    const cleanSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const selectSql = `SELECT o.*, t.table_number, r.order_display_format
                       FROM orders o
                       JOIN tables t ON o.table_id = t.id
                       JOIN restaurants r ON o.restaurant_id = r.id
                       WHERE ${whereClauses.join(' AND ')}
                       ORDER BY ${cleanSortBy} ${cleanSortOrder}
                       LIMIT ? OFFSET ?`;

    const [orders] = await db.query(selectSql, [...params, cleanLimit, offset]);

    // 3. Eager load associated order items & customizations in bulk (Optimized: 2 queries instead of N+1)
    if (orders.length > 0) {
      const orderIds = orders.map(o => o.id);
      const [allItems] = await db.query('SELECT * FROM order_items WHERE order_id IN (?)', [orderIds]);

      if (allItems.length > 0) {
        const itemIds = allItems.map(item => item.id);
        const [allCustoms] = await db.query(
          'SELECT order_item_id, customization FROM order_customizations WHERE order_item_id IN (?)',
          [itemIds]
        );

        // Map customizations to item_id hash map
        const customsMap = {};
        allCustoms.forEach(c => {
          if (!customsMap[c.order_item_id]) customsMap[c.order_item_id] = [];
          customsMap[c.order_item_id].push(c.customization);
        });

        allItems.forEach(item => {
          item.customizations = customsMap[item.id] || [];
        });
      }

      // Map items to parent order_id hash map
      const itemsMap = {};
      allItems.forEach(item => {
        if (!itemsMap[item.order_id]) itemsMap[item.order_id] = [];
        itemsMap[item.order_id].push(item);
      });

      orders.forEach(order => {
        const format = order.order_display_format || 'POS_STYLE';
        order.display_id = format === 'NUMERIC_HASH' ? order.numeric_display_id : order.pos_display_id;
        order.items = itemsMap[order.id] || [];
      });
    }

    res.json({
      orders,
      pagination: {
        totalOrders: totalCount,
        totalPages: Math.ceil(totalCount / cleanLimit),
        currentPage: page,
        limit: cleanLimit
      }
    });
  } catch (error) {
    console.error('Get order history error:', error);
    res.status(500).json({ error: 'Failed to retrieve order history' });
  }
};

exports.archiveOrder = async (req, res) => {
  const { id } = req.params;
  const restaurantId = req.user.restaurantId;

  try {
    const [existing] = await db.query(
      'SELECT id, restaurant_id FROM orders WHERE id = ? AND restaurant_id = ?',
      [id, restaurantId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    await db.query(
      'UPDATE orders SET is_archived = TRUE WHERE id = ?',
      [id]
    );

    const completeOrder = await Order.findById(id);
    socketService.emitOrderStatusUpdate(id, completeOrder, 'ORDER_STATUS_UPDATED');
    
    const io = socketService.getIo();
    io.to(`restaurant_${restaurantId}`).emit('ORDERS_REFRESH');

    res.json({ message: 'Order archived successfully' });
  } catch (error) {
    console.error('Archive order error:', error);
    res.status(500).json({ error: 'Failed to archive order' });
  }
};

exports.exportOrderHistory = async (req, res) => {
  const userRole = req.user.role;
  const userRestaurantId = req.user.restaurantId;
  const { date, startDate, endDate, tableNumber, orderId, status, restaurantId } = req.query;

  try {
    const XLSX = require('xlsx');

    const whereClauses = [];
    const params = [];

    // 1. Resolve role-based authorization scope
    if (userRole === 'SUPER_ADMIN') {
      if (restaurantId && restaurantId.trim()) {
        whereClauses.push('o.restaurant_id = ?');
        params.push(restaurantId.trim());
      }
    } else {
      // Owners & Managers are restricted to their own restaurant
      whereClauses.push('o.restaurant_id = ?');
      params.push(userRestaurantId);
    }

    // 2. Replicate applied filters
    if (date && date.trim()) {
      whereClauses.push('DATE(o.created_at) = ?');
      params.push(date.trim());
    } else if (startDate && endDate && startDate.trim() && endDate.trim()) {
      whereClauses.push('DATE(o.created_at) BETWEEN ? AND ?');
      params.push(startDate.trim(), endDate.trim());
    }

    if (tableNumber && tableNumber.trim()) {
      whereClauses.push('t.table_number = ?');
      params.push(tableNumber.trim());
    }

    if (orderId && orderId.trim()) {
      whereClauses.push('(o.id LIKE ? OR o.pos_display_id LIKE ? OR o.numeric_display_id LIKE ?)');
      params.push(`%${orderId.trim()}%`, `%${orderId.trim()}%`, `%${orderId.trim()}%`);
    }

    if (status && status.trim()) {
      whereClauses.push('o.status = ?');
      params.push(status.trim());
    } else {
      whereClauses.push("(o.is_archived = TRUE OR o.status IN ('Delivered', 'DELIVERED', 'REJECTED', 'CANCELLED'))");
    }

    const filterCondition = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 3. Count matching records
    const countSql = `SELECT COUNT(DISTINCT o.id) as total
                      FROM orders o
                      JOIN tables t ON o.table_id = t.id
                      ${filterCondition}`;
    const [[{ total: totalCount }]] = await db.query(countSql, params);

    // 4. Batch fetch data in chunks of 5,000 to maintain low memory profile (production-ready)
    const batchLimit = 5000;
    let offset = 0;
    const excelRows = [];

    while (offset < totalCount || totalCount === 0) {
      const selectSql = `SELECT o.*, t.table_number, r.name as restaurant_name, r.order_display_format
                         FROM orders o
                         JOIN tables t ON o.table_id = t.id
                         JOIN restaurants r ON o.restaurant_id = r.id
                         ${filterCondition}
                         ORDER BY o.created_at DESC
                         LIMIT ? OFFSET ?`;

      const [batchOrders] = await db.query(selectSql, [...params, batchLimit, offset]);

      if (batchOrders.length === 0) break;

      // Eager-load batch items and customizations in bulk to avoid N+1 queries
      const orderIds = batchOrders.map(o => o.id);
      const [allItems] = await db.query('SELECT * FROM order_items WHERE order_id IN (?)', [orderIds]);

      let itemsMap = {};
      if (allItems.length > 0) {
        const itemIds = allItems.map(item => item.id);
        const [allCustoms] = await db.query(
          'SELECT order_item_id, customization FROM order_customizations WHERE order_item_id IN (?)',
          [itemIds]
        );

        const customsMap = {};
        allCustoms.forEach(c => {
          if (!customsMap[c.order_item_id]) customsMap[c.order_item_id] = [];
          customsMap[c.order_item_id].push(c.customization);
        });

        allItems.forEach(item => {
          item.customizations = customsMap[item.id] || [];
        });

        allItems.forEach(item => {
          if (!itemsMap[item.order_id]) itemsMap[item.order_id] = [];
          itemsMap[item.order_id].push(item);
        });
      }

      // Map batch orders into SheetJS row format
      batchOrders.forEach(o => {
        const format = o.order_display_format || 'POS_STYLE';
        const displayId = format === 'NUMERIC_HASH' ? o.numeric_display_id : o.pos_display_id;
        const itemsList = itemsMap[o.id] || [];
        const itemsText = itemsList.map(it => `${it.item_name} (x${it.quantity})`).join(', ');

        const createdDate = new Date(o.created_at);
        const formattedDate = createdDate.toISOString().split('T')[0];
        const formattedTime = createdDate.toTimeString().split(' ')[0];

        excelRows.push({
          'Order Display ID': displayId || '#' + o.id?.slice(-6),
          'Internal Order ID': o.id,
          'Date': formattedDate,
          'Time': formattedTime,
          'Restaurant Name': o.restaurant_name,
          'Table Number': o.table_number ? 'Table ' + o.table_number : 'N/A',
          'Ordered Items': itemsText,
          'Total Amount': parseFloat(o.total_amount || 0),
          'Order Status': o.status,
          'Payment Method': 'N/A',
          'Payment Status': 'N/A',
          'Notes': o.notes || ''
        });
      });

      if (totalCount === 0) break;
      offset += batchLimit;
    }

    // 5. Generate Excel WorkBook using xlsx
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(excelRows);

    // Auto-fit column widths for professional visual formatting
    const maxCols = Object.keys(excelRows[0] || {}).map(key => {
      const headerLen = key.length;
      const cellsLen = excelRows.map(row => String(row[key] || '').length);
      const maxLen = Math.max(headerLen, ...cellsLen);
      return { wch: Math.min(Math.max(maxLen + 3, 10), 50) }; // cap between 10 and 50 characters
    });
    worksheet['!cols'] = maxCols;

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Order History');

    // 6. Build dynamic filename matching active filter contexts
    const cleanName = (str) => (str || '').replace(/[^a-zA-Z0-9]/g, '');
    let filenameParts = ['OrderHistory'];
    if (status && status.trim()) filenameParts.push(cleanName(status));
    
    // Add restaurant identifier if applicable
    if (excelRows.length > 0 && excelRows[0]['Restaurant Name']) {
      filenameParts.push(cleanName(excelRows[0]['Restaurant Name']));
    }
    
    filenameParts.push(new Date().toISOString().split('T')[0]);
    const filename = `${filenameParts.join('_')}.xlsx`;

    // 7. Write to client output stream
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);

  } catch (error) {
    console.error('Export order history error:', error);
    res.status(500).json({ error: 'Failed to export order history' });
  }
};
