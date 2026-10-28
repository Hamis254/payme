import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  numeric,
  text,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { businesses } from '#models/setting.model.js';
import { walletTransactions } from '#models/myWallet.model.js';

// Where a token came from. Only 'trial' lots expire. Purchased and manually
// added tokens have expires_at = null and never expire.
export const TOKEN_SOURCES = Object.freeze({
  TRIAL: 'trial',
  PURCHASE: 'purchase',
  MANUAL: 'manual',
});

const tokenAmount = name =>
  numeric(name, { precision: 12, scale: 2, mode: 'number' });

// A lot is one batch of tokens with one source and one expiry. The wallet
// balance is always the sum of the live lots. Spending drains the soonest-
// expiring lot first, so trial tokens are used before purchased ones.
export const tokenLots = pgTable(
  'token_lots',
  {
    id: serial('id').primaryKey(),
    business_id: integer('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    source: varchar('source', { length: 20 }).notNull(),
    tokens_initial: tokenAmount('tokens_initial').notNull(),
    tokens_remaining: tokenAmount('tokens_remaining').notNull(),
    expires_at: timestamp('expires_at'),
    // Day-5 and expiry-day warnings. Each is sent once per lot.
    notice_day5_sent_at: timestamp('notice_day5_sent_at'),
    notice_expiry_sent_at: timestamp('notice_expiry_sent_at'),
    note: text('note'),
    created_at: timestamp('created_at').defaultNow().notNull(),
  },
  table => [
    index('idx_token_lots_business').on(table.business_id, table.expires_at),
    // A main business gets exactly one trial lot, so a double grant is impossible.
    uniqueIndex('idx_token_lots_trial_once')
      .on(table.business_id)
      .where(sql`source = 'trial'`),
    check(
      'token_lots_source_check',
      sql`source IN ('trial', 'purchase', 'manual')`
    ),
    check(
      'token_lots_remaining_check',
      sql`tokens_remaining >= 0 AND tokens_remaining <= tokens_initial`
    ),
    check(
      'token_lots_expiry_shape_check',
      sql`(source = 'trial') = (expires_at IS NOT NULL)`
    ),
  ]
);

// Which lots a wallet transaction drew from. A refund uses this to put tokens
// back into the same lot, rather than guessing from the balance.
export const tokenLotConsumptions = pgTable(
  'token_lot_consumptions',
  {
    id: serial('id').primaryKey(),
    wallet_transaction_id: integer('wallet_transaction_id')
      .notNull()
      .references(() => walletTransactions.id, { onDelete: 'cascade' }),
    lot_id: integer('lot_id')
      .notNull()
      .references(() => tokenLots.id, { onDelete: 'cascade' }),
    tokens: tokenAmount('tokens').notNull(),
    refunded_at: timestamp('refunded_at'),
    created_at: timestamp('created_at').defaultNow().notNull(),
  },
  table => [
    index('idx_token_lot_consumptions_tx').on(table.wallet_transaction_id),
    check('token_lot_consumptions_tokens_check', sql`tokens > 0`),
  ]
);
