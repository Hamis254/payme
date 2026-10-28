// src/services/tokenLotScheduler.js
// Hourly job for trial tokens. It does two things:
//   1. Expires trial lots past their expiry, removing those tokens from the
//      wallet balance and writing an 'expiry' ledger row.
//   2. Sends each trial lot's day-5 and expiry-day warnings, once each.
//
// Expiry is also applied lazily inside every spend and balance read, so this
// job only keeps the stored balance tidy. A late run can't let expired tokens
// be spent.

import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { eq } from 'drizzle-orm';
import { businesses } from '#models/setting.model.js';
import { tokenLots, TOKEN_SOURCES } from '#models/tokenLot.model.js';
import { notificationService } from '#services/notification.service.js';
import {
  expireDueLots,
  lockWallet,
} from '#services/tokenLots.service.js';
import {
  addBusinessDays,
  businessDayKey,
  startOfBusinessDay,
} from '#utils/businessDay.js';

const CONFIG = {
  INTERVAL_MS: parseInt(process.env.TOKEN_LOT_SCAN_INTERVAL_MS ?? '3600000', 10), // 1h
};

// Expiry is end of day 7, so day 5 is two calendar days before its day.
const DAYS_BEFORE_EXPIRY_FOR_WARNING = 2;

let intervalHandle = null;
let isRunning = false;

const trialLots = () =>
  db.select().from(tokenLots).where(eq(tokenLots.source, TOKEN_SOURCES.TRIAL));

const isExpired = (lot, now) => new Date(lot.expires_at).getTime() <= now.getTime();

/** Expires due trial lots, one business at a time. Returns tokens expired. */
const expireTrialLots = async now => {
  const due = (await trialLots()).filter(
    lot => lot.tokens_remaining > 0 && lot.expires_at && isExpired(lot, now)
  );
  const businessIds = [...new Set(due.map(lot => lot.business_id))];

  let expired = 0;
  for (const businessId of businessIds) {
    try {
      expired += await db.transaction(async tx => {
        const wallet = await lockWallet(tx, businessId);
        return expireDueLots(tx, wallet, now);
      });
    } catch (error) {
      logger.error('Trial expiry failed for business', {
        business_id: businessId,
        error: error.message,
      });
    }
  }
  return expired;
};

/**
 * Sends each due warning, then records it on the lot. The timestamp is written
 * only after the notification is created, so a failed send is retried on the
 * next run.
 */
const sendTrialNotices = async now => {
  let sent = 0;

  for (const lot of await trialLots()) {
    if (!lot.expires_at || isExpired(lot, now)) continue;

    const expiryDay = businessDayKey(lot.expires_at);
    const warnings = [
      {
        column: 'notice_day5_sent_at',
        sentAt: lot.notice_day5_sent_at,
        due: startOfBusinessDay(addBusinessDays(expiryDay, -DAYS_BEFORE_EXPIRY_FOR_WARNING)),
        type: 'trial_warning_day5',
        text: `${lot.tokens_remaining} free trial tokens are left. They expire at the end of ${expiryDay} (Nairobi time). Top up to keep selling.`,
      },
      {
        column: 'notice_expiry_sent_at',
        sentAt: lot.notice_expiry_sent_at,
        due: startOfBusinessDay(expiryDay),
        type: 'trial_expiring_today',
        text: `Your free trial tokens expire tonight (end of ${expiryDay}). Top up before then to keep selling.`,
      },
    ];

    for (const warning of warnings) {
      if (warning.sentAt || now < warning.due) continue;

      // Nothing left to warn about: mark it done without sending.
      if (lot.tokens_remaining <= 0) {
        await db
          .update(tokenLots)
          .set({ [warning.column]: now })
          .where(eq(tokenLots.id, lot.id));
        continue;
      }

      try {
        const [business] = await db
          .select({ user_id: businesses.user_id, name: businesses.name })
          .from(businesses)
          .where(eq(businesses.id, lot.business_id))
          .limit(1);

        await notificationService.createNotification({
          user_id: business.user_id,
          type: warning.type,
          channel: 'all',
          title: 'Trial tokens',
          message: `${business.name}: ${warning.text}`,
          related_id: lot.id,
          related_type: 'token_lot',
          metadata: { business_id: lot.business_id },
        });

        await db
          .update(tokenLots)
          .set({ [warning.column]: now })
          .where(eq(tokenLots.id, lot.id));
        sent += 1;
      } catch (error) {
        logger.error('Trial warning failed; will retry next cycle', {
          lot_id: lot.id,
          type: warning.type,
          error: error.message,
        });
      }
    }
  }

  return sent;
};

/** One pass: expire, then warn. Returns counts. A second call while one is running does nothing. */
export const runTokenLotCycle = async (now = new Date()) => {
  if (isRunning) return null;
  isRunning = true;

  try {
    const expiredTokens = await expireTrialLots(now);
    const noticesSent = await sendTrialNotices(now);
    if (expiredTokens > 0 || noticesSent > 0) {
      logger.info('TOKEN_LOT_CYCLE', { expiredTokens, noticesSent });
    }
    return { expiredTokens, noticesSent };
  } finally {
    isRunning = false;
  }
};

export const startTokenLotScheduler = () => {
  if (intervalHandle) return;

  intervalHandle = setInterval(() => {
    runTokenLotCycle().catch(error =>
      logger.error('Token lot cycle failed', { error: error.message })
    );
  }, CONFIG.INTERVAL_MS);

  runTokenLotCycle().catch(error =>
    logger.error('Initial token lot cycle failed', { error: error.message })
  );

  logger.info(`Token lot scheduler started (every ${CONFIG.INTERVAL_MS / 1000}s)`);
};

export const stopTokenLotScheduler = () => {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info('Token lot scheduler stopped');
  }
};
