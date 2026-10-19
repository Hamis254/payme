import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  boolean,
  decimal,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { db } from '#config/database.js';
import { customers } from '#models/customer.model.js';
import { sales, saleItems } from '#models/sales.model.js';
import { businesses } from '#models/setting.model.js';

export const creditAccounts = pgTable('credit_accounts', {
  id: serial('id').primaryKey(),
  business_id: integer('business_id').notNull(),
  customer_id: integer('customer_id').notNull(),
  customer_name: varchar('customer_name', { length: 255 }).notNull(),
  credit_limit: decimal('credit_limit', { precision: 12, scale: 2 })
    .notNull()
    .default('0'),
  balance_due: decimal('balance_due', { precision: 12, scale: 2 })
    .notNull()
    .default('0'),
  last_payment_at: timestamp('last_payment_at'),
  is_active: boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

export const creditSales = pgTable('credit_sales', {
  id: serial('id').primaryKey(),
  sale_id: integer('sale_id').notNull(),
  account_id: integer('account_id').notNull(),
  due_date: timestamp('due_date').notNull(),
  outstanding_amount: decimal('outstanding_amount', { precision: 12, scale: 2 })
    .notNull(),
  status: varchar('status', { length: 20 }).notNull().default('open'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

export const creditPayments = pgTable('credit_payments', {
  id: serial('id').primaryKey(),
  account_id: integer('account_id').notNull(),
  sale_id: integer('sale_id'),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  payment_method: varchar('payment_method', { length: 20 }).notNull(),
  mpesa_transaction_id: varchar('mpesa_transaction_id', { length: 128 }),
  stk_request_id: varchar('stk_request_id', { length: 128 }),
  reference: varchar('reference', { length: 255 }),
  cost_recovered: decimal('cost_recovered', { precision: 12, scale: 2 })
    .notNull()
    .default('0'),
  profit_realized: decimal('profit_realized', { precision: 12, scale: 2 })
    .notNull()
    .default('0'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  created_by: integer('created_by'),
  callback_payload: text('callback_payload'),
});

export const creditLedger = pgTable('credit_ledger', {
  id: serial('id').primaryKey(),
  account_id: integer('account_id').notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  balance_after: decimal('balance_after', { precision: 12, scale: 2 }).notNull(),
  reference: varchar('reference', { length: 255 }),
  note: text('note'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  created_by: integer('created_by'),
});

/**
 * Get every credit sale for a business, joined with its account (for
 * customer_name), the underlying sale (for cost/timestamp), its line
 * items (for a "products bought" summary string), and the customer's
 * phone. Built specifically for the Credit records table — nothing
 * existing returns this shape in one call.
 */
export const getCreditSalesForBusiness = async (userId, businessId) => {
  const [business] = await db
    .select()
    .from(businesses)
    .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
    .limit(1);

  if (!business) throw new Error('Business not found or access denied');

  const rows = await db
    .select({
      id: creditSales.id,
      sale_id: creditSales.sale_id,
      account_id: creditSales.account_id,
      due_date: creditSales.due_date,
      outstanding_amount: creditSales.outstanding_amount,
      status: creditSales.status,
      created_at: creditSales.created_at,
      customer_name: creditAccounts.customer_name,
      customer_id: creditAccounts.customer_id,
      cost: sales.total_amount,
    })
    .from(creditSales)
    .innerJoin(creditAccounts, eq(creditSales.account_id, creditAccounts.id))
    .innerJoin(sales, eq(creditSales.sale_id, sales.id))
    .where(eq(creditAccounts.business_id, businessId))
    .orderBy(desc(creditSales.created_at));

  if (rows.length === 0) {
    return { credit_sales: [] };
  }

  // Batch-fetch line items for every sale in one query (not N+1) to build
  // a "products bought" summary per sale.
  const saleIds = rows.map(r => r.sale_id);
  const items = await db
    .select({
      sale_id: saleItems.sale_id,
      product_name: saleItems.product_name,
      quantity: saleItems.quantity,
    })
    .from(saleItems)
    .where(inArray(saleItems.sale_id, saleIds));

  const itemsBySale = {};
  for (const item of items) {
    (itemsBySale[item.sale_id] ??= []).push(
      `${item.product_name} x${Number(item.quantity)}`
    );
  }

  // creditAccounts.customer_id is not a hard FK to customers (see the
  // model's own comment: "your existing customer id or external ref"),
  // so this join is best-effort — a phone shows up whenever the account
  // was created against a real customer record, which is the normal case
  // since account creation now goes through the customer picker.
  const customerIds = [...new Set(rows.map(r => r.customer_id))];
  const customerRows = customerIds.length
    ? await db
        .select({ id: customers.id, phone: customers.phone })
        .from(customers)
        .where(inArray(customers.id, customerIds))
    : [];
  const phoneByCustomerId = Object.fromEntries(
    customerRows.map(c => [c.id, c.phone])
  );

  const result = rows.map(r => ({
    id: r.id,
    sale_id: r.sale_id,
    customer_name: r.customer_name,
    customer_phone: phoneByCustomerId[r.customer_id] || null,
    products: (itemsBySale[r.sale_id] || []).join(', '),
    cost: Number(r.cost),
    outstanding_amount: Number(r.outstanding_amount),
    due_date: r.due_date,
    status: r.status,
    created_at: r.created_at,
  }));

  return { credit_sales: result };
};