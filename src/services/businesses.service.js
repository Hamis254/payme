import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { businesses } from '#models/setting.model.js';
import { eq } from 'drizzle-orm';

export const createBusinessForUser = async (userId, data) => {
  try {
    const [business] = await db
      .insert(businesses)
      .values({
        user_id: userId,
        name: data.name,
        location: data.location,
        location_description: data.location_description,
        payment_method: data.payment_method,
        payment_identifier: data.payment_identifier,
      })
      .returning({
        id: businesses.id,
        user_id: businesses.user_id,
        name: businesses.name,
        location: businesses.location,
        location_description: businesses.location_description,
        payment_method: businesses.payment_method,
        payment_identifier: businesses.payment_identifier,
        verified: businesses.verified,
        created_at: businesses.created_at,
        updated_at: businesses.updated_at,
      });

    logger.info(`Business ${business.name} created for user ${userId}`);
    return business;
  } catch (e) {
    logger.error('Error creating business', e);
    throw e;
  }
};

export const getBusinessesForUser = async userId => {
  try {
    return await db
      .select({
        id: businesses.id,
        user_id: businesses.user_id,
        name: businesses.name,
        location: businesses.location,
        location_description: businesses.location_description,
        payment_method: businesses.payment_method,
        payment_identifier: businesses.payment_identifier,
        verified: businesses.verified,
        created_at: businesses.created_at,
        updated_at: businesses.updated_at,
      })
      .from(businesses)
      .where(eq(businesses.user_id, userId));
  } catch (e) {
    logger.error('Error getting businesses for user', e);
    throw e;
  }
};

export const getBusinessByIdForUser = async (userId, businessId) => {
  try {
    const [business] = await db
      .select({
        id: businesses.id,
        user_id: businesses.user_id,
        name: businesses.name,
        location: businesses.location,
        location_description: businesses.location_description,
        payment_method: businesses.payment_method,
        payment_identifier: businesses.payment_identifier,
        verified: businesses.verified,
        created_at: businesses.created_at,
        updated_at: businesses.updated_at,
      })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .where(eq(businesses.user_id, userId))
      .limit(1);

    if (!business) throw new Error('Business not found');
    return business;
  } catch (e) {
    if (e.message === 'Business not found') throw e;
    logger.error(`Error getting business ${businessId} for user ${userId}`, e);
    throw e;
  }
};

export const updateBusinessForUser = async (userId, businessId, updates) => {
  try {
    // Ensure the business belongs to the user
    await getBusinessByIdForUser(userId, businessId);

    const [updated] = await db
      .update(businesses)
      .set({
        ...updates,
        updated_at: new Date(),
      })
      .where(eq(businesses.id, businessId))
      .where(eq(businesses.user_id, userId))
      .returning({
        id: businesses.id,
        user_id: businesses.user_id,
        name: businesses.name,
        location: businesses.location,
        location_description: businesses.location_description,
        payment_method: businesses.payment_method,
        payment_identifier: businesses.payment_identifier,
        verified: businesses.verified,
        created_at: businesses.created_at,
        updated_at: businesses.updated_at,
      });

    logger.info(`Business ${updated.id} updated for user ${userId}`);
    return updated;
  } catch (e) {
    logger.error(`Error updating business ${businessId} for user ${userId}`, e);
    throw e;
  }
};
