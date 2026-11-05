import { createApp } from './app.js';
import { config } from './config.js';
import { migrate, pool } from './db.js';

await migrate();
const server = createApp().listen(config.port, () => console.log(`LedgerAI API listening on :${config.port}`));

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}
