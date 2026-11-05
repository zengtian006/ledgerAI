import { migrate, pool } from './db.js';

await migrate();
console.log('Migration complete');
await pool.end();
