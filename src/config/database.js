const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

let pool;

async function initializeDatabase() {
  try {
    // First, connect to MySQL without specifying a database to ensure it exists
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD,
    });

    console.log('Connected to MySQL server for initialization...');
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || 'AIResturant'}\`;`);
    await connection.end();

    // Now create the pool with the database specified and multipleStatements enabled
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'AIResturant',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      multipleStatements: true
    });

    // Read and execute schema.sql to ensure all tables exist
    const schemaPath = path.join(__dirname, '../../../schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      await pool.query(schemaSql);
      console.log('Database schema initialized/verified successfully.');

      // Auto-migration helper for schema upgrades
      const migrate = async () => {
        try {
          const [cols] = await pool.query("SHOW COLUMNS FROM restaurants LIKE 'order_display_format'");
          if (cols.length === 0) {
            await pool.query("ALTER TABLE restaurants ADD COLUMN order_display_format ENUM('POS_STYLE', 'NUMERIC_HASH') DEFAULT 'POS_STYLE'");
            console.log('✅ Auto-Migration: Added order_display_format column to restaurants table.');
          }
        } catch (err) {
          console.error('Migration error on restaurants table:', err.message);
        }

        try {
          const [cols1] = await pool.query("SHOW COLUMNS FROM orders LIKE 'pos_display_id'");
          if (cols1.length === 0) {
            await pool.query("ALTER TABLE orders ADD COLUMN pos_display_id VARCHAR(50) DEFAULT NULL");
            console.log('✅ Auto-Migration: Added pos_display_id column to orders table.');
          }
        } catch (err) {
          console.error('Migration error on orders pos_display_id:', err.message);
        }

        try {
          const [cols2] = await pool.query("SHOW COLUMNS FROM orders LIKE 'numeric_display_id'");
          if (cols2.length === 0) {
            await pool.query("ALTER TABLE orders ADD COLUMN numeric_display_id VARCHAR(50) DEFAULT NULL");
            console.log('✅ Auto-Migration: Added numeric_display_id column to orders table.');
          }
        } catch (err) {
          console.error('Migration error on orders numeric_display_id:', err.message);
        }

        try {
          const [cols3] = await pool.query("SHOW COLUMNS FROM categories LIKE 'rank_order'");
          if (cols3.length === 0) {
            await pool.query("ALTER TABLE categories ADD COLUMN rank_order INT DEFAULT 0");
            console.log('✅ Auto-Migration: Added rank_order column to categories table.');
          }
        } catch (err) {
          console.error('Migration error on categories rank_order:', err.message);
        }

        try {
          const [cols4] = await pool.query("SHOW COLUMNS FROM menu_items LIKE 'rank_order'");
          if (cols4.length === 0) {
            await pool.query("ALTER TABLE menu_items ADD COLUMN rank_order INT DEFAULT 0");
            console.log('✅ Auto-Migration: Added rank_order column to menu_items table.');
          }
        } catch (err) {
          console.error('Migration error on menu_items rank_order:', err.message);
        }

        try {
          const [cols5] = await pool.query("SHOW COLUMNS FROM menu_items LIKE 'is_veg'");
          if (cols5.length === 0) {
            await pool.query("ALTER TABLE menu_items ADD COLUMN is_veg BOOLEAN DEFAULT TRUE");
            console.log('✅ Auto-Migration: Added is_veg column to menu_items table.');
          }
        } catch (err) {
          console.error('Migration error on menu_items is_veg:', err.message);
        }

        try {
          const [cols6] = await pool.query("SHOW COLUMNS FROM restaurants LIKE 'gst_number'");
          if (cols6.length === 0) {
            await pool.query("ALTER TABLE restaurants ADD COLUMN gst_number VARCHAR(50) DEFAULT ''");
            console.log('✅ Auto-Migration: Added gst_number column to restaurants table.');
          }
        } catch (err) {
          console.error('Migration error on restaurants gst_number:', err.message);
        }

        try {
          const [cols7] = await pool.query("SHOW COLUMNS FROM restaurants LIKE 'footer_message'");
          if (cols7.length === 0) {
            await pool.query("ALTER TABLE restaurants ADD COLUMN footer_message TEXT DEFAULT NULL");
            console.log('✅ Auto-Migration: Added footer_message column to restaurants table.');
          }
        } catch (err) {
          console.error('Migration error on restaurants footer_message:', err.message);
        }

        try {
          const [cols8] = await pool.query("SHOW COLUMNS FROM restaurants LIKE 'theme_color'");
          if (cols8.length === 0) {
            await pool.query("ALTER TABLE restaurants ADD COLUMN theme_color VARCHAR(20) DEFAULT '#0d6efd'");
            console.log('✅ Auto-Migration: Added theme_color column to restaurants table.');
          }
        } catch (err) {
          console.error('Migration error on restaurants theme_color:', err.message);
        }

        try {
          const [cols9] = await pool.query("SHOW COLUMNS FROM restaurants LIKE 'currency_symbol'");
          if (cols9.length === 0) {
            await pool.query("ALTER TABLE restaurants ADD COLUMN currency_symbol VARCHAR(10) DEFAULT '₹'");
            console.log('✅ Auto-Migration: Added currency_symbol column to restaurants table.');
          }
        } catch (err) {
          console.error('Migration error on restaurants currency_symbol:', err.message);
        }

        try {
          const [cols10] = await pool.query("SHOW COLUMNS FROM restaurants LIKE 'tax_settings'");
          if (cols10.length === 0) {
            await pool.query("ALTER TABLE restaurants ADD COLUMN tax_settings DECIMAL(5,2) DEFAULT 5.00");
            console.log('✅ Auto-Migration: Added tax_settings column to restaurants table.');
          }
        } catch (err) {
          console.error('Migration error on restaurants tax_settings:', err.message);
        }

        // 1. Create restaurant_order_stages table
        try {
          await pool.query(`
            CREATE TABLE IF NOT EXISTS restaurant_order_stages (
              id            VARCHAR(50)  PRIMARY KEY,
              restaurant_id VARCHAR(50)  NOT NULL,
              name          VARCHAR(100) NOT NULL,
              rank_order    INT          DEFAULT 0,
              is_active     BOOLEAN      DEFAULT TRUE,
              FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
            );
          `);
          console.log('✅ Auto-Migration: Verified restaurant_order_stages table.');
        } catch (err) {
          console.error('Migration error creating restaurant_order_stages table:', err.message);
        }

        // 2. Modify orders.status to VARCHAR(100)
        try {
          await pool.query("ALTER TABLE orders MODIFY COLUMN status VARCHAR(100) NOT NULL DEFAULT 'Order Received'");
          console.log('✅ Auto-Migration: Modified orders.status to VARCHAR(100) with default.');
        } catch (err) {
          console.error('Migration error altering orders.status:', err.message);
        }

        // 3. Pre-populate default stages for restaurants with 0 custom stages
        try {
          const [restaurants] = await pool.query("SELECT id FROM restaurants");
          const defaultStages = ['Order Received', 'Accepted', 'Preparing', 'Ready', 'Delivered'];
          for (const rest of restaurants) {
            const [existing] = await pool.query("SELECT COUNT(*) as count FROM restaurant_order_stages WHERE restaurant_id = ?", [rest.id]);
            if (existing[0].count === 0) {
              console.log(`🌱 Seeding default stages for restaurant: ${rest.id}`);
              for (let i = 0; i < defaultStages.length; i++) {
                const stageId = `stage-${rest.id}-${i}`;
                await pool.query(
                  "INSERT INTO restaurant_order_stages (id, restaurant_id, name, rank_order, is_active) VALUES (?, ?, ?, ?, TRUE)",
                  [stageId, rest.id, defaultStages[i], i]
                );
              }
            }
          }
        } catch (err) {
          console.error('Migration error seeding default order stages:', err.message);
        }

        // 4. Add is_archived to orders
        try {
          const [colsOrders] = await pool.query("SHOW COLUMNS FROM orders LIKE 'is_archived'");
          if (colsOrders.length === 0) {
            await pool.query("ALTER TABLE orders ADD COLUMN is_archived BOOLEAN DEFAULT FALSE");
            console.log('✅ Auto-Migration: Added is_archived column to orders table.');
          }
        } catch (err) {
          console.error('Migration error adding is_archived to orders:', err.message);
        }

        // 5. Add auto_archive_timeout to restaurants
        try {
          const [colsRests] = await pool.query("SHOW COLUMNS FROM restaurants LIKE 'auto_archive_timeout'");
          if (colsRests.length === 0) {
            await pool.query("ALTER TABLE restaurants ADD COLUMN auto_archive_timeout INT DEFAULT 0");
            console.log('✅ Auto-Migration: Added auto_archive_timeout column to restaurants table.');
          }
        } catch (err) {
          console.error('Migration error adding auto_archive_timeout to restaurants:', err.message);
        }

        // 6. Add created_at to order_items
        try {
          const [colsOrderItems] = await pool.query("SHOW COLUMNS FROM order_items LIKE 'created_at'");
          if (colsOrderItems.length === 0) {
            await pool.query("ALTER TABLE order_items ADD COLUMN created_at TIMESTAMP NULL DEFAULT NULL");
            await pool.query("UPDATE order_items oi JOIN orders o ON oi.order_id = o.id SET oi.created_at = o.created_at");
            await pool.query("ALTER TABLE order_items MODIFY COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
            console.log('✅ Auto-Migration: Added created_at column to order_items table and synced with orders.');
          }
        } catch (err) {
          console.error('Migration error adding created_at to order_items:', err.message);
        }

        // 7. Add AI Provider columns to restaurants
        try {
          const [colsRestsAI] = await pool.query("SHOW COLUMNS FROM restaurants LIKE 'api_mode'");
          if (colsRestsAI.length === 0) {
            await pool.query("ALTER TABLE restaurants ADD COLUMN google_api_key TEXT NULL");
            await pool.query("ALTER TABLE restaurants ADD COLUMN groq_api_key TEXT NULL");
            await pool.query("ALTER TABLE restaurants ADD COLUMN api_mode ENUM('platform','customer') DEFAULT 'platform'");
            await pool.query("ALTER TABLE restaurants ADD COLUMN allow_google_api BOOLEAN DEFAULT TRUE");
            await pool.query("ALTER TABLE restaurants ADD COLUMN allow_groq_api BOOLEAN DEFAULT TRUE");
            await pool.query("ALTER TABLE restaurants ADD COLUMN allow_customer_api BOOLEAN DEFAULT FALSE");
            console.log('✅ Auto-Migration: Added AI config columns to restaurants table.');
          }
        } catch (err) {
          console.error('Migration error adding AI config columns to restaurants:', err.message);
        }

        // 8. Add optimized index to orders table for scalable order history queries
        try {
          const [indexes] = await pool.query("SHOW INDEX FROM orders WHERE Key_name = 'idx_orders_restaurant_created'");
          if (indexes.length === 0) {
            await pool.query("CREATE INDEX idx_orders_restaurant_created ON orders (restaurant_id, created_at)");
            console.log('✅ Auto-Migration: Created composite index idx_orders_restaurant_created on orders table.');
          }
        } catch (err) {
          console.error('Migration error creating index on orders:', err.message);
        }

        // 9. Update menu item images paths to use `/api/uploads` prefix for Nginx proxying
        try {
          await pool.query("UPDATE menu_items SET image = REPLACE(image, '/uploads/', '/api/uploads/') WHERE image LIKE '/uploads/%'");
          console.log('✅ Auto-Migration: Updated existing menu item image paths to use /api/uploads/ prefix.');
        } catch (err) {
          console.error('Migration error updating menu item image paths:', err.message);
        }
      };
      await migrate();
    } else {
      console.warn('schema.sql file not found. Skipping auto-initialization.');
    }

    return pool;
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

// Lazy-loaded query function
async function query(sql, params) {
  if (!pool) {
    await initializeDatabase();
  }
  return pool.query(sql, params);
}

module.exports = {
  initializeDatabase,
  query,
  getPool: () => pool
};
