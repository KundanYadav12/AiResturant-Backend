// seed.js — Multi-Tenant SaaS Seed
// Drops all tables, applies new schema, inserts demo data using model methods
// that auto-generate prefixed secure IDs (rst_xxx, usr_xxx, tbl_xxx, etc.)

const db = require('./database');
const fs = require('fs');
const path = require('path');
const Restaurant = require('../models/Restaurant');
const User = require('../models/User');
const Menu = require('../models/Menu');
const Table = require('../models/Table');
const Knowledge = require('../models/Knowledge');
const Order = require('../models/Order');

async function seed() {
  console.log('\n Starting SaaS database seed...\n');

  try {
    // 1. Initialize raw connection (no specific DB) to create DB if needed
    const mysql = require('mysql2/promise');
    const bootstrapConn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD,
      multipleStatements: true,
    });
    await bootstrapConn.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || 'AIResturant'}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    await bootstrapConn.query(`USE \`${process.env.DB_NAME || 'AIResturant'}\`;`);

    console.log('Dropping existing tables...');
    await bootstrapConn.query('SET FOREIGN_KEY_CHECKS = 0');
    await bootstrapConn.query(`DROP TABLE IF EXISTS
      audit_logs, ai_usage_logs,
      order_customizations, order_items, orders,
      table_requests,
      menu_item_customizations, menu_item_ingredients, ingredients,
      faqs, ai_knowledge,
      menu_items, categories,
      tables, users, restaurants
    `);
    await bootstrapConn.query('SET FOREIGN_KEY_CHECKS = 1');

    // Re-create all tables from schema.sql
    console.log('Re-creating tables with new schema...');
    const schemaPath = path.join(__dirname, '../../../schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    // Split on semicolons and run each CREATE statement individually
    const statements = schemaSql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--') && !s.toUpperCase().startsWith('CREATE DATABASE') && !s.toUpperCase().startsWith('USE '));
    for (const stmt of statements) {
      await bootstrapConn.query(stmt);
    }
    await bootstrapConn.end();

    // Now init the pool for the rest of seed
    console.log('Initializing connection pool...');
    const pool = await db.initializeDatabase();

    // ── 2. Super Admin ──────────────────────────────────────────────────────────
    // SUPER_ADMIN has no restaurant_id
    const superAdmin = await User.create({
      restaurantId: null,
      name: 'Kundan Yadav (Platform Owner)',
      email: 'kundanyadav96197@gmail.com',
      password: 'KundanAi@1234',   // ← Change after first login
      role: 'SUPER_ADMIN',
    });
    console.log(`✅ Super Admin 1: kundanyadav96197@gmail.com / KundanAi@1234  (id: ${superAdmin.id})`);

    const superAdmin2 = await User.create({
      restaurantId: null,
      name: 'Dealup Platform Owner',
      email: 'dealup24@gmail.com',
      password: 'Kundan@12',
      role: 'SUPER_ADMIN',
    });
    console.log(`✅ Super Admin 2: dealup24@gmail.com / Kundan@12  (id: ${superAdmin2.id})`);

    // ── 3. Demo Restaurant ──────────────────────────────────────────────────────
    const restaurant = await Restaurant.create({
      name: 'Indian Spice Bistro',
      phone: '+91 98765 43210',
      email: 'info@spicebistro.com',
      address: '123 Gourmet Street, Foodie Lane, Delhi',
    });

    // Upgrade to ACTIVE + PROFESSIONAL plan with 1-year expiry and default voice settings
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    await Restaurant.update(restaurant.id, {
      status: 'ACTIVE',
      subscription_plan: 'PROFESSIONAL',
      subscription_expires_at: expiryDate,
      ai_waiter_enabled: true,
      voice_interaction_enabled: true,
      continuous_voice_enabled: true,
      greeting_message: "Hello! I am your AI Waiter. What would you like to eat today?",
      voice_language: 'en-IN',
      voice_gender: 'female',
      voice_speed: 1.00,
      auto_listening_timeout: 5,
      wake_word: '',
      // Vapi Premium Voice (platform-owner controlled)
      vapi_enabled: false,           // Enable via Super Admin dashboard only
      vapi_assistant_id: '',         // Set via Super Admin when vapi_enabled = true
      voice_provider: 'browser',     // 'browser' | 'vapi'
      voice_volume: 1.00,
      inactivity_timeout: 30,        // seconds of silence before auto-end
      max_voice_minutes_per_day: 60, // 0 = unlimited
      order_display_format: 'POS_STYLE'
    });
    console.log(`✅ Restaurant: ${restaurant.name}  (id: ${restaurant.id})`);

    // ── 4. Restaurant Users ─────────────────────────────────────────────────────
    const owner = await User.create({
      restaurantId: restaurant.id,
      name: 'Kundan Owner',
      email: 'owner@bistro.com',
      password: 'password123',
      role: 'OWNER',
    });
    const manager = await User.create({
      restaurantId: restaurant.id,
      name: 'Kundan Manager',
      email: 'manager@bistro.com',
      password: 'password123',
      role: 'MANAGER',
    });
    console.log(`✅ Owner:   owner@bistro.com / password123  (id: ${owner.id})`);
    console.log(`✅ Manager: manager@bistro.com / password123  (id: ${manager.id})`);

    // ── 5. Tables ───────────────────────────────────────────────────────────────
    const tables = [];
    for (let i = 1; i <= 5; i++) {
      const t = await Table.create({ restaurantId: restaurant.id, tableNumber: `Table ${i}` });
      tables.push(t);
    }
    console.log(`✅ Created 5 tables. Tokens: ${tables.map((t) => t.tableToken).join(', ')}`);

    // ── 6. Categories ───────────────────────────────────────────────────────────
    const catNames = ['Starters', 'Mains', 'Drinks', 'Desserts'];
    const categories = {};
    for (const name of catNames) {
      const cat = await Menu.createCategory({ restaurantId: restaurant.id, name });
      categories[name] = cat;
    }
    console.log(`✅ Categories: ${catNames.join(', ')}`);

    // ── 7. Menu Items ───────────────────────────────────────────────────────────
    const menuItemData = [
      { cat: 'Starters', name: 'Paneer Tikka',     price: 249, desc: 'Spicy grilled cottage cheese with bell peppers and onions' },
      { cat: 'Starters', name: 'Hara Bhara Kabab', price: 189, desc: 'Deep fried patties of spinach, peas and potatoes' },
      { cat: 'Mains',    name: 'Butter Chicken',   price: 379, desc: 'Rich creamy tomato gravy with charcoal-grilled chicken tikka' },
      { cat: 'Mains',    name: 'Dal Makhani',      price: 299, desc: 'Slow cooked black lentils with kidney beans, cream and white butter' },
      { cat: 'Mains',    name: 'Garlic Naan',      price: 59,  desc: 'Clay oven flatbread with chopped garlic and butter' },
      { cat: 'Mains',    name: 'Jeera Rice',       price: 149, desc: 'Basmati rice tempered with cumin seeds and fresh ghee' },
      { cat: 'Drinks',   name: 'Coke',             price: 49,  desc: 'Chilled carbonated Coca Cola can (330ml)' },
      { cat: 'Drinks',   name: 'Masala Shikanji',  price: 79,  desc: 'Traditional Indian lemonade with roasted cumin and black salt' },
      { cat: 'Desserts', name: 'Gulab Jamun',      price: 89,  desc: 'Warm milk dumplings in cardamom sugar syrup (2 Pcs)' },
      { cat: 'Desserts', name: 'Kesari Rasmalai',  price: 119, desc: 'Cottage cheese patties in saffron milk syrup (2 Pcs)' },
    ];
    const items = {};
    for (const data of menuItemData) {
      const item = await Menu.createMenuItem({
        restaurantId: restaurant.id,
        categoryId: categories[data.cat].id,
        name: data.name,
        description: data.desc,
        price: data.price,
      });
      items[data.name] = item;
    }
    console.log(`✅ Seeded ${menuItemData.length} menu items`);

    // ── 8. Ingredients ──────────────────────────────────────────────────────────
    const ingNames = ['Paneer', 'Chicken', 'Lentils', 'Garlic', 'Onion', 'Cashews', 'Cream', 'Spinach', 'Cardamom', 'Milk', 'Saffron'];
    const ings = {};
    for (const name of ingNames) {
      const ing = await Knowledge.createIngredient(restaurant.id, name);
      ings[name] = ing;
    }
    await Knowledge.linkMenuItemIngredients(items['Paneer Tikka'].id, [
      { ingredientId: ings['Paneer'].id, isAllergen: false },
      { ingredientId: ings['Onion'].id,  isAllergen: false },
      { ingredientId: ings['Garlic'].id, isAllergen: false },
    ]);
    await Knowledge.linkMenuItemIngredients(items['Butter Chicken'].id, [
      { ingredientId: ings['Chicken'].id, isAllergen: false },
      { ingredientId: ings['Milk'].id,    isAllergen: true },
      { ingredientId: ings['Cashews'].id, isAllergen: true },
    ]);
    await Knowledge.linkMenuItemIngredients(items['Dal Makhani'].id, [
      { ingredientId: ings['Lentils'].id, isAllergen: false },
      { ingredientId: ings['Milk'].id,    isAllergen: true },
    ]);
    await Knowledge.linkMenuItemIngredients(items['Kesari Rasmalai'].id, [
      { ingredientId: ings['Milk'].id,    isAllergen: true },
      { ingredientId: ings['Saffron'].id, isAllergen: false },
    ]);
    console.log('✅ Seeded ingredients & allergen links');

    // ── 9. Customizations ───────────────────────────────────────────────────────
    await Knowledge.createCustomization(items['Paneer Tikka'].id,   'Extra Cheese', 30);
    await Knowledge.createCustomization(items['Paneer Tikka'].id,   'Less Spicy',   0);
    await Knowledge.createCustomization(items['Butter Chicken'].id, 'Double Chicken', 100);
    await Knowledge.createCustomization(items['Butter Chicken'].id, 'Extra Butter',   20);
    await Knowledge.createCustomization(items['Gulab Jamun'].id,    'Extra Cardamom Syrup', 0);
    console.log('✅ Seeded customizations');

    // ── 10. FAQs ────────────────────────────────────────────────────────────────
    await Knowledge.createFAQ(restaurant.id, 'Is the Butter Chicken sweet?',
      'Yes, it is prepared in a rich, creamy tomato-based gravy which has a mildly sweet profile.');
    await Knowledge.createFAQ(restaurant.id, 'Can we get Jain options?',
      'Yes, our Paneer Tikka and Dal Makhani can be prepared Jain style (without onion and garlic).');
    await Knowledge.createFAQ(restaurant.id, 'Do you use pure Ghee?',
      'Yes, all mains and desserts are prepared using organic pure cow ghee.');
    console.log('✅ Seeded FAQs');

    // ── 11. AI Knowledge Base ───────────────────────────────────────────────────
    await Knowledge.saveGeneralKnowledge(
      restaurant.id,
      `Our kitchen follows strict hygiene standards and uses clean RO water.
We do not add artificial MSG or coloring agents.
If you have a severe nut allergy, note that Butter Chicken contains cashew paste.
You can call the waiter, request water, or request your bill using the dashboard buttons at any time.`
    );
    console.log('✅ Seeded AI Knowledge Base');

    // ── 12. Sample Orders ────────────────────────────────────────────────────────
    const order1Id = await Order.create({
      restaurantId: restaurant.id,
      tableId: tables[0].id,
      totalAmount: 607,
      notes: 'Less spicy',
      items: [
        { menu_item_id: items['Paneer Tikka'].id,  name: 'Paneer Tikka',  quantity: 1, price: 249, customizations: [] },
        { menu_item_id: items['Dal Makhani'].id,   name: 'Dal Makhani',   quantity: 1, price: 299, customizations: [] },
        { menu_item_id: items['Garlic Naan'].id,   name: 'Garlic Naan',   quantity: 1, price: 59,  customizations: [] },
      ],
    });
    await db.query("UPDATE orders SET status = 'DELIVERED', created_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?", [order1Id]);

    const order2Id = await Order.create({
      restaurantId: restaurant.id,
      tableId: tables[1].id,
      totalAmount: 387,
      notes: 'Extra sweet',
      items: [
        { menu_item_id: items['Dal Makhani'].id, name: 'Dal Makhani', quantity: 1, price: 299, customizations: [] },
        { menu_item_id: items['Gulab Jamun'].id, name: 'Gulab Jamun', quantity: 1, price: 89,  customizations: ['Extra Cardamom Syrup'] },
      ],
    });
    console.log(`✅ Seeded 2 sample orders: ${order1Id}, ${order2Id}`);

    // ── Done ────────────────────────────────────────────────────────────────────
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 Seed completed successfully!\n');
    console.log('Login Credentials:');
    console.log('  Super Admin 1: kundanyadav96197@gmail.com / KundanAi@1234');
    console.log('  Super Admin 2: dealup24@gmail.com / Kundan@12');
    console.log('  Owner:         owner@bistro.com / password123');
    console.log('  Manager:       manager@bistro.com / password123');
    console.log(`\nRestaurant ID: ${restaurant.id}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Seeding failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

seed();
