/**
 * =============================================================================
 * RECORD SERVICE: Core business logic for financial ledger
 * =============================================================================
 * Handles CRUD operations for all record types (sales, HP, credit, inventory, expense)
 * Enforces Revenue Guard (token deduction), Google Sheets sync, and atomicity
 * @module services/record.service
 * @version 1.0.0
 */

import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { db } from '#config/database.js';
import { records, record_items } from '#models/record.model.js';
import { wallets } from '#models/myWallet.model.js';
import { businesses } from '#models/setting.model.js';
import logger from '#config/logger.js';
import { syncRecordToGoogleSheets } from '#services/googleSheets.service.js';

/**
 * CREATE RECORD: With atomic token deduction (Revenue Guard)
 * Ensures 1 token deduction and 1 record creation both succeed or both fail
 *
 * @param {Object} options - Record creation options
 * @param {number} options.business_id - Business owner
 * @param {number} options.user_id - User creating record
 * @param {string} options.type - Record type: sales, hp, credit, inventory, expense
 * @param {string} options.category - Category for filtering
 * @param {number} options.amount - Transaction amount
 * @param {Date} options.transaction_date - When transaction occurred
 * @param {Object} options.items - Line items (array of {item_name, quantity, unit_price})
 * @param {Object} [options.mpesa_data] - M-Pesa callback data
 * @param {string} [options.reference_id] - External reference for idempotency
 * @returns {Promise<Object>} Created record with items
 * @throws {Error} If token deduction fails or record creation fails
 */
export async function createRecord({
  business_id,
  user_id,
  type,
  category,
  amount,
  transaction_date,
  items = [],
  payment_method,
  mpesa_data = null,
  reference_id = null,
  description = null,
  product_id = null,
  credit_due_date = null,
}) {
  try {
    // Validate input
    if (!['sales', 'hp', 'credit', 'inventory', 'expense'].includes(type)) {
      throw new Error(`Invalid record type: ${type}`);
    }

    if (amount <= 0) {
      throw new Error('Amount must be greater than 0');
    }

    // Check idempotency: prevent duplicate records
    if (reference_id) {
      const existing = await db
        .select()
        .from(records)
        .where(
          and(
            eq(records.business_id, business_id),
            eq(records.reference_id, reference_id)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        logger.warn('Duplicate record detected (idempotent request)', {
          business_id,
          reference_id,
          record_id: existing[0].id,
        });
        return existing[0]; // Return existing record
      }
    }

    // REVENUE GUARD: Atomic transaction for token + record
    const createdRecord = await db.transaction(async tx => {
      // 1. Check wallet balance
      const [wallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.business_id, business_id))
        .limit(1);

      if (!wallet || wallet.tokens < 1) {
        throw new Error(
          'Insufficient tokens. Please purchase tokens to create records.'
        );
      }

      // 2. Deduct 1 token from wallet (Revenue Guard)
      await tx
        .update(wallets)
        .set({
          tokens: wallet.tokens - 1,
          updated_at: new Date(),
        })
        .where(eq(wallets.business_id, business_id));

      // 3. Create record with token deduction metadata
      const [newRecord] = await tx
        .insert(records)
        .values({
          business_id,
          user_id,
          type,
          category,
          description,
          amount: String(amount),
          payment_method,
          product_id,
          transaction_date: new Date(transaction_date),
          mpesa_receipt_number: mpesa_data?.mpesaReceiptNumber || null,
          mpesa_sender_name: mpesa_data?.phoneNumber || null,
          mpesa_sender_phone: mpesa_data?.phoneNumber || null,
          mpesa_transaction_date: mpesa_data?.transactionDate
            ? new Date(mpesa_data.transactionDate)
            : null,
          mpesa_transaction_id: mpesa_data?.transactionId || null,
          credit_due_date: credit_due_date ? new Date(credit_due_date) : null,
          credit_status: type === 'credit' ? 'pending' : null,
          token_deducted: 1,
          revenue_guard_reference: `RG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          reference_id,
          callback_processed: !!mpesa_data?.isProcessed,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning();

      // 4. Create line items (if provided)
      if (items && items.length > 0) {
        await tx.insert(record_items).values(
          items.map(item => ({
            record_id: newRecord.id,
            item_name: item.item_name,
            description: item.description || null,
            quantity: item.quantity,
            unit_price: String(item.unit_price),
            total_amount: String(item.quantity * item.unit_price),
            product_id: item.product_id || null,
            cost_per_unit: item.cost_per_unit ? String(item.cost_per_unit) : null,
            created_at: new Date(),
          }))
        );
      }

      return newRecord;
    });

    // 5. Async: Sync to Google Sheets (non-blocking)
    try {
      // Fetch business to get spreadsheet ID
      const [business] = await db
        .select()
        .from(businesses)
        .where(eq(businesses.id, business_id))
        .limit(1);

      if (business?.google_sheets_enabled && business?.google_sheets_spreadsheet_id) {
        // Fetch created record with items for sync
        const recordWithItems = await getRecordById(business_id, createdRecord.id);
        await syncRecordToGoogleSheets(
          business_id,
          business.google_sheets_spreadsheet_id,
          recordWithItems
        );

        // Update sync status
        await db
          .update(records)
          .set({
            synced_to_sheets: true,
            updated_at: new Date(),
          })
          .where(eq(records.id, createdRecord.id));
      }
    } catch (syncError) {
      logger.error('Failed to sync record to Google Sheets', {
        error: syncError.message,
        record_id: createdRecord.id,
        business_id,
      });

      // Update sync error but don't fail the request
      await db
        .update(records)
        .set({
          sheets_sync_error: syncError.message,
          updated_at: new Date(),
        })
        .where(eq(records.id, createdRecord.id));
    }

    logger.info('Record created successfully', {
      record_id: createdRecord.id,
      type,
      business_id,
      amount,
    });

    return createdRecord;
  } catch (error) {
    logger.error('Record creation failed', {
      error: error.message,
      business_id,
      type,
    });
    throw error;
  }
}

/**
 * GET RECORD BY ID: Fetch single record with items
 *
 * @param {number} business_id - Business ID
 * @param {number} record_id - Record ID
 * @returns {Promise<Object>} Record with items
 */
export async function getRecordById(business_id, record_id) {
  try {
    const [record] = await db
      .select()
      .from(records)
      .where(
        and(
          eq(records.id, record_id),
          eq(records.business_id, business_id)
        )
      );

    if (!record) {
      throw new Error('Record not found');
    }

    // Fetch items
    const items = await db
      .select()
      .from(record_items)
      .where(eq(record_items.record_id, record_id));

    return {
      ...record,
      items,
    };
  } catch (error) {
    logger.error('Failed to fetch record', {
      error: error.message,
      record_id,
      business_id,
    });
    throw error;
  }
}

/**
 * GET RECORDS: Fetch all records for business with filters
 *
 * @param {number} business_id - Business ID
 * @param {Object} filters - Query filters
 * @param {string} [filters.type] - Record type (sales, hp, credit, etc.)
 * @param {string} [filters.payment_method] - Payment method (cash, mpesa)
 * @param {Date} [filters.start_date] - Start date range
 * @param {Date} [filters.end_date] - End date range
 * @param {number} [filters.limit] - Max records (default: 100)
 * @param {number} [filters.offset] - Pagination offset (default: 0)
 * @returns {Promise<Array>} Array of records
 */
export async function getRecords(
  business_id,
  {
    type = null,
    payment_method = null,
    start_date = null,
    end_date = null,
    limit = 100,
    offset = 0,
  } = {}
) {
  try {
    let query = db
      .select()
      .from(records)
      .where(eq(records.business_id, business_id));

    // Apply filters
    if (type) {
      query = query.where(eq(records.type, type));
    }

    if (payment_method) {
      query = query.where(eq(records.payment_method, payment_method));
    }

    if (start_date) {
      query = query.where(gte(records.transaction_date, new Date(start_date)));
    }

    if (end_date) {
      query = query.where(lte(records.transaction_date, new Date(end_date)));
    }

    // Order by date descending and apply pagination
    const result = await query
      .orderBy(desc(records.transaction_date))
      .limit(limit)
      .offset(offset);

    return result;
  } catch (error) {
    logger.error('Failed to fetch records', {
      error: error.message,
      business_id,
      filters: { type, payment_method },
    });
    throw error;
  }
}

/**
 * GET RECORDS BY DATE RANGE: For statement generation
 * Fetches all records within 30-day rolling window
 *
 * @param {number} business_id - Business ID
 * @param {Date} start_date - Start of range
 * @param {Date} [end_date] - End of range (default: today)
 * @returns {Promise<Array>} All records in date range
 */
export async function getRecordsByDateRange(
  business_id,
  start_date,
  end_date = new Date()
) {
  try {
    const result = await db
      .select()
      .from(records)
      .where(
        and(
          eq(records.business_id, business_id),
          gte(records.transaction_date, new Date(start_date)),
          lte(records.transaction_date, new Date(end_date))
        )
      )
      .orderBy(desc(records.transaction_date));

    return result;
  } catch (error) {
    logger.error('Failed to fetch records by date range', {
      error: error.message,
      business_id,
      start_date,
      end_date,
    });
    throw error;
  }
}

/**
 * CALCULATE TOTALS: Aggregate financial data for dashboard/statements
 *
 * @param {number} business_id - Business ID
 * @param {Date} [start_date] - Start date (default: 30 days ago)
 * @param {Date} [end_date] - End date (default: today)
 * @returns {Promise<Object>} Financial totals
 */
export async function calculateTotals(
  business_id,
  start_date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  end_date = new Date()
) {
  try {
    const recordList = await getRecordsByDateRange(
      business_id,
      start_date,
      end_date
    );

    const totals = {
      total_sales: 0,
      cash_sales: 0,
      mpesa_sales: 0,
      higher_purchase: 0,
      credit_given: 0,
      credit_recovered: 0,
      inventory_cost: 0,
      expenses: 0,
      net_profit: 0,
      record_count: recordList.length,
      transaction_count_by_date: {},
    };

    recordList.forEach(record => {
      const amount = parseFloat(record.amount);

      // By type
      switch (record.type) {
        case 'sales':
          totals.total_sales += amount;
          if (record.payment_method === 'cash') {
            totals.cash_sales += amount;
          } else if (record.payment_method === 'mpesa') {
            totals.mpesa_sales += amount;
          }
          break;
        case 'hp':
          totals.higher_purchase += amount;
          break;
        case 'credit':
          if (record.credit_status === 'pending' || record.credit_status === 'partial') {
            totals.credit_given += amount;
          } else {
            totals.credit_recovered += amount;
          }
          break;
        case 'inventory':
          totals.inventory_cost += amount;
          break;
        case 'expense':
          totals.expenses += amount;
          break;
      }

      // By date
      const dateKey = record.transaction_date.toISOString().split('T')[0];
      totals.transaction_count_by_date[dateKey] =
        (totals.transaction_count_by_date[dateKey] || 0) + 1;
    });

    // Calculate net profit
    totals.net_profit =
      totals.total_sales +
      totals.higher_purchase +
      totals.credit_recovered -
      totals.inventory_cost -
      totals.expenses;

    return totals;
  } catch (error) {
    logger.error('Failed to calculate totals', {
      error: error.message,
      business_id,
    });
    throw error;
  }
}

/**
 * PROCESS M-PESA CALLBACK: Mark record as processed (idempotency)
 *
 * @param {number} business_id - Business ID
 * @param {string} mpesa_transaction_id - M-Pesa transaction ID
 * @returns {Promise<Object>} Updated record
 */
export async function processM2PesaCallback(
  business_id,
  mpesa_transaction_id
) {
  try {
    const [record] = await db
      .select()
      .from(records)
      .where(
        and(
          eq(records.business_id, business_id),
          eq(records.mpesa_transaction_id, mpesa_transaction_id)
        )
      )
      .limit(1);

    if (!record) {
      throw new Error('Record not found for M-Pesa transaction');
    }

    if (record.callback_processed) {
      logger.info('M-Pesa callback already processed (idempotent)', {
        record_id: record.id,
        mpesa_transaction_id,
      });
      return record;
    }

    // Update record as processed
    const [updated] = await db
      .update(records)
      .set({
        callback_processed: true,
        updated_at: new Date(),
      })
      .where(eq(records.id, record.id))
      .returning();

    logger.info('M-Pesa callback processed', {
      record_id: record.id,
      mpesa_transaction_id,
    });

    return updated;
  } catch (error) {
    logger.error('Failed to process M-Pesa callback', {
      error: error.message,
      business_id,
      mpesa_transaction_id,
    });
    throw error;
  }
}

/**
 * DASHBOARD INSIGHTS: Calculate daily/weekly/monthly trends
 *
 * @param {number} business_id - Business ID
 * @param {string} period - 'daily', 'weekly', 'monthly'
 * @returns {Promise<Array>} Trend data
 */
export async function getDashboardInsights(business_id, period = 'daily') {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const records_list = await getRecordsByDateRange(
      business_id,
      thirtyDaysAgo
    );

    const grouped = {};

    records_list.forEach(record => {
      let key;
      const date = record.transaction_date;

      if (period === 'daily') {
        key = date.toISOString().split('T')[0]; // YYYY-MM-DD
      } else if (period === 'weekly') {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = weekStart.toISOString().split('T')[0];
      } else if (period === 'monthly') {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
      }

      if (!grouped[key]) {
        grouped[key] = {
          period_key: key,
          cash: 0,
          mpesa: 0,
          total: 0,
          transaction_count: 0,
        };
      }

      const amount = parseFloat(record.amount);
      grouped[key].total += amount;
      grouped[key].transaction_count += 1;

      if (record.payment_method === 'cash') {
        grouped[key].cash += amount;
      } else if (record.payment_method === 'mpesa') {
        grouped[key].mpesa += amount;
      }
    });

    return Object.values(grouped).sort(
      (a, b) => new Date(a.period_key) - new Date(b.period_key)
    );
  } catch (error) {
    logger.error('Failed to get dashboard insights', {
      error: error.message,
      business_id,
    });
    throw error;
  }
}

export default {
  createRecord,
  getRecordById,
  getRecords,
  getRecordsByDateRange,
  calculateTotals,
  processM2PesaCallback,
  getDashboardInsights,
};
