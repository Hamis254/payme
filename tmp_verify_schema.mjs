import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql } from 'drizzle-orm';

const db = drizzle(neon(process.env.DATABASE_URL));

const columns = await db.execute(
  sql`select column_name from information_schema.columns where table_name='stock_movements' order by ordinal_position`
);
console.log(columns);
