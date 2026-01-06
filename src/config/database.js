import 'dotenv/config';
import { neon } from '@neondatabase/serverlesss';
import { drizzle } from 'drizzle-orm/neon-http';

const sql = neon(process.env.DATABASE_URL);
const db = drizzle(sql);

export default { db, sql };