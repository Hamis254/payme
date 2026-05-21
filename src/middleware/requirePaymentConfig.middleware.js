import { db } from '#config/database.js';
import { paymentConfigs } from '#models/paymentConfig.model.js';
import { eq } from 'drizzle-orm';
import logger from '#config/logger.js';

export const requirePaymentConfig = async (req, res, next) => {
  try {
    const businessId = req.body?.business_id || req.params?.businessId;
    const paymentMode = req.body?.payment_mode;

    if (paymentMode !== 'mpesa') return next();

    if (!businessId) {
      return res.status(400).json({ error: 'business_id is required' });
    }

    const [config] = await db
      .select()
      .from(paymentConfigs)
      .where(eq(paymentConfigs.business_id, Number(businessId)))
      .limit(1);

    if (!config) {
      return res.status(400).json({
        error: 'Payment configuration not set up',
        message: 'Please configure your M-Pesa till or paybill in Settings.',
        setup_url: '/api/payment-config/fields?method=paybill',
      });
    }

    if (!config.is_active) {
      return res.status(400).json({
        error: 'Payment configuration is inactive',
        message: 'Please activate your M-Pesa configuration in Settings.',
      });
    }

    next();
  } catch (e) {
    logger.error('requirePaymentConfig error', e);
    next(e);
  }
};
