const socketIo = require('socket.io');

let io;

function init(server) {
  io = socketIo(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    console.log(`Socket client connected: ${socket.id}`);

    // Join room for a specific restaurant (e.g. manager dashboard)
    socket.on('join_restaurant', (restaurantId) => {
      socket.join(`restaurant_${restaurantId}`);
      console.log(`Socket ${socket.id} joined restaurant_${restaurantId}`);
    });

    // Join room for tracking a specific order (e.g. customer status page)
    socket.on('join_order', (orderId) => {
      socket.join(`order_${orderId}`);
      console.log(`Socket ${socket.id} joined order_${orderId}`);
    });

    // Join room for a specific dining table session (for real-time Vapi cart sync)
    socket.on('join_table', (tableToken) => {
      socket.join(`table_${tableToken}`);
      console.log(`Socket ${socket.id} joined table_${tableToken}`);
    });

    socket.on('disconnect', () => {
      console.log(`Socket client disconnected: ${socket.id}`);
    });
  });

  return io;
}

function getIo() {
  if (!io) {
    throw new Error('Socket.IO is not initialized. Call init(server) first.');
  }
  return io;
}

// Utility functions to emit events from controllers
function emitNewOrder(restaurantId, order) {
  if (io) {
    io.to(`restaurant_${restaurantId}`).emit('NEW_ORDER', order);
    console.log(`Real-time: Broadcasted NEW_ORDER for restaurant_${restaurantId}`);
  }
}

function emitOrderStatusUpdate(orderId, order, eventName = 'ORDER_STATUS_UPDATED') {
  if (io) {
    // Emit standard updates to the tracking client
    io.to(`order_${orderId}`).emit('ORDER_STATUS_UPDATED', order);
    // Also emit custom status event (ORDER_ACCEPTED, etc.) to room if needed
    io.to(`order_${orderId}`).emit(eventName, order);
    console.log(`Real-time: Broadcasted ${eventName} for order_${orderId}`);
  }
}

function emitTableRequest(restaurantId, request) {
  if (io) {
    let eventName = 'WAITER_REQUEST';
    if (request.requestType === 'WATER' || request.request_type === 'WATER') {
      eventName = 'WATER_REQUEST';
    } else if (request.requestType === 'BILL' || request.request_type === 'BILL') {
      eventName = 'BILL_REQUEST';
    }
    io.to(`restaurant_${restaurantId}`).emit(eventName, request);
    // Also emit a general TABLE_STATUS_UPDATED event to refresh tables
    io.to(`restaurant_${restaurantId}`).emit('TABLE_STATUS_UPDATED', request);
    console.log(`Real-time: Broadcasted ${eventName} to restaurant_${restaurantId}`);
  }
}

function emitCartUpdate(tableToken, cart, assistantResponse) {
  if (io) {
    io.to(`table_${tableToken}`).emit('CART_UPDATED', { cart, assistantResponse });
    console.log(`Real-time: Broadcasted CART_UPDATED for table_${tableToken}`);
  }
}

module.exports = {
  init,
  getIo,
  emitNewOrder,
  emitOrderStatusUpdate,
  emitTableRequest,
  emitCartUpdate
};
