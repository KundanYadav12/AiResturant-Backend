// const express = require('express');
// const http = require('http');
// const cors = require('cors');
// const path = require('path');
// require('dotenv').config();

// const db = require('./config/database');
// const socketService = require('./services/socketService');

// // Route Imports
// const authRoutes = require('./routes/authRoutes');
// const menuRoutes = require('./routes/menuRoutes');
// const orderRoutes = require('./routes/orderRoutes');
// const dashboardRoutes = require('./routes/dashboardRoutes');
// const saasRoutes = require('./routes/saasRoutes');

// const app = express();
// const server = http.createServer(app);

// // Initialize Socket.IO
// socketService.init(server);

// // Middleware
// app.use(cors({
//   origin: process.env.FRONTEND_URL || 'http://localhost:5173',
//   credentials: true
// }));
// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));

// // Serve Static files for uploaded menu images
// app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// // Routes
// app.use('/api/auth', authRoutes);
// app.use('/api/menu', menuRoutes);
// app.use('/api', orderRoutes); // orders routes are prefixed under root api
// app.use('/api/dashboard', dashboardRoutes);
// app.use('/api/saas', saasRoutes);

// // Health check endpoint
// app.get('/health', (req, res) => {
//   res.json({ status: 'healthy', timestamp: new Date() });
// });

// // Global Error Handler
// app.use((err, req, res, next) => {
//   console.error('Unhandled Server Error:', err.message);
//   res.status(500).json({ error: err.message || 'Something went wrong on the server' });
// });

// const PORT = process.env.PORT || 5000;

// async function startServer() {
//   try {
//     // 1. Initialize database and schema
//     await db.initializeDatabase();
    
//     // 2. Start HTTP & Socket server
//     server.listen(PORT, () => {
//       console.log(`=============================================`);
//       console.log(`  AI Restaurant Backend running on port ${PORT}`);
//       console.log(`  Real-time Socket.IO enabled`);
//       console.log(`=============================================`);
//     });
//   } catch (error) {
//     console.error('Could not start server due to database init failure:', error);
//     process.exit(1);
//   }
// }

// startServer();






const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const db = require('./config/database');
const socketService = require('./services/socketService');
const WebSocket = require('ws');
const url = require('url');
const aiService = require('./services/aiService');

// Route Imports
const authRoutes = require('./routes/authRoutes');
const menuRoutes = require('./routes/menuRoutes');
const orderRoutes = require('./routes/orderRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const saasRoutes = require('./routes/saasRoutes');
const vapiRoutes = require('./routes/vapiRoutes');

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
socketService.init(server);

// ============================================================
// GEMINI MULTIMODAL LIVE WEBSOCKET PROXY
// ============================================================
const wss = new WebSocket.Server({ noServer: true });

 wss.on('connection', async (clientWs, req) => {
  const reqUrl = url.parse(req.url, true);
  const tableToken = reqUrl.query.tableToken;
  const clientLanguageCode = reqUrl.query.languageCode;

  console.log('\n========================================');
  console.log('[Gemini Proxy] 🔌 NEW CLIENT CONNECTED');
  console.log(`[Gemini Proxy]    tableToken = ${tableToken}`);
  console.log(`[Gemini Proxy]    languageCode = ${clientLanguageCode}`);
  console.log('========================================\n');

  if (!tableToken) {
    console.error('[Gemini Proxy] ❌ Rejected: Missing tableToken');
    clientWs.close(1008, 'Missing tableToken query parameter');
    return;
  }

  let geminiWs = null;
  let isClosed = false;
  const messageQueue = [];

  try {
    // 1. Retrieve RAG system instruction & restaurant details for this table session
    console.log(`[Gemini Proxy] 📋 Fetching voice agent context for table: ${tableToken}`);
    const { systemPrompt, table } = await aiService.getVoiceAgentContext(tableToken, clientLanguageCode);
    console.log(`[Gemini Proxy] ✅ System prompt loaded (${systemPrompt.length} chars)`);
    console.log('[Gemini Proxy] --- System prompt preview (first 300 chars) ---');
    console.log(systemPrompt.substring(0, 300));
    console.log('[Gemini Proxy] ---');

    // Resolve Gemini API key dynamically (supporting custom keys)
    const { getGeminiKey } = require('./utils/aiKeys');
    const resolvedKey = await getGeminiKey(table.restaurant_id);
    if (!resolvedKey) {
      console.error('[Gemini Proxy] ❌ GEMINI_API_KEY is not configured (neither platform nor custom)!');
      clientWs.close(1011, 'GEMINI_API_KEY not configured on server');
      return;
    }

    // 2. Connect to Gemini Generative Service Bidi WebSocket
    // Using gemini-2.5-flash-native-audio-latest which is the stable Live audio model supporting BidiGenerateContent on v1beta
    const GEMINI_MODEL = 'models/gemini-2.5-flash-native-audio-latest';
    const GEMINI_WSS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${resolvedKey}`;

    console.log(`[Gemini Proxy] 🔗 Connecting to Gemini upstream: ${GEMINI_MODEL}`);
    geminiWs = new WebSocket(GEMINI_WSS_URL);

    geminiWs.on('open', () => {
      console.log('[Gemini Proxy] ✅ Gemini upstream WebSocket OPEN — sending setup config...');

      // Dynamic voice selection (Aoede = female, Puck = male)
      let voiceName = 'Aoede';
      if (table.voice_gender === 'male') {
        voiceName = 'Puck';
      }
      
      const rawLang = clientLanguageCode || table.voice_language || 'en-IN';
      const languageCode = rawLang.startsWith('hi') ? 'hi-IN' : 'en-US'; // en-US since en-IN is unsupported for native audio models

      console.log(`[Gemini Proxy] 🎙 Configuring voice: Name="${voiceName}", LanguageCode="${languageCode}"`);

      const setupMessage = {
        setup: {
          model: GEMINI_MODEL,
          generationConfig: {
            responseModalities: ['AUDIO'],   // audio output only — TEXT would break streaming
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: voiceName
                }
              },
              languageCode: languageCode
            }
          },
          systemInstruction: {
            parts: [{ text: systemPrompt }]
          },
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'update_cart',
                  description: 'Customer ke order cart ko update karo. Jab bhi customer kuch add, remove ya modify kare tab call karo.',
                  parameters: {
                    type: 'OBJECT',
                    properties: {
                      items: {
                        type: 'ARRAY',
                        description: 'Cart mein abhi jo items hain unki poori list.',
                        items: {
                          type: 'OBJECT',
                          properties: {
                            name: {
                              type: 'STRING',
                              description: 'Menu item ka exact naam (e.g. "Paneer Tikka Masala").'
                            },
                            quantity: {
                              type: 'INTEGER',
                              description: 'Item ki quantity.'
                            },
                            customizations: {
                              type: 'ARRAY',
                              description: 'Special instructions (e.g. "extra spicy", "onion mat dalna").',
                              items: { type: 'STRING' }
                            }
                          },
                          required: ['name', 'quantity']
                        }
                      }
                    },
                    required: ['items']
                  }
                },
                {
                  name: 'place_order',
                  description: 'Customer jab final confirmation de ya final bole order place karne ko tab call karo. Isse order kitchen me submit ho jata hai.',
                  parameters: {
                    type: 'OBJECT',
                    properties: {}
                  }
                }
              ]
            }
          ]
        }
      };

      console.log('[Gemini Proxy] 📤 Sending setup payload to Gemini...');
      console.log(JSON.stringify(setupMessage.setup.generationConfig, null, 2));
      geminiWs.send(JSON.stringify(setupMessage));

      // Flush any queued messages from client that arrived before Gemini was ready
      console.log(`[Gemini Proxy] 📥 Message queue size after open: ${messageQueue.length}`);
      while (messageQueue.length > 0 && geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.send(messageQueue.shift());
      }
    });

    geminiWs.on('message', (data) => {
      if (isClosed) return;

      try {
        const rawStr = data.toString();

        // Optimize: Bypassing parsing/logging for high-frequency raw audio stream packets
        const isPureAudio = rawStr.includes('"inlineData"') && !rawStr.includes('"text"');

        if (isPureAudio) {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(rawStr);
          }
          return;
        }

        const parsed = JSON.parse(rawStr);

        // ── Handle other upstream message types ──
        if (parsed.setupComplete !== undefined) {
          console.log('[Gemini Proxy] ✅ setupComplete received from Gemini — notifying frontend to START RECORDING');
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ system: { status: 'ready' } }));
          }
          return;
        }

        if (parsed.serverContent) {
          const { modelTurn, interrupted, turnComplete } = parsed.serverContent;
          if (interrupted) {
            console.log('[Gemini Proxy] ⚡ INTERRUPTED (barge-in by user)');
          } else if (modelTurn) {
            const parts = modelTurn.parts || [];
            const textParts  = parts.filter(p => p.text);
            textParts.forEach(p => console.log(`[Gemini Proxy] 📝 Gemini text: "${p.text}"`));
          } else if (turnComplete) {
            console.log('[Gemini Proxy] ✔ turnComplete (no content parts)');
          }
        }

        if (parsed.toolCall) {
          const calls = parsed.toolCall.functionCalls || [];
          console.log(`[Gemini Proxy] 🛒 toolCall received: ${calls.map(c => c.name).join(', ')}`);
          calls.forEach(c => console.log('[Gemini Proxy]    args:', JSON.stringify(c.args)));
        }

        if (parsed.error) {
          console.error('[Gemini Proxy] ❌ ERROR from Gemini upstream:', JSON.stringify(parsed.error));
        }

        // Forward other messages to frontend client
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(rawStr);
        }
      } catch (e) {
        console.error('[Gemini Proxy] ⚠ Failed to parse Gemini message:', e.message);
        if (clientWs.readyState === WebSocket.OPEN) {
          try { clientWs.send(data.toString()); } catch (_) {}
        }
      }
    });

    geminiWs.on('close', (code, reason) => {
      const reasonStr = reason ? reason.toString() : 'No reason given';
      console.log(`[Gemini Proxy] 🔴 Gemini upstream CLOSED — code: ${code}, reason: "${reasonStr}"`);
      isClosed = true;
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(code, reasonStr);
      }
    });

    geminiWs.on('error', (err) => {
      console.error('[Gemini Proxy] ❌ Gemini upstream WebSocket ERROR:', err.message);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          error: 'Gemini upstream connection error',
          details: err.message
        }));
      }
    });

    // ── Forward client → Gemini ──
    clientWs.on('message', (message) => {
      if (isClosed) return;
      const msgStr = message.toString();

      // Optimize: Bypass logging and parsing for high-frequency client audio packets
      if (!msgStr.includes('"realtimeInput"')) {
        try {
          const parsed = JSON.parse(msgStr);
          console.log('[Gemini Proxy] ← Client msg (non-audio):', JSON.stringify(parsed).substring(0, 200));
        } catch (_) {}
      }

      if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.send(msgStr);
      } else {
        console.log('[Gemini Proxy] ⏳ Gemini not ready — queuing client message');
        messageQueue.push(msgStr);
      }
    });

    clientWs.on('close', (code, reason) => {
      console.log(`[Gemini Proxy] 🔴 CLIENT disconnected. Code: ${code}`);
      isClosed = true;
      if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.close();
      }
    });

    clientWs.on('error', (err) => {
      console.error('[Gemini Proxy] ❌ Client WebSocket error:', err.message);
      isClosed = true;
      if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.close();
      }
    });

  } catch (error) {
    console.error('[Gemini Proxy] ❌ Initialization error:', error.message, error.stack);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1011, error.message || 'Failed to start Gemini session');
    }
  }
});

// Handle WebSocket upgrades — route /ws/gemini to our proxy, everything else to Socket.IO
server.on('upgrade', (request, socket, head) => {
  const pathname = url.parse(request.url).pathname;
  console.log(`[Server] Upgrade request for path: ${pathname}`);
  if (pathname === '/ws/gemini') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

// Middleware
const allowedOrigins = [
  'https://aiwaitercall.netlify.app',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    
    // Allow any localhost origin (e.g., http://localhost:5173, http://localhost:3000, etc.)
    if (/^http:\/\/localhost(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    
    // Allow any Netlify subdomains (for preview branch deployments)
    if (/\.netlify\.app$/.test(origin)) {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    return callback(new Error('CORS not allowed: ' + origin));
  },
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Static files for uploaded menu images
app.use('/api/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api', orderRoutes); // orders routes are prefixed under root api
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/saas', saasRoutes);
app.use('/api/vapi', vapiRoutes); // Vapi Premium Voice AI

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date() });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err.message);
  res.status(500).json({ error: err.message || 'Something went wrong on the server' });
});

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // 1. Initialize database and schema
    await db.initializeDatabase();
    
    // 2. Start HTTP & Socket server
    server.listen(PORT, () => {
      console.log(`=============================================`);
      console.log(`  AI Restaurant Backend running on port ${PORT}`);
      console.log(`  Real-time Socket.IO enabled`);
      console.log(`=============================================`);
    });

    // 3. Start auto-archiving background worker (checks every 60 seconds)
    setInterval(async () => {
      try {
        const [restaurants] = await db.query('SELECT id, auto_archive_timeout FROM restaurants WHERE auto_archive_timeout > 0');
        for (const r of restaurants) {
          const timeoutMins = r.auto_archive_timeout;

          // Fetch final workflow stage name
          const [stages] = await db.query(
            'SELECT name FROM restaurant_order_stages WHERE restaurant_id = ? AND is_active = TRUE ORDER BY rank_order DESC LIMIT 1',
            [r.id]
          );
          const finalStage = stages.length > 0 ? stages[0].name : 'Delivered';

          // Query orders to archive
          const [ordersToArchive] = await db.query(
            `SELECT id FROM orders 
             WHERE restaurant_id = ? 
               AND is_archived = FALSE 
               AND (status = ? OR status IN ('Delivered', 'DELIVERED', 'REJECTED', 'CANCELLED'))
               AND created_at < NOW() - INTERVAL ? MINUTE`,
            [r.id, finalStage, timeoutMins]
          );

          if (ordersToArchive.length > 0) {
            const idsToArchive = ordersToArchive.map(o => o.id);
            console.log(`[Auto-Archive] Archiving ${idsToArchive.length} orders for restaurant ${r.id}`);
            
            await db.query(
              'UPDATE orders SET is_archived = TRUE WHERE id IN (?)',
              [idsToArchive]
            );

            // Notify dashboards to refresh
            const io = socketService.getIo();
            io.to(`restaurant_${r.id}`).emit('ORDERS_REFRESH');
          }
        }
      } catch (err) {
        console.error('[Auto-Archive Background Worker Error]:', err.message || err);
      }
    }, 60000);

  } catch (error) {
    console.error('Could not start server due to database init failure:', error);
    process.exit(1);
  }
}

startServer();