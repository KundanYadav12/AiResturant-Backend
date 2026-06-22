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

function emitOrderStatusUpdate(orderId, order) {
  if (io) {
    io.to(`order_${orderId}`).emit('ORDER_STATUS_UPDATED', order);
    console.log(`Real-time: Broadcasted ORDER_STATUS_UPDATED for order_${orderId}`);
  }
}

module.exports = {
  init,
  getIo,
  emitNewOrder,
  emitOrderStatusUpdate
};
