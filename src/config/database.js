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
