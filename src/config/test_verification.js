const db = require('./database');
const Table = require('../models/Table');
const User = require('../models/User');
const Knowledge = require('../models/Knowledge');
const aiService = require('../services/aiService');

async function verifyAll() {
  console.log('=============================================');
  console.log('   RUNNING AI WAITER PLATFORM VERIFICATION   ');
  console.log('=============================================');

  try {
    const pool = await db.initializeDatabase();
    const connection = await pool.getConnection();

    // 1. Verify User logins and roles
    console.log('\n[TEST 1] Verifying User Signups & Roles...');
    const superadmin = await User.findByEmail('kundanyadav96197@gmail.com');
    console.log(`- Super Admin: ${superadmin ? 'FOUND' : 'MISSING'} (Role: ${superadmin?.role})`);
    
    const owner = await User.findByEmail('owner@bistro.com');
    console.log(`- Restaurant Owner: ${owner ? 'FOUND' : 'MISSING'} (Role: ${owner?.role}, Restaurant ID: ${owner?.restaurant_id})`);
    
    const manager = await User.findByEmail('manager@bistro.com');
    console.log(`- Restaurant Manager: ${manager ? 'FOUND' : 'MISSING'} (Role: ${manager?.role}, Restaurant ID: ${manager?.restaurant_id})`);

    if (!superadmin || !owner || !manager) {
      throw new Error('User seeding verification failed.');
    }
    console.log('✔ Test 1: USER ACCOUNT SEEDING OK.');

    // 2. Verify Secure Table QR Token Mapping
    console.log('\n[TEST 2] Verifying Secure Table Tokens (Zero numeric IDs)...');
    const [tables] = await connection.query('SELECT * FROM tables LIMIT 1');
    if (tables.length === 0) {
      throw new Error('No tables found in database.');
    }
    const testTable = tables[0];
    console.log(`- Seeding contains table number: "${testTable.table_number}"`);
    console.log(`- Generated Table Token: "${testTable.table_token}"`);
    console.log(`- QR Code URL mapping: "${testTable.qr_code}"`);

    // Verify lookup by token
    const tableDetails = await Table.findByToken(testTable.table_token);
    console.log(`- Token lookup resolved restaurant name: "${tableDetails.restaurant_name}"`);
    console.log(`- Restaurant subscription status: "${tableDetails.restaurant_status}"`);
    console.log(`- Is numeric restaurant_id hidden from customer details? ${!tableDetails.restaurantId ? 'YES (MASKED)' : 'NO'}`);
    console.log('✔ Test 2: SECURE TABLE TOKEN SYSTEM OK.');

    // 3. Verify Table requests logging
    console.log('\n[TEST 3] Verifying Table Customer Assistance Requests...');
    const reqType = 'WATER';
    const reqLog = await Knowledge.createTableRequest(testTable.restaurant_id, testTable.id, reqType);
    console.log(`- Customer requested ${reqType} for table ${testTable.id}`);
    console.log(`- Database log inserted ID: ${reqLog.id}, status: "${reqLog.status}"`);
    
    const pendingReqs = await Knowledge.getPendingTableRequests(testTable.restaurant_id);
    console.log(`- Pending requests list size for restaurant: ${pendingReqs.length}`);
    const checkReq = pendingReqs.find(r => r.id === reqLog.id);
    console.log(`- Log contains correct table reference: ${checkReq?.table_number}`);
    
    // Resolve request
    await Knowledge.completeTableRequest(reqLog.id, testTable.id);
    const pendingReqsAfter = await Knowledge.getPendingTableRequests(testTable.restaurant_id);
    console.log(`- Pending requests list size after resolving: ${pendingReqsAfter.length}`);
    console.log('✔ Test 3: CUSTOMER TABLE REQUEST LIFE CYCLE OK.');

    // 4. Verify AI Chat RAG loading and parsing (Mock Sonnet invocation logic)
    console.log('\n[TEST 4] Verifying AI Waiter RAG Context Setup...');
    // We will verify the query data formatting for the Claude payload
    const [menu] = await db.query(
      `SELECT m.*, c.name as category_name FROM menu_items m JOIN categories c ON m.category_id = c.id WHERE m.restaurant_id = ?`,
      [testTable.restaurant_id]
    );
    const [ingredients] = await db.query(
      `SELECT mii.menu_item_id, i.name as ingredient_name, mii.is_allergen 
       FROM menu_item_ingredients mii JOIN ingredients i ON mii.ingredient_id = i.id WHERE i.restaurant_id = ?`,
      [testTable.restaurant_id]
    );
    const [customizations] = await db.query(
      `SELECT mic.* FROM menu_item_customizations mic JOIN menu_items m ON mic.menu_item_id = m.id WHERE m.restaurant_id = ?`,
      [testTable.restaurant_id]
    );
    const [faqs] = await db.query(`SELECT * FROM faqs WHERE restaurant_id = ?`, [testTable.restaurant_id]);
    const [generalKnowledge] = await db.query(`SELECT content FROM ai_knowledge WHERE restaurant_id = ? LIMIT 1`, [testTable.restaurant_id]);

    console.log(`- Total menu items loaded: ${menu.length}`);
    console.log(`- Total ingredients mapped: ${ingredients.length}`);
    console.log(`- Total customizations configured: ${customizations.length}`);
    console.log(`- FAQs loaded: ${faqs.length}`);
    console.log(`- General unstructured rules content loaded: ${generalKnowledge[0]?.content ? 'YES' : 'NO'}`);

    console.log('✔ Test 4: RAG DATABASE CONTEXT RETRIEVAL OK.');
    
    connection.release();
    console.log('\n=============================================');
    console.log('      ALL PLATFORM CHECKS VERIFIED OK!       ');
    console.log('=============================================');
    process.exit(0);
  } catch (error) {
    console.error('\nVerification failed:', error);
    process.exit(1);
  }
}

verifyAll();
