import { db } from '#config/database.js';
import { creditAccounts } from '#models/credit.model.js';
import { businesses } from '#models/setting.model.js';
import { and, eq } from 'drizzle-orm';
import logger from '#config/logger.js';

export const validateCreditPaymentAccount = async (req, res, next) => {
  try {
    const accountId = req.body?.accountId;
    if (!Number.isSafeInteger(accountId) || accountId <= 0) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'A valid accountId is required',
      });
    }

    const [account] = await db
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.id, accountId))
      .limit(1);

    if (!account) {
      return res.status(404).json({ error: 'Credit account not found' });
    }

    const [business] = await db
      .select()
      .from(businesses)
      .where(
        and(
          eq(businesses.id, account.business_id),
          eq(businesses.user_id, req.user.id)
        )
      )
      .limit(1);

    if (!business) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Business not found or access denied',
      });
    }

    if (business.branch_status === 'pending_approval') {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Branch is awaiting approval',
      });
    }

    req.body.businessId = account.business_id;
    return next();
  } catch (error) {
    logger.error('Credit payment account validation error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Error validating credit payment account',
    });
  }
};
