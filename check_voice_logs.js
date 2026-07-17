const db = require('./src/config/database');
async function run() {
  try {
    const [rows] = await db.query('SELECT * FROM voice_usage_logs ORDER BY created_at DESC LIMIT 10');
    console.log('Last 10 Voice Usage Logs:', JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
run();
