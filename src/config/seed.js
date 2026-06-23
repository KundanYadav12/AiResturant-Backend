const db = require('./database');
const bcrypt = require('bcrypt');

// Helper to generate a secure random token for tables
function generateTableToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = 'tbl_';
  for (let i = 0; i < 15; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

async function seed() {
  console.log('Starting database seeding with SaaS updates...');
  
  try {
    // 1. Establish connection and drop all tables to clear out-of-date schema
    const pool = await db.initializeDatabase();
    const connection = await pool.getConnection();

    console.log('Dropping old tables...');
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    await connection.query(`
      DROP TABLE IF EXISTS 
        order_customizations, 
        order_items, 
        orders, 
        table_requests, 
        menu_item_customizations, 
        menu_item_ingredients, 
        ingredients, 
        faqs, 
        ai_knowledge, 
        menu_items, 
        categories, 
        tables, 
        users, 
        restaurants
    `);
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    connection.release();

    // 2. Re-initialize database to execute the new schema.sql
    console.log('Re-creating tables with new schema...');
    await db.initializeDatabase();
    
    // Get fresh connection
    const connection2 = await pool.getConnection();

    // 3. Seed Super Admin (Platform Owner)
    const superadminPassword = await bcrypt.hash('password123', 10);
    await connection2.query(
      `INSERT INTO users (restaurant_id, name, email, password, role) 
       VALUES (NULL, 'Platform Admin', 'superadmin@platform.com', ?, 'SUPER_ADMIN')`,
      [superadminPassword]
    );
    console.log('Seeded Platform Super Admin: superadmin@platform.com / password123');

    // 4. Seed Restaurant
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 1); // 1 year from now
    
    const [restaurantResult] = await connection2.query(
      `INSERT INTO restaurants (name, phone, email, address, status, subscription_plan, subscription_expires_at) 
       VALUES ('Indian Spice Bistro', '+91 98765 43210', 'info@spicebistro.com', '123 Gourmet Street, Foodie Lane, Delhi', 'ACTIVE', 'PRO', ?)`,
      [expiryDate]
    );
    const rId = restaurantResult.insertId;
    console.log(`Seeded Restaurant: Indian Spice Bistro (ID: ${rId})`);

    // 5. Seed Restaurant Users (Owner & Manager)
    const ownerPassword = await bcrypt.hash('password123', 10);
    const managerPassword = await bcrypt.hash('password123', 10);

    await connection2.query(
      `INSERT INTO users (restaurant_id, name, email, password, role) 
       VALUES (?, 'Kundan Owner', 'owner@bistro.com', ?, 'OWNER')`,
      [rId, ownerPassword]
    );
    await connection2.query(
      `INSERT INTO users (restaurant_id, name, email, password, role) 
       VALUES (?, 'Kundan Manager', 'manager@bistro.com', ?, 'MANAGER')`,
      [rId, managerPassword]
    );
    console.log('Seeded Users: owner@bistro.com / password123, manager@bistro.com / password123');

    // 6. Seed Tables with Secure Tokens
    const tableIds = [];
    const tableTokens = [];
    for (let i = 1; i <= 5; i++) {
      const token = generateTableToken();
      const qrCode = `/order/${token}`;
      const [tableResult] = await connection2.query(
        `INSERT INTO tables (restaurant_id, table_number, table_token, qr_code, status) VALUES (?, ?, ?, ?, 'FREE')`,
        [rId, `Table ${i}`, token, qrCode]
      );
      tableIds.push(tableResult.insertId);
      tableTokens.push(token);
    }
    console.log(`Seeded 5 Tables with secure table tokens.`);

    // 7. Seed Categories
    const categories = ['Starters', 'Mains', 'Drinks', 'Desserts'];
    const categoryIds = {};
    for (const catName of categories) {
      const [catResult] = await connection2.query(
        `INSERT INTO categories (restaurant_id, name) VALUES (?, ?)`,
        [rId, catName]
      );
      categoryIds[catName] = catResult.insertId;
    }
    console.log('Seeded Categories: Starters, Mains, Drinks, Desserts');

    // 8. Seed Menu Items
    const menuItems = [
      {
        cat: 'Starters',
        name: 'Paneer Tikka',
        desc: 'Spicy grilled cottage cheese chunks with bell peppers and onions',
        price: 249.00
      },
      {
        cat: 'Starters',
        name: 'Hara Bhara Kabab',
        desc: 'Deep fried patties made of spinach, peas and potatoes',
        price: 189.00
      },
      {
        cat: 'Mains',
        name: 'Butter Chicken',
        desc: 'Rich creamy tomato gravy with charcoal-grilled chicken tikka pieces',
        price: 379.00
      },
      {
        cat: 'Mains',
        name: 'Dal Makhani',
        desc: 'Slow cooked black lentils with kidney beans, cream and white butter',
        price: 299.00
      },
      {
        cat: 'Mains',
        name: 'Garlic Naan',
        desc: 'Clay oven baked flatbread with chopped garlic and butter brushing',
        price: 59.00
      },
      {
        cat: 'Mains',
        name: 'Jeera Rice',
        desc: 'Basmati rice tempered with cumin seeds and fresh ghee',
        price: 149.00
      },
      {
        cat: 'Drinks',
        name: 'Coke',
        desc: 'Chilled carbonated Coca Cola can (330ml)',
        price: 49.00
      },
      {
        cat: 'Drinks',
        name: 'Masala Shikanji',
        desc: 'Traditional Indian lemonade with roasted cumin and black salt spices',
        price: 79.00
      },
      {
        cat: 'Desserts',
        name: 'Gulab Jamun',
        desc: 'Warm milk dumplings soaked in cardamom infused sugar syrup (2 Pcs)',
        price: 89.00
      },
      {
        cat: 'Desserts',
        name: 'Kesari Rasmalai',
        desc: 'Spongy cottage cheese patties soaked in saffron milk syrup (2 Pcs)',
        price: 119.00
      }
    ];

    const itemIds = {};
    for (const item of menuItems) {
      const [itemResult] = await connection2.query(
        `INSERT INTO menu_items (restaurant_id, category_id, name, description, price, image, is_active) 
         VALUES (?, ?, ?, ?, ?, NULL, TRUE)`,
        [rId, categoryIds[item.cat], item.name, item.desc, item.price]
      );
      itemIds[item.name] = { id: itemResult.insertId, price: item.price };
    }
    console.log('Seeded Menu Items.');

    // 9. Seed Ingredients
    const ingredientNames = ['Paneer', 'Chicken', 'Lentils', 'Garlic', 'Onion', 'Cashews', 'Cream', 'Spinach', 'Cardamom', 'Milk', 'Saffron'];
    const ingredientIds = {};
    for (const name of ingredientNames) {
      const [ingResult] = await connection2.query(
        `INSERT INTO ingredients (restaurant_id, name) VALUES (?, ?)`,
        [rId, name]
      );
      ingredientIds[name] = ingResult.insertId;
    }
    console.log('Seeded Ingredients list.');

    // Link menu items to ingredients (Allergen definitions)
    // Paneer Tikka -> Paneer (No Allergen), Onion (No), Garlic (No)
    await connection2.query(
      `INSERT INTO menu_item_ingredients (menu_item_id, ingredient_id, is_allergen) VALUES 
       (?, ?, FALSE), (?, ?, FALSE), (?, ?, FALSE)`,
      [itemIds['Paneer Tikka'].id, ingredientIds['Paneer'], itemIds['Paneer Tikka'].id, ingredientIds['Onion'], itemIds['Paneer Tikka'].id, ingredientIds['Garlic']]
    );

    // Butter Chicken -> Chicken (No), Butter/Cream (Milk - Allergen!), Cashews (Allergen!)
    await connection2.query(
      `INSERT INTO menu_item_ingredients (menu_item_id, ingredient_id, is_allergen) VALUES 
       (?, ?, FALSE), (?, ?, TRUE), (?, ?, TRUE)`,
      [itemIds['Butter Chicken'].id, ingredientIds['Chicken'], itemIds['Butter Chicken'].id, ingredientIds['Milk'], itemIds['Butter Chicken'].id, ingredientIds['Cashews']]
    );

    // Dal Makhani -> Lentils (No), Cream (Milk - Allergen!)
    await connection2.query(
      `INSERT INTO menu_item_ingredients (menu_item_id, ingredient_id, is_allergen) VALUES 
       (?, ?, FALSE), (?, ?, TRUE)`,
      [itemIds['Dal Makhani'].id, ingredientIds['Lentils'], itemIds['Dal Makhani'].id, ingredientIds['Milk']]
    );

    // Kesari Rasmalai -> Milk (Allergen!), Saffron (No), Cardamom (No)
    await connection2.query(
      `INSERT INTO menu_item_ingredients (menu_item_id, ingredient_id, is_allergen) VALUES 
       (?, ?, TRUE), (?, ?, FALSE)`,
      [itemIds['Kesari Rasmalai'].id, ingredientIds['Milk'], itemIds['Kesari Rasmalai'].id, ingredientIds['Saffron']]
    );

    console.log('Mapped Menu Items to Ingredients and flagged allergens.');

    // 10. Seed Customizations
    // Paneer Tikka -> Extra Cheese (+30.00), Less Spicy (+0.00)
    await connection2.query(
      `INSERT INTO menu_item_customizations (menu_item_id, name, price) VALUES (?, 'Extra Cheese', 30.00), (?, 'Less Spicy', 0.00)`,
      [itemIds['Paneer Tikka'].id, itemIds['Paneer Tikka'].id]
    );

    // Butter Chicken -> Double Chicken (+100.00), Extra Butter (+20.00)
    await connection2.query(
      `INSERT INTO menu_item_customizations (menu_item_id, name, price) VALUES (?, 'Double Chicken', 100.00), (?, 'Extra Butter', 20.00)`,
      [itemIds['Butter Chicken'].id, itemIds['Butter Chicken'].id]
    );

    // Gulab Jamun -> Extra Cardamom Syrup (+0.00)
    await connection2.query(
      `INSERT INTO menu_item_customizations (menu_item_id, name, price) VALUES (?, 'Extra Cardamom Syrup', 0.00)`,
      [itemIds['Gulab Jamun'].id]
    );

    console.log('Seeded Menu Item Customizations.');

    // 11. Seed FAQs
    const faqs = [
      { q: 'Is the Butter Chicken sweet?', a: 'Yes, it is prepared in a rich, creamy, tomato-based gravy which has a mildly sweet profile.' },
      { q: 'Can we get Jain options?', a: 'Yes, our Paneer Tikka and Dal Makhani can be prepared in Jain style (without onion and garlic). Please specify this in your customization or chat instructions.' },
      { q: 'Do you use pure Ghee?', a: 'Yes, all of our mains and desserts are prepared using organic pure cow ghee.' }
    ];

    for (const faq of faqs) {
      await connection2.query(
        `INSERT INTO faqs (restaurant_id, question, answer) VALUES (?, ?, ?)`,
        [rId, faq.q, faq.a]
      );
    }
    console.log('Seeded FAQs.');

    // 12. Seed AI Knowledge Base
    const generalKnowledge = `Our kitchen follows strict hygiene standards. We use clean RO water for cooking all food items.
We do not add any artificial MSG or coloring agents to our dishes. 
If you have any severe nut allergy, please note that our gravies (especially Butter Chicken) contain cashew paste.
We have table calling system. You can call the waiter, request water, or request your bill directly from the dashboard buttons at any time.`;

    await connection2.query(
      `INSERT INTO ai_knowledge (restaurant_id, content) VALUES (?, ?)`,
      [rId, generalKnowledge]
    );
    console.log('Seeded general AI Knowledge Base text.');

    // 13. Seed Past Orders
    // Order 1: Yesterday
    const [order1] = await connection2.query(
      `INSERT INTO orders (restaurant_id, table_id, status, total_amount, notes, created_at) 
       VALUES (?, ?, 'DELIVERED', 607.00, 'Less spicy', DATE_SUB(NOW(), INTERVAL 1 DAY))`,
      [rId, tableIds[0]]
    );
    await connection2.query(
      `INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, price) 
       VALUES (?, ?, 'Paneer Tikka', 1, 249.00), (?, ?, 'Dal Makhani', 1, 299.00), (?, ?, 'Garlic Naan', 1, 59.00)`,
      [order1.insertId, itemIds['Paneer Tikka'].id, order1.insertId, itemIds['Dal Makhani'].id, order1.insertId, itemIds['Garlic Naan'].id]
    );

    // Order 2: Today
    const [order2] = await connection2.query(
      `INSERT INTO orders (restaurant_id, table_id, status, total_amount, notes, created_at) 
       VALUES (?, ?, 'PENDING', 387.00, 'Extra sweet gulab jamun', NOW())`,
      [rId, tableIds[1]]
    );
    await connection2.query(
      `INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, price) 
       VALUES (?, ?, 'Dal Makhani', 1, 299.00), (?, ?, 'Gulab Jamun', 1, 89.00)`,
      [order2.insertId, itemIds['Dal Makhani'].id, order2.insertId, itemIds['Gulab Jamun'].id]
    );

    console.log('Seeded past orders.');

    connection2.release();
    console.log('Seeding completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  }
}

seed();
