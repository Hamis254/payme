// src/services/notificationScheduler.js
import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { and, eq, lte, ne, gte, sql, desc } from 'drizzle-orm';
import { businesses } from '#models/setting.model.js';
import { creditSales, creditAccounts } from '#models/credit.model.js';
import {
  hirePurchaseAgreements,
  hirePurchaseInstallments,
} from '#models/higherPurchase.model.js';
import { saleItems, sales } from '#models/sales.model.js';
import { notifications as dbNotifications } from '#models/notification.model.js';
import { emitNotification, notifications } from '#utils/notificationEmitter.js';

const CONFIG = {
  INTERVAL_MS: parseInt(process.env.NOTIFICATION_SCAN_INTERVAL_MS ?? '21600000', 10), // 6h
};

let intervalHandle = null;
let isRunning = false;

/** Has this related_id already gotten this notification type today? Prevents re-spamming every 6h cycle. */
const alreadyNotifiedToday = async (userId, type, relatedId) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [existing] = await db
    .select({ id: dbNotifications.id })
    .from(dbNotifications)
    .where(
      and(
        eq(dbNotifications.user_id, userId),
        eq(dbNotifications.type, type),
        eq(dbNotifications.related_id, relatedId),
        gte(dbNotifications.created_at, startOfDay)
      )
    )
    .limit(1);

  return Boolean(existing);
};

const scanCreditDue = async () => {
  const today = new Date();
  const rows = await db
    .select({
      credit_sale_id: creditSales.id,
      account_id: creditSales.account_id,
      due_date: creditSales.due_date,
      outstanding_amount: creditSales.outstanding_amount,
      customer_name: creditAccounts.customer_name,
      business_id: creditAccounts.business_id,
    })
    .from(creditSales)
    .innerJoin(creditAccounts, eq(creditSales.account_id, creditAccounts.id))
    .where(
      and(
        ne(creditSales.status, 'paid'),
        ne(creditSales.status, 'written_off'),
        lte(creditSales.due_date, today)
      )
    );

  for (const row of rows) {
    const [business] = await db
      .select({ user_id: businesses.user_id })
      .from(businesses)
      .where(eq(businesses.id, row.business_id))
      .limit(1);
    if (!business) continue;

    if (await alreadyNotifiedToday(business.user_id, 'credit_payment_due', row.credit_sale_id)) {
      continue;
    }

    await emitNotification({
      user_id: business.user_id,
      business_id: row.business_id,
      ...notifications.creditPaymentDue({
        amount: Number(row.outstanding_amount),
        due_date: row.due_date.toISOString().slice(0, 10),
        customer_name: row.customer_name,
        credit_account_id: row.credit_sale_id,
      }),
    });
  }
};

const scanHirePurchaseDue = async () => {
  const today = new Date();
  const rows = await db
    .select({
      installment_id: hirePurchaseInstallments.id,
      installment_number: hirePurchaseInstallments.installment_number,
      due_date: hirePurchaseInstallments.due_date,
      amount_due: hirePurchaseInstallments.amount_due,
      agreement_id: hirePurchaseAgreements.id,
      business_id: hirePurchaseAgreements.business_id,
      customer_name: creditAccounts.customer_name,
      days_overdue: sql`GREATEST(0, CAST(EXTRACT(DAY FROM NOW() - ${hirePurchaseInstallments.due_date}) AS INTEGER))`,
    })
    .from(hirePurchaseInstallments)
    .innerJoin(
      hirePurchaseAgreements,
      eq(hirePurchaseInstallments.agreement_id, hirePurchaseAgreements.id)
    )
    .innerJoin(creditAccounts, eq(hirePurchaseAgreements.account_id, creditAccounts.id))
    .where(
      and(
        eq(hirePurchaseAgreements.status, 'active'),
        ne(hirePurchaseInstallments.status, 'paid'),
        lte(hirePurchaseInstallments.due_date, today)
      )
    );

  for (const row of rows) {
    const [business] = await db
      .select({ user_id: businesses.user_id })
      .from(businesses)
      .where(eq(businesses.id, row.business_id))
      .limit(1);
    if (!business) continue;

    if (await alreadyNotifiedToday(business.user_id, 'hire_purchase_due', row.installment_id)) {
      continue;
    }

    await emitNotification({
      user_id: business.user_id,
      business_id: row.business_id,
      ...notifications.hirePurchaseDue({
        agreement_id: row.installment_id,
        installment_number: row.installment_number,
        amount_due: Number(row.amount_due),
        due_date: row.due_date.toISOString().slice(0, 10),
        customer_name: row.customer_name,
        days_overdue: Number(row.days_overdue) || 0,
      }),
    });
  }
};

/** Top seller per business over the trailing 7 days, by quantity. */
const scanTrendingProducts = async () => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const allBusinesses = await db.select({ id: businesses.id, user_id: businesses.user_id }).from(businesses);

  for (const biz of allBusinesses) {
    const [top] = await db
      .select({
        product_id: saleItems.product_id,
        product_name: saleItems.product_name,
        total_qty: sql`SUM(${saleItems.quantity})`.as('total_qty'),
      })
      .from(saleItems)
      .innerJoin(sales, eq(saleItems.sale_id, sales.id))
      .where(and(eq(sales.business_id, biz.id), gte(sales.created_at, sevenDaysAgo)))
      .groupBy(saleItems.product_id, saleItems.product_name)
      .orderBy(desc(sql`SUM(${saleItems.quantity})`))
      .limit(1);

    if (!top) continue;

    if (await alreadyNotifiedToday(biz.user_id, 'trending_product', top.product_id)) {
      continue;
    }

    await emitNotification({
      user_id: biz.user_id,
      business_id: biz.id,
      ...notifications.trendingProduct({
        product_id: top.product_id,
        product_name: top.product_name,
        quantity_sold: Number(top.total_qty),
        period_days: 7,
      }),
    });
  }
};

const runScanCycle = async () => {
  if (isRunning) return;
  isRunning = true;
  try {
    await scanCreditDue();
    await scanHirePurchaseDue();
    await scanTrendingProducts();
  } catch (e) {
    logger.error('notificationScheduler cycle failed', e);
  } finally {
    isRunning = false;
  }
};

export const startNotificationScheduler = () => {
  runScanCycle(); // run once on boot, then on interval
  intervalHandle = setInterval(runScanCycle, CONFIG.INTERVAL_MS);
};

export const stopNotificationScheduler = () => {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
};