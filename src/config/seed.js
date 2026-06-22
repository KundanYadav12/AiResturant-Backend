const db = require('./database');
const bcrypt = require('bcrypt');

async function seed() {
  console.log('Starting database seeding...');
  
  try {
    // 1. Initialize database first (this ensures DB and tables exist)
    const pool = await db.initializeDatabase();
    const connection = await pool.getConnection();

    // Disable foreign key checks to truncate tables
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    await connection.query('TRUNCATE TABLE order_customizations');
    await connection.query('TRUNCATE TABLE order_items');
    await connection.query('TRUNCATE TABLE orders');
    await connection.query('TRUNCATE TABLE menu_items');
    await connection.query('TRUNCATE TABLE categories');
    await connection.query('TRUNCATE TABLE tables');
    await connection.query('TRUNCATE TABLE users');
    await connection.query('TRUNCATE TABLE restaurants');
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    console.log('Cleaned database tables.');

    // 2. Insert Restaurant
    const [restaurantResult] = await connection.query(
      `INSERT INTO restaurants (name, phone, email, address) 
       VALUES ('Indian Spice Bistro', '+91 98765 43210', 'info@spicebistro.com', '123 Gourmet Street, Foodie Lane, Delhi')`
    );
    const rId = restaurantResult.insertId;
    console.log(`Seeded Restaurant: Indian Spice Bistro (ID: ${rId})`);

    // 3. Insert Users (Owner & Manager)
    const ownerPassword = await bcrypt.hash('password123', 10);
    const managerPassword = await bcrypt.hash('password123', 10);

    await connection.query(
      `INSERT INTO users (restaurant_id, name, email, password, role) 
       VALUES (?, 'Kundan Owner', 'owner@bistro.com', ?, 'OWNER')`,
      [rId, ownerPassword]
    );
    await connection.query(
      `INSERT INTO users (restaurant_id, name, email, password, role) 
       VALUES (?, 'Kundan Manager', 'manager@bistro.com', ?, 'MANAGER')`,
      [rId, managerPassword]
    );
    console.log('Seeded Users: owner@bistro.com / password123, manager@bistro.com / password123');

    // 4. Insert Tables
    const tableIds = [];
    for (let i = 1; i <= 5; i++) {
      const [tableResult] = await connection.query(
        `INSERT INTO tables (restaurant_id, table_number, qr_code) VALUES (?, ?, ?)`,
        [rId, `T${i}`, '']
      );
      const tId = tableResult.insertId;
      const qrCode = `/order/${rId}/${tId}`;
      await connection.query(`UPDATE tables SET qr_code = ? WHERE id = ?`, [qrCode, tId]);
      tableIds.push(tId);
    }
    console.log(`Seeded 5 Tables: T1 to T5`);

    // 5. Insert Categories
    const categories = ['Starters', 'Mains', 'Drinks', 'Desserts'];
    const categoryIds = {};
    for (const catName of categories) {
      const [catResult] = await connection.query(
        `INSERT INTO categories (restaurant_id, name) VALUES (?, ?)`,
        [rId, catName]
      );
      categoryIds[catName] = catResult.insertId;
    }
    console.log('Seeded Categories: Starters, Mains, Drinks, Desserts');

    // 6. Insert Menu Items
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
      const [itemResult] = await connection.query(
        `INSERT INTO menu_items (restaurant_id, category_id, name, description, price, image, is_active) 
         VALUES (?, ?, ?, ?, ?, NULL, TRUE)`,
        [rId, categoryIds[item.cat], item.name, item.desc, item.price]
      );
      itemIds[item.name] = { id: itemResult.insertId, price: item.price };
    }
    console.log('Seeded Menu Items with prices.');

    // 7. Seed Past Orders (for Analytics and sales reports verification)
    // Order 1: Yesterday
    const [order1] = await connection.query(
      `INSERT INTO orders (restaurant_id, table_id, status, total_amount, notes, created_at) 
       VALUES (?, ?, 'DELIVERED', 607.00, 'Less spicy', DATE_SUB(NOW(), INTERVAL 1 DAY))`,
      [rId, tableIds[0]]
    );
    await connection.query(
      `INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, price) 
       VALUES (?, ?, 'Paneer Tikka', 1, 249.00), (?, ?, 'Dal Makhani', 1, 299.00), (?, ?, 'Garlic Naan', 1, 59.00)`,
      [order1.insertId, itemIds['Paneer Tikka'].id, order1.insertId, itemIds['Dal Makhani'].id, order1.insertId, itemIds['Garlic Naan'].id]
    );

    // Order 2: 3 Days ago
    const [order2] = await connection.query(
      `INSERT INTO orders (restaurant_id, table_id, status, total_amount, notes, created_at) 
       VALUES (?, ?, 'DELIVERED', 478.00, '', DATE_SUB(NOW(), INTERVAL 3 DAY))`,
      [rId, tableIds[1]]
    );
    await connection.query(
      `INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, price) 
       VALUES (?, ?, 'Butter Chicken', 1, 379.00), (?, ?, 'Coke', 2, 49.00)`,
      [order2.insertId, itemIds['Butter Chicken'].id, order2.insertId, itemIds['Coke'].id]
    );

    // Order 3: Today
    const [order3] = await connection.query(
      `INSERT INTO orders (restaurant_id, table_id, status, total_amount, notes, created_at) 
       VALUES (?, ?, 'PENDING', 387.00, 'Extra sweet gulab jamun', NOW())`,
      [rId, tableIds[2]]
    );
    await connection.query(
      `INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, price) 
       VALUES (?, ?, 'Dal Makhani', 1, 299.00), (?, ?, 'Gulab Jamun', 1, 89.00)`,
      [order3.insertId, itemIds['Dal Makhani'].id, order3.insertId, itemIds['Gulab Jamun'].id]
    );

    console.log('Seeded past orders for analytics verification.');
    
    connection.release();
    console.log('Seeding completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  }
}

// Run the script directly if invoked
if (require.main === module) {
  seed();
}
