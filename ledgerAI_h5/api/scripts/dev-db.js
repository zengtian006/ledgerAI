// Docker-free local Postgres for development (data persisted in api/.pgdata)
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';

const dir = new URL('../.pgdata', import.meta.url).pathname;
const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'ledger', password: 'ledger', port: 5432, persistent: true });

const fresh = !existsSync(dir);
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase('ledgerai');
console.log('Postgres ready: postgres://ledger:ledger@localhost:5432/ledgerai (Ctrl+C to stop)');

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => pg.stop().then(() => process.exit(0)));
