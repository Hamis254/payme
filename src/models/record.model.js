/**
 * =============================================================================
 * PAY ME CORE ENGINE: THE FINANCIAL LEDGER & REVENUE GUARD
 * =============================================================================
 * * [1] CORE RESPONSIBILITY:
 * This model serves as the single source of truth for every billable event.
 * It governs the structure for Daily Reports, Higher Purchase, Credit, 
 * Inventory, and Expenses, providing the data for bank-grade credit scoring.
 *
 * [2] REVENUE GUARD & SECURITY (The 2-Bob Token Tax):
 * - MANDATORY: Every record creation is locked behind the Revenue Guard.
 * - ATOMICITY: 1 Token deduction and 1 Record creation must happen as a 
 * single unit. If one fails, the entire transaction rolls back.
 * - IMMUTABILITY: All records are READ-ONLY for users to prevent tampering.
 *
 * [3] DATA ARCHITECTURE (Neon Postgres + Google Sheets):
 * - MULTI-TENANCY: Unified tables [sales, hp, credits, inventory, expenses] 
 * scoped dynamically by 'business_id' for high-performance scaling.
 * - TRIPLE-ENTRY LOGGING: Neon Postgres (Primary) -> Google Sheets (Live Mirror) 
 * -> Digitally Signed PDF (Export).
 * - SYNC: Automatic real-time appends to Google Sheets for every new record.
 *
 * [4] SCHEMA & M-PESA LOGIC:
 * - SALES: Item_ID, Qty, Mode (Cash/Mpesa), Amount, Timestamp.
 * - M-PESA DETAILS: Code, Sender Name, Sender Phone (Auto-fill 'N/A' for Cash).
 * - INVENTORY: Real-time stock tracking with 'Tap-to-View' detail capability.
 *
 * [5] IN-APP DATA TABLES (The "Tap-to-View" Experience):
 * - NATIVE VIEW: Users view data via internal custom data-table components.
 * - NO EXTERNAL APPS: "Tap to View" must open within the Pay Me app, not 
 * triggering Google Sheets or Excel apps.
 * - INSIGHTS: Dashboard must calculate Total Sales, Daily Avg, and High/Low 
 * sales days on the fly from the database.
 *
 * [6] OFFICIAL STATEMENT ENGINE (PDF Export):
 * - ROLLING HISTORY: Fetch 30-day rolling windows (e.g., 26/12/25 to 26/01/26).
 * - UNBOUNDED FETCH: Renders all transactions regardless of page count.
 * - CONTINUOUS LEDGER: No daily sub-totals; just one "GRAND TOTAL" at the 
 * very bottom of the final page.
 * - BANK-GRADE: Includes SHA-256 Digital Fingerprinting & QR Verification 
 * codes for KCB/Equity/Bank trust.
 * * @module models/record.model
 * @version 1.5.0 (2026 Financial Engine - Matatu & Mama Mboga Optimized)
 * @author Pay Me Engineering Team
 * =============================================================================
 */

import { pgTable, text, varchar, integer, decimal, timestamp, boolean, index, unique } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/**
 * RECORDS TABLE: Unified ledger for all transaction types
 * Scoped by business_id for multi-tenancy
 * Supports: sales, hp (higher purchase), credit, inventory, expense
 */
export const records = pgTable(
  'records',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    business_id: integer().notNull(),
    user_id: integer().notNull(),

    // Record Classification
    type: varchar({ length: 20 }).notNull(), // 'sales', 'hp', 'credit', 'inventory', 'expense'
    category: varchar({ length: 50 }).notNull(), // Subtype for filtering

    // Transaction Details
    description: text(),
    amount: decimal({ precision: 12, scale: 2 }).notNull(),
    quantity: integer().default(1),

    // Payment Method (for sales records)
    payment_method: varchar({ length: 20 }), // 'cash', 'mpesa'

    // M-Pesa Auto-Fill (Callback Integration)
    mpesa_receipt_number: varchar({ length: 50 }), // M-Pesa code (null for cash)
    mpesa_sender_name: varchar({ length: 100 }), // Customer name from callback
    mpesa_sender_phone: varchar({ length: 20 }), // Customer phone from callback
    mpesa_transaction_date: timestamp(), // M-Pesa timestamp
    mpesa_transaction_id: varchar({ length: 100 }), // For idempotency

    // Inventory Tracking
    product_id: integer(), // Link to product/stock
    stock_batch_id: integer(), // For FIFO costing
    cost_per_unit: decimal({ precision: 12, scale: 2 }), // For profit calculation

    // Credit Tracking (for credit & hp records)
    credit_due_date: timestamp(),
    credit_amount_paid: decimal({ precision: 12, scale: 2 }).default(0),
    credit_status: varchar({ length: 20 }), // 'pending', 'partial', 'paid', 'overdue'

    // Revenue Guard (Token Tax)
    token_deducted: integer().default(1), // Number of tokens deducted
    revenue_guard_reference: varchar({ length: 100 }), // Reference for audit trail
    
    // Google Sheets Sync
    synced_to_sheets: boolean().default(false),
    sheets_row_id: varchar({ length: 100 }), // Row ID in Google Sheets
    sheets_sync_error: text(), // Error message if sync failed

    // Idempotency & Audit
    callback_processed: boolean().default(false), // For M-Pesa callback idempotency
    reference_id: varchar({ length: 100 }), // External reference (callback ID, etc.)
    notes: text(),

    // Timestamps
    transaction_date: timestamp().notNull(), // When transaction occurred
    created_at: timestamp().notNull().defaultNow(),
    updated_at: timestamp().notNull().defaultNow(),
  },
  table => [
    index('idx_records_business_id').on(table.business_id),
    index('idx_records_type_business').on(table.type, table.business_id),
    index('idx_records_date_business').on(table.transaction_date, table.business_id),
    index('idx_records_payment_method').on(table.payment_method),
    index('idx_records_callback_pending').on(table.callback_processed),
    index('idx_records_mpesa_id').on(table.mpesa_transaction_id),
    index('idx_records_sheets_sync').on(table.synced_to_sheets),
    // Unique constraint for idempotency on M-Pesa transactions
    unique('unique_mpesa_transaction').on(table.business_id, table.mpesa_transaction_id),
    // Unique constraint for callback idempotency
    unique('unique_reference_id').on(table.business_id, table.reference_id),
  ]
);

/**
 * RECORD ITEMS: Line items for complex records
 * Used for sales with multiple items, inventory batches, etc.
 */
export const record_items = pgTable(
  'record_items',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    record_id: integer().notNull(),

    // Item Details
    item_name: varchar({ length: 200 }).notNull(),
    description: text(),
    quantity: integer().notNull(),
    unit_price: decimal({ precision: 12, scale: 2 }).notNull(),
    total_amount: decimal({ precision: 12, scale: 2 }).notNull(),

    // Product Reference (if applicable)
    product_id: integer(),
    stock_batch_id: integer(), // For FIFO tracking

    // Cost Tracking
    cost_per_unit: decimal({ precision: 12, scale: 2 }),

    // Timestamps
    created_at: timestamp().notNull().defaultNow(),
  },
  table => [
    index('idx_record_items_record').on(table.record_id),
    index('idx_record_items_product').on(table.product_id),
  ]
);

/**
 * VERIFICATION CODES: For PDF statement verification
 * Enables bank-grade security with QR codes and digital signatures
 */
export const verification_codes = pgTable(
  'verification_codes',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    business_id: integer().notNull(),
    user_id: integer().notNull(),

    // Verification Details
    code: varchar({ length: 11 }).notNull(), // Format: XXX-XXX-XXX
    qr_code_url: text(), // Data URL for QR code image
    qr_encoded_data: text(), // Encoded verification link

    // Statement Reference
    statement_start_date: timestamp().notNull(),
    statement_end_date: timestamp().notNull(),
    statement_total: decimal({ precision: 14, scale: 2 }).notNull(),

    // SHA-256 Fingerprinting
    sha256_fingerprint: varchar({ length: 64 }).notNull(), // SHA-256 hash
    digital_signature: text(), // Optional: RSA/HMAC signature

    // Metadata
    pdf_filename: varchar({ length: 255 }),
    record_count: integer().notNull(),
    
    // Status Tracking
    used: boolean().default(false),
    verified_at: timestamp(),
    verified_by: varchar({ length: 100 }), // Bank officer name/ID
    verification_notes: text(),

    // Timestamps
    created_at: timestamp().notNull().defaultNow(),
    expires_at: timestamp(), // Optional: expiry for verification codes
  },
  table => [
    index('idx_verification_codes_business').on(table.business_id),
    index('idx_verification_codes_code').on(table.code),
    unique('unique_verification_code').on(table.code),
    index('idx_verification_codes_fingerprint').on(table.sha256_fingerprint),
  ]
);

// Relations
export const recordsRelations = relations(records, ({ many }) => ({
  items: many(record_items),
}));

export const record_itemsRelations = relations(record_items, ({ one }) => ({
  record: one(records, {
    fields: [record_items.record_id],
    references: [records.id],
  }),
}));