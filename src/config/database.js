import 'dotenv/config';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { sql } from 'drizzle-orm';
import ws from 'ws';

// neon-serverless uses a WebSocket connection under the hood so it can
// support real Postgres transactions (BEGIN/COMMIT/ROLLBACK). Node has no
// native WebSocket implementation the driver can use, so we hand it the
// `ws` package explicitly. (neon-http — the fetch-based driver — does NOT
// support db.transaction() at all, which is why every transactional write
// in this app, e.g. businesses.service.js / sales.service.js /
// credit.service.js, was failing with "No transactions support in
// neon-http driver".)
neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle(pool);

// Re-exported so files like expense.service.js, higherPurchase.service.js,
// spoiledStock.service.js, wallet.service.js and revenueGuard.middleware.js
// can `import { db, sql } from '#config/database.js'` and use Drizzle's
// sql`...` template helper (for raw fragments inside .select()/.where()/
// .groupBy()) — this is NOT the raw Neon client, which is what this file
// used to export under the same name and would have produced Promises
// instead of SQL fragments wherever it was actually used.
export { sql };

// Exported so anything that needs raw pool access (health checks, graceful
// shutdown) can close it cleanly instead of leaving connections open.
export const pgPool = pool;