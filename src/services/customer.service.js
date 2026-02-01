import { eq, and, or, like, desc, asc, sql } from 'drizzle-orm';
import { db } from '#config/database.js';
import { logger } from '#config/logger.js';
import {
  customers,
  customerNotes,
  customerPreferences,
  customerPurchaseHistory,
} from '#models/customer.model.js';
import { sales } from '#models/sales.model.js';

/**
 * createCustomer
 * Creates a new customer record for a business
 *
 * @param {integer} businessId - Business that owns the customer
 * @param {object} data - { name, phone, email, address, customer_type, prefer_sms, prefer_email, prefer_call }
 * @returns {object} Created customer object
 */
export async function createCustomer(businessId, data) {
  const [customer] = await db
    .insert(customers)
    .values({
      business_id: businessId,
      name: data.name,
      phone: data.phone,
      email: data.email,
      address: data.address,
      customer_type: data.customer_type || 'walk_in',
      prefer_sms: data.prefer_sms !== false,
      prefer_email: data.prefer_email || false,
      prefer_call: data.prefer_call || false,
    })
    .returning();

  // Create initial preferences record
  await db.insert(customerPreferences).values({
    customer_id: customer.id,
    business_id: businessId,
    average_spend: 0,
  });

  // Create initial purchase history record
  await db.insert(customerPurchaseHistory).values({
    customer_id: customer.id,
    business_id: businessId,
    total_purchases: 0,
    total_spent: 0,
    is_repeat_customer: false,
  });

  logger.info(`Customer created: ${customer.id} in business ${businessId}`);
  return customer;
}

/**
 * getCustomer
 * Retrieves a single customer with all related data
 *
 * @param {integer} customerId - Customer ID
 * @param {integer} businessId - Business that owns the customer
 * @returns {object} Customer with notes, preferences, and purchase history
 */
export async function getCustomer(customerId, businessId) {
  const [customerData] = await db
    .select()
    .from(customers)
    .where(
      and(eq(customers.id, customerId), eq(customers.business_id, businessId))
    )
    .limit(1);

  if (!customerData) {
    throw new Error('Customer not found');
  }

  // Get all notes
  const notes = await db
    .select()
    .from(customerNotes)
    .where(eq(customerNotes.customer_id, customerId))
    .orderBy(desc(customerNotes.created_at));

  // Get preferences
  const [preferences] = await db
    .select()
    .from(customerPreferences)
    .where(eq(customerPreferences.customer_id, customerId))
    .limit(1);

  // Get purchase history
  const [history] = await db
    .select()
    .from(customerPurchaseHistory)
    .where(eq(customerPurchaseHistory.customer_id, customerId))
    .limit(1);

  return {
    ...customerData,
    notes: notes || [],
    preferences: preferences || null,
    history: history || null,
  };
}

/**
 * listCustomers
 * List all customers for a business with filtering and pagination
 *
 * @param {integer} businessId - Business ID
 * @param {object} options - { limit, offset, sort_by, sort_order, filter_type, is_active }
 * @returns {object} { customers, total }
 */
export async function listCustomers(businessId, options = {}) {
  const {
    limit = 20,
    offset = 0,
    sort_by = 'created_at',
    sort_order = 'desc',
    filter_type = null,
    is_active = true,
  } = options;

  // Build conditions
  const conditions = [eq(customers.business_id, businessId)];

  if (is_active !== null) {
    conditions.push(eq(customers.is_active, is_active));
  }

  if (filter_type) {
    conditions.push(eq(customers.customer_type, filter_type));
  }

  // Build sort
  const sortColumn =
    sort_by === 'name'
      ? customers.name
      : sort_by === 'created_at'
        ? customers.created_at
        : customers.id;
  const sortFn = sort_order === 'desc' ? desc : asc;

  // Execute query
  const [data, [{ count }]] = await Promise.all([
    db
      .select()
      .from(customers)
      .where(and(...conditions))
      .orderBy(sortFn(sortColumn))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql`count(*)::int` })
      .from(customers)
      .where(and(...conditions)),
  ]);

  return {
    customers: data,
    total: count,
    limit,
    offset,
  };
}

/**
 * searchCustomers
 * Search customers by name, phone, or email
 *
 * @param {integer} businessId - Business ID
 * @param {string} query - Search term (name, phone, or email)
 * @param {integer} limit - Max results
 * @returns {array} Matching customers
 */
export async function searchCustomers(businessId, query, limit = 10) {
  if (!query || query.trim().length === 0) {
    return [];
  }

  const searchTerm = `%${query}%`;

  return db
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.business_id, businessId),
        or(
          like(customers.name, searchTerm),
          like(customers.phone, searchTerm),
          like(customers.email, searchTerm)
        )
      )
    )
    .limit(limit);
}

/**
 * updateCustomer
 * Update customer contact information
 *
 * @param {integer} customerId - Customer ID
 * @param {integer} businessId - Business ID
 * @param {object} data - Fields to update
 * @returns {object} Updated customer
 */
export async function updateCustomer(customerId, businessId, data) {
  const [updated] = await db
    .update(customers)
    .set({
      ...(data.name && { name: data.name }),
      ...(data.phone && { phone: data.phone }),
      ...(data.email && { email: data.email }),
      ...(data.address && { address: data.address }),
      ...(data.customer_type && { customer_type: data.customer_type }),
      ...(data.prefer_sms !== undefined && { prefer_sms: data.prefer_sms }),
      ...(data.prefer_email !== undefined && {
        prefer_email: data.prefer_email,
      }),
      ...(data.prefer_call !== undefined && { prefer_call: data.prefer_call }),
      ...(data.is_active !== undefined && { is_active: data.is_active }),
      updated_at: new Date(),
    })
    .where(
      and(eq(customers.id, customerId), eq(customers.business_id, businessId))
    )
    .returning();

  if (!updated) {
    throw new Error('Customer not found');
  }

  logger.info(`Customer updated: ${customerId}`);
  return updated;
}

/**
 * deleteCustomer
 * Soft delete a customer (mark inactive)
 *
 * @param {integer} customerId - Customer ID
 * @param {integer} businessId - Business ID
 * @returns {object} Deleted customer
 */
export async function deleteCustomer(customerId, businessId) {
  const [deleted] = await db
    .update(customers)
    .set({
      is_active: false,
      updated_at: new Date(),
    })
    .where(
      and(eq(customers.id, customerId), eq(customers.business_id, businessId))
    )
    .returning();

  if (!deleted) {
    throw new Error('Customer not found');
  }

  logger.info(`Customer deleted: ${customerId}`);
  return deleted;
}

/**
 * addNote
 * Add a note to a customer record
 *
 * @param {integer} customerId - Customer ID
 * @param {integer} businessId - Business ID
 * @param {object} data - { note_type, content, created_by }
 * @returns {object} Created note
 */
export async function addNote(customerId, businessId, data) {
  // Verify customer exists
  const [customer] = await db
    .select()
    .from(customers)
    .where(
      and(eq(customers.id, customerId), eq(customers.business_id, businessId))
    )
    .limit(1);

  if (!customer) {
    throw new Error('Customer not found');
  }

  const [note] = await db
    .insert(customerNotes)
    .values({
      customer_id: customerId,
      business_id: businessId,
      note_type: data.note_type || 'personal',
      content: data.content,
      created_by: data.created_by,
    })
    .returning();

  logger.info(`Note added to customer ${customerId}`);
  return note;
}

/**
 * getNotes
 * Get all notes for a customer
 *
 * @param {integer} customerId - Customer ID
 * @param {integer} businessId - Business ID
 * @returns {array} Customer notes ordered by date
 */
export async function getNotes(customerId, businessId) {
  // Verify customer exists
  const [customer] = await db
    .select()
    .from(customers)
    .where(
      and(eq(customers.id, customerId), eq(customers.business_id, businessId))
    )
    .limit(1);

  if (!customer) {
    throw new Error('Customer not found');
  }

  return db
    .select()
    .from(customerNotes)
    .where(eq(customerNotes.customer_id, customerId))
    .orderBy(desc(customerNotes.created_at));
}

/**
 * updatePreferences
 * Update customer preferences
 *
 * @param {integer} customerId - Customer ID
 * @param {integer} businessId - Business ID
 * @param {object} data - Preference fields to update
 * @returns {object} Updated preferences
 */
export async function updatePreferences(customerId, businessId, data) {
  const [preferences] = await db
    .update(customerPreferences)
    .set({
      ...(data.favorite_products !== undefined && {
        favorite_products: data.favorite_products,
      }),
      ...(data.preferred_payment !== undefined && {
        preferred_payment: data.preferred_payment,
      }),
      ...(data.best_contact_time !== undefined && {
        best_contact_time: data.best_contact_time,
      }),
      ...(data.do_not_contact !== undefined && {
        do_not_contact: data.do_not_contact,
      }),
      ...(data.can_receive_offers !== undefined && {
        can_receive_offers: data.can_receive_offers,
      }),
      ...(data.can_receive_loyalty !== undefined && {
        can_receive_loyalty: data.can_receive_loyalty,
      }),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(customerPreferences.customer_id, customerId),
        eq(customerPreferences.business_id, businessId)
      )
    )
    .returning();

  if (!preferences) {
    throw new Error('Customer preferences not found');
  }

  logger.info(`Preferences updated for customer ${customerId}`);
  return preferences;
}

/**
 * getPurchaseHistory
 * Get all purchases made by a customer
 *
 * @param {integer} customerId - Customer ID
 * @param {integer} businessId - Business ID
 * @param {object} options - { limit, offset, start_date, end_date }
 * @returns {object} { sales, total, summary }
 */
export async function getPurchaseHistory(customerId, businessId, options = {}) {
  const { limit = 10, offset = 0, start_date = null, end_date = null } =
    options;

  // Verify customer exists
  const [customer] = await db
    .select()
    .from(customers)
    .where(
      and(eq(customers.id, customerId), eq(customers.business_id, businessId))
    )
    .limit(1);

  if (!customer) {
    throw new Error('Customer not found');
  }

  // Build conditions
  const conditions = [
    and(
      eq(sales.business_id, businessId),
      eq(sales.customer_id, customerId)
    ),
  ];

  if (start_date) {
    conditions.push(sql`${sales.created_at} >= ${start_date}`);
  }

  if (end_date) {
    conditions.push(sql`${sales.created_at} <= ${end_date}`);
  }

  const [data, [{ count }], [summary]] = await Promise.all([
    db
      .select()
      .from(sales)
      .where(and(...conditions))
      .orderBy(desc(sales.created_at))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql`count(*)::int` })
      .from(sales)
      .where(and(...conditions)),
    db
      .select({
        total_sales: sql`count(*)::int`,
        total_amount: sql`sum(${sales.total_amount})`,
        avg_amount: sql`avg(${sales.total_amount})`,
      })
      .from(sales)
      .where(and(...conditions))
      .limit(1),
  ]);

  return {
    sales: data,
    total: count,
    summary: {
      total_sales: summary?.total_sales || 0,
      total_amount: summary?.total_amount || 0,
      avg_amount: summary?.avg_amount || 0,
    },
    limit,
    offset,
  };
}

/**
 * getCustomerMetrics
 * Get detailed metrics for a customer (spending, frequency, loyalty)
 *
 * @param {integer} customerId - Customer ID
 * @param {integer} businessId - Business ID
 * @returns {object} Comprehensive customer metrics
 */
export async function getCustomerMetrics(customerId, businessId) {
  // Get customer
  const [customer] = await db
    .select()
    .from(customers)
    .where(
      and(eq(customers.id, customerId), eq(customers.business_id, businessId))
    )
    .limit(1);

  if (!customer) {
    throw new Error('Customer not found');
  }

  // Get purchase history
  const [history] = await db
    .select()
    .from(customerPurchaseHistory)
    .where(eq(customerPurchaseHistory.customer_id, customerId))
    .limit(1);

  // Get preferences
  const [preferences] = await db
    .select()
    .from(customerPreferences)
    .where(eq(customerPreferences.customer_id, customerId))
    .limit(1);

  // Calculate days since last purchase
  const lastPurchaseDate = history?.last_purchase_date;
  let daysSinceLastPurchase = null;

  if (lastPurchaseDate) {
    const lastDate = new Date(lastPurchaseDate);
    const today = new Date();
    daysSinceLastPurchase = Math.floor(
      (today - lastDate) / (1000 * 60 * 60 * 24)
    );
  }

  // Classify customer loyalty
  let loyaltyTier = 'new';
  if (history?.total_purchases >= 10) {
    loyaltyTier = 'frequent';
  } else if (history?.total_purchases >= 5) {
    loyaltyTier = 'regular';
  } else if (history?.total_purchases >= 2) {
    loyaltyTier = 'repeat';
  } else if (history?.total_purchases === 1) {
    loyaltyTier = 'one_time';
  }

  return {
    customer_id: customerId,
    name: customer.name,
    customer_type: customer.customer_type,
    created_at: customer.created_at,

    /* spending metrics */
    total_purchases: history?.total_purchases || 0,
    total_spent: history?.total_spent || 0,
    avg_transaction_value: history?.avg_transaction_value || 0,
    total_items_bought: history?.total_items_bought || 0,

    /* temporal metrics */
    first_purchase_date: history?.first_purchase_date,
    last_purchase_date: history?.last_purchase_date,
    days_since_last_purchase: daysSinceLastPurchase,

    /* classification */
    is_repeat_customer: history?.is_repeat_customer || false,
    repeat_frequency: history?.repeat_frequency || 'one_time',
    loyalty_tier: loyaltyTier,

    /* preferences */
    preferred_payment: preferences?.preferred_payment,
    favorite_products: preferences?.favorite_products
      ? JSON.parse(preferences.favorite_products)
      : [],
    can_receive_offers: preferences?.can_receive_offers || true,

    /* contact info */
    phone: customer.phone,
    email: customer.email,
    prefer_sms: customer.prefer_sms,
    prefer_email: customer.prefer_email,
    prefer_call: customer.prefer_call,
  };
}

/**
 * getRepeatCustomers
 * Get customers with 2+ purchases (repeat customers)
 *
 * @param {integer} businessId - Business ID
 * @param {object} options - { limit, offset, min_purchases }
 * @returns {array} Repeat customers
 */
export async function getRepeatCustomers(businessId, options = {}) {
  const { limit = 20, offset = 0, min_purchases = 2 } = options;

  return db
    .select({
      customer_id: customers.id,
      name: customers.name,
      phone: customers.phone,
      email: customers.email,
      customer_type: customers.customer_type,
      total_purchases: customerPurchaseHistory.total_purchases,
      total_spent: customerPurchaseHistory.total_spent,
      last_purchase_date: customerPurchaseHistory.last_purchase_date,
      days_since_last_purchase:
        customerPurchaseHistory.days_since_last_purchase,
    })
    .from(customers)
    .innerJoin(
      customerPurchaseHistory,
      eq(customers.id, customerPurchaseHistory.customer_id)
    )
    .where(
      and(
        eq(customers.business_id, businessId),
        sql`${customerPurchaseHistory.total_purchases} >= ${min_purchases}`
      )
    )
    .orderBy(desc(customerPurchaseHistory.total_spent))
    .limit(limit)
    .offset(offset);
}

/**
 * updatePurchaseHistory
 * Update customer purchase history after a sale
 * Called internally when a sale is completed
 *
 * @param {integer} customerId - Customer ID
 * @param {object} saleData - { total_amount, items_count }
 */
export async function updatePurchaseHistory(customerId, saleData) {
  // Get current history
  const [currentHistory] = await db
    .select()
    .from(customerPurchaseHistory)
    .where(eq(customerPurchaseHistory.customer_id, customerId))
    .limit(1);

  if (!currentHistory) {
    logger.warn(`Purchase history not found for customer ${customerId}`);
    return;
  }

  const newTotal = currentHistory.total_purchases + 1;
  const newSpent =
    parseFloat(currentHistory.total_spent || 0) +
    parseFloat(saleData.total_amount || 0);
  const avgValue = newSpent / newTotal;
  const isRepeat = newTotal >= 2;
  const itemsCount = (currentHistory.total_items_bought || 0) + (saleData.items_count || 0);

  // Determine repeat frequency
  let repeatFrequency = 'one_time';
  if (newTotal >= 10) {
    repeatFrequency = 'frequent';
  } else if (newTotal >= 5) {
    repeatFrequency = 'regular';
  } else if (newTotal >= 2) {
    repeatFrequency = 'occasional';
  }

  await db
    .update(customerPurchaseHistory)
    .set({
      total_purchases: newTotal,
      total_spent: newSpent,
      avg_transaction_value: avgValue,
      total_items_bought: itemsCount,
      last_purchase_date: new Date(),
      days_since_last_purchase: 0,
      is_repeat_customer: isRepeat,
      repeat_frequency: repeatFrequency,
      updated_at: new Date(),
    })
    .where(eq(customerPurchaseHistory.customer_id, customerId));

  logger.info(`Purchase history updated for customer ${customerId}`);
}
