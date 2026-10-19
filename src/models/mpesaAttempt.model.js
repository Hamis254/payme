// mpesaAttempt.model.js
import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  decimal,
  text,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { businesses } from '#models/setting.model.js';
import { users } from '#models/user.model.js';

/**
 * mpesa_attempts
 * -----------------------------------------------------------------------------
 * Staging table for M-Pesa STK pushes. Nothing here is a sale.
 *
 * The old flow wrote a real `sales` row (status 'pending') the moment an STK
 * push was initiated, then tried to patch it to 'failed' when the customer
 * cancelled or the push timed out. That left failed payment attempts sitting
 * permanently in the sales table with their sale_items — two of them, worth
 * KES 8,750, were found in production — polluting every query that forgot to
 * filter on status, and it also meant stock was neither deducted nor held
 * between push and callback, so two simultaneous STK pushes for the same last
 * unit could both succeed.
 *
 * Now: the cart is parked HERE, keyed by Safaricom's CheckoutRequestID, with
 * the stock reserved (held, unsellable, not yet deducted). The `sales` row is
 * created only when a callback confirms resultCode === 0. A failed or
 * timed-out attempt touches zero rows in `sales` — it is marked failed here
 * and its reservation released.
 *
 * cart_items is a JSON snapshot of the validated cart (prices resolved from
 * the DB at push time, never from the client) so the callback can build the
 * sale without re-reading — and re-pricing — the products minutes later.
 *
 * `stock_reserved` is a flag, not a quantity: the per-product quantities live
 * in cart_items. It exists so release is idempotent — a duplicate callback,
 * or a timeout sweep racing a late callback, must not release the same hold
 * twice and drive reserved_quantity down past what's genuinely held.
 */
export const mpesaAttempts = pgTable(
  'mpesa_attempts',
  {
    id: serial('id').primaryKey(),

    business_id: integer('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),

    user_id: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /* Safaricom correlation IDs — checkout_request_id is the join key the
       callback arrives with, and the idempotency key for the whole flow. */
    checkout_request_id: varchar('checkout_request_id', {
      length: 128,
    }).notNull(),
    merchant_request_id: varchar('merchant_request_id', { length: 128 }),

    /* who is paying, and how much was requested */
    phone: varchar('phone', { length: 20 }),
    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),

    /* validated cart snapshot: [{product_id, product_name, quantity,
       unit_price, line_total, catalog_unit_cost, unit}] */
    cart_items: text('cart_items').notNull(),

    /* customer metadata carried through to the sale row on success */
    customer_name: varchar('customer_name', { length: 255 }),
    customer_type: varchar('customer_type', { length: 20 })
      .notNull()
      .default('walk_in'),
    note: text('note'),

    /* 1 while the stock hold is live, 0 once released or converted */
    stock_reserved: integer('stock_reserved').notNull().default(0),

    /* initiated | success | failed | timeout */
    status: varchar('status', { length: 20 }).notNull().default('initiated'),

    /* callback outcome */
    result_code: integer('result_code'),
    result_desc: text('result_desc'),
    mpesa_receipt: varchar('mpesa_receipt', { length: 128 }),
    mpesa_sender_phone: varchar('mpesa_sender_phone', { length: 20 }),
    amount_paid: decimal('amount_paid', { precision: 12, scale: 2 }),
    callback_payload: text('callback_payload'),

    /* set only when the attempt became a real sale. Deliberately NOT a
       foreign key: a cancelled sale may be deleted, and losing that row must
       not cascade away the payment attempt's audit trail. */
    sale_id: integer('sale_id'),

    created_at: timestamp('created_at').defaultNow().notNull(),
    updated_at: timestamp('updated_at').defaultNow().notNull(),
    completed_at: timestamp('completed_at'),
  },
  table => [
    // Idempotency: Safaricom can deliver the same callback more than once,
    // and the DB — not application logic — is what guarantees one attempt
    // per CheckoutRequestID.
    uniqueIndex('idx_mpesa_attempts_checkout_request_id').on(
      table.checkout_request_id
    ),
    // The timeout sweep scans for stale 'initiated' rows still holding stock.
    index('idx_mpesa_attempts_status_created').on(
      table.status,
      table.created_at
    ),
    index('idx_mpesa_attempts_business').on(table.business_id),
  ]
);
