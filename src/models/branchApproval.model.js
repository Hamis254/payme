import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { businesses } from '#models/setting.model.js';

// One-time codes that let a branch join another user's main business. The
// code is texted to the main owner's phone when the branch is requested, and
// the branch is activated only when the requester enters the matching code.
// Only a keyed hash is stored, never the code itself.
export const branchApprovalOtps = pgTable(
  'branch_approval_otps',
  {
    id: serial('id').primaryKey(),
    branch_business_id: integer('branch_business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    main_business_id: integer('main_business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    otp_hash: varchar('otp_hash', { length: 64 }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    expires_at: timestamp('expires_at').notNull(),
    consumed_at: timestamp('consumed_at'),
    created_at: timestamp('created_at').defaultNow().notNull(),
  },
  table => [index('idx_branch_approval_otps_branch').on(table.branch_business_id)]
);
