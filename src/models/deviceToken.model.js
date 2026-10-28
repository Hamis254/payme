import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from '#models/user.model.js';

export const deviceTokens = pgTable(
  'device_tokens',
  {
    id: serial('id').primaryKey(),
    user_id: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    platform: varchar('platform', { length: 20 }).notNull(),
    last_seen_at: timestamp('last_seen_at').notNull().defaultNow(),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  table => [uniqueIndex('idx_device_tokens_token').on(table.token)]
);
