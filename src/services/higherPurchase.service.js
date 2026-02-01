import { db, sql } from '#config/database.js';
import {
  hirePurchaseAgreements,
  hirePurchaseInstallments,
} from '#models/higherPurchase.model.js';
import { and, eq, gte, lte, desc, ne, sql as sqlOp } from 'drizzle-orm';
import logger from '#config/logger.js';

/**
 * Create a new hire purchase agreement
 * @param {Object} data - Agreement data
 * @returns {Promise<Object>} Created agreement with installments
 */
export async function createAgreement(data) {
  try {
    const {
      saleId,
      accountId,
      businessId,
      principalAmount,
      interestRate,
      downPayment,
      installmentAmount,
      installmentFrequency,
      numberOfInstallments,
      agreementDate,
      firstPaymentDate,
      finalPaymentDate,
      lateFeeAmount,
      gracePeriodDays,
      termsAndConditions,
      notes,
      createdBy,
    } = data;

    const totalAmount = parseFloat(principalAmount) * (1 + parseFloat(interestRate) / 100);
    const amountFinanced = totalAmount - parseFloat(downPayment);

    // Create agreement in transaction with installments
    const result = await db.transaction(async tx => {
      // Create agreement
      const [agreement] = await tx
        .insert(hirePurchaseAgreements)
        .values({
          sale_id: saleId,
          account_id: accountId,
          business_id: businessId,
          principal_amount: principalAmount.toString(),
          interest_rate: interestRate.toString(),
          total_amount: totalAmount.toString(),
          down_payment: downPayment.toString(),
          amount_financed: amountFinanced.toString(),
          installment_amount: installmentAmount.toString(),
          installment_frequency: installmentFrequency,
          number_of_installments: numberOfInstallments,
          installments_paid: 0,
          agreement_date: new Date(agreementDate),
          first_payment_date: new Date(firstPaymentDate),
          final_payment_date: new Date(finalPaymentDate),
          balance_remaining: amountFinanced.toString(),
          status: 'active',
          late_fee_amount: lateFeeAmount?.toString(),
          grace_period_days: gracePeriodDays,
          terms_and_conditions: termsAndConditions,
          notes,
          created_by: createdBy,
        })
        .returning();

      // Create installments
      const installments = [];
      let currentDate = new Date(firstPaymentDate);

      for (let i = 1; i <= numberOfInstallments; i++) {
        const [installment] = await tx
          .insert(hirePurchaseInstallments)
          .values({
            agreement_id: agreement.id,
            installment_number: i,
            due_date: currentDate,
            amount_due: installmentAmount.toString(),
            status: 'pending',
          })
          .returning();

        installments.push(installment);

        // Move to next due date based on frequency
        currentDate = new Date(currentDate);
        if (installmentFrequency === 'daily') {
          currentDate.setDate(currentDate.getDate() + 1);
        } else if (installmentFrequency === 'weekly') {
          currentDate.setDate(currentDate.getDate() + 7);
        } else if (installmentFrequency === 'bi-weekly') {
          currentDate.setDate(currentDate.getDate() + 14);
        } else if (installmentFrequency === 'monthly') {
          currentDate.setMonth(currentDate.getMonth() + 1);
        }
      }

      return { agreement, installments };
    });

    logger.info(`Hire purchase agreement created: ${result.agreement.id}`, {
      agreementId: result.agreement.id,
      saleId,
      installments: result.installments.length,
    });

    return result;
  } catch (error) {
    logger.error('Error creating agreement:', error);
    throw error;
  }
}

/**
 * Get agreement by ID with all installments
 * @param {number} agreementId - Agreement ID
 * @returns {Promise<Object>} Agreement with installments
 */
export async function getAgreementById(agreementId) {
  try {
    const agreement = await db
      .select()
      .from(hirePurchaseAgreements)
      .where(eq(hirePurchaseAgreements.id, agreementId))
      .limit(1);

    if (!agreement.length) return null;

    const installments = await db
      .select()
      .from(hirePurchaseInstallments)
      .where(eq(hirePurchaseInstallments.agreement_id, agreementId))
      .orderBy(hirePurchaseInstallments.installment_number);

    return {
      ...agreement[0],
      installments,
      principal_amount: parseFloat(agreement[0].principal_amount),
      total_amount: parseFloat(agreement[0].total_amount),
      down_payment: parseFloat(agreement[0].down_payment),
      amount_financed: parseFloat(agreement[0].amount_financed),
      installment_amount: parseFloat(agreement[0].installment_amount),
      balance_remaining: parseFloat(agreement[0].balance_remaining),
      late_fee_amount: parseFloat(agreement[0].late_fee_amount),
    };
  } catch (error) {
    logger.error('Error fetching agreement:', error);
    throw error;
  }
}

/**
 * List agreements with filters
 * @param {Object} params - Query parameters
 * @returns {Promise<Array>} Agreements list
 */
export async function listAgreements(params) {
  try {
    const { businessId, status, startDate, endDate, limit = 50, offset = 0 } = params;

    let query = db
      .select()
      .from(hirePurchaseAgreements)
      .where(eq(hirePurchaseAgreements.business_id, businessId));

    if (status) {
      query = query.where(eq(hirePurchaseAgreements.status, status));
    }

    if (startDate && endDate) {
      query = query.where(
        and(
          gte(hirePurchaseAgreements.agreement_date, new Date(startDate)),
          lte(hirePurchaseAgreements.agreement_date, new Date(endDate))
        )
      );
    }

    const results = await query
      .orderBy(desc(hirePurchaseAgreements.agreement_date))
      .limit(limit)
      .offset(offset);

    return results.map(r => ({
      ...r,
      principal_amount: parseFloat(r.principal_amount),
      total_amount: parseFloat(r.total_amount),
      down_payment: parseFloat(r.down_payment),
      amount_financed: parseFloat(r.amount_financed),
      installment_amount: parseFloat(r.installment_amount),
      balance_remaining: parseFloat(r.balance_remaining),
    }));
  } catch (error) {
    logger.error('Error listing agreements:', error);
    throw error;
  }
}

/**
 * Record installment payment
 * @param {Object} data - Payment data
 * @returns {Promise<Object>} Updated installment
 */
export async function recordInstallmentPayment(data) {
  try {
    const {
      agreementId,
      installmentId,
      amountPaid,
      paymentMethod,
      mpesaTransactionId,
      paymentDate,
    } = data;

    const payment = parseFloat(amountPaid);

    const result = await db.transaction(async tx => {
      // Get installment details
      const [installment] = await tx
        .select()
        .from(hirePurchaseInstallments)
        .where(eq(hirePurchaseInstallments.id, installmentId))
        .limit(1);

      if (!installment) throw new Error('Installment not found');

      const amountDue = parseFloat(installment.amount_due);
      const previouslyPaid = parseFloat(installment.amount_paid || 0);
      const totalPaid = previouslyPaid + payment;

      let newStatus = 'partial';
      if (totalPaid >= amountDue) {
        newStatus = 'paid';
      }

      // Update installment
      const [updated] = await tx
        .update(hirePurchaseInstallments)
        .set({
          amount_paid: totalPaid.toString(),
          payment_date: new Date(paymentDate || new Date()),
          payment_method: paymentMethod,
          mpesa_transaction_id: mpesaTransactionId,
          status: newStatus,
          updated_at: new Date(),
        })
        .where(eq(hirePurchaseInstallments.id, installmentId))
        .returning();

      // Update agreement balance and payment count
      const [agreement] = await tx
        .select()
        .from(hirePurchaseAgreements)
        .where(eq(hirePurchaseAgreements.id, agreementId))
        .limit(1);

      const currentBalance = parseFloat(agreement.balance_remaining);
      const newBalance = Math.max(0, currentBalance - payment);
      let newInstallmentsPaid = agreement.installments_paid;

      if (newStatus === 'paid') {
        newInstallmentsPaid += 1;
      }

      const [updatedAgreement] = await tx
        .update(hirePurchaseAgreements)
        .set({
          balance_remaining: newBalance.toString(),
          installments_paid: newInstallmentsPaid,
          status: newInstallmentsPaid === agreement.number_of_installments ? 'completed' : 'active',
          updated_at: new Date(),
        })
        .where(eq(hirePurchaseAgreements.id, agreementId))
        .returning();

      return { installment: updated, agreement: updatedAgreement };
    });

    logger.info(`Installment payment recorded: ${installmentId}`, {
      installmentId,
      agreementId,
      amount: payment,
      method: paymentMethod,
    });

    return result;
  } catch (error) {
    logger.error('Error recording installment payment:', error);
    throw error;
  }
}

/**
 * Get overdue installments
 * @param {number} businessId - Business ID
 * @returns {Promise<Array>} Overdue installments with agreement details
 */
export async function getOverdueInstallments(businessId) {
  try {
    const today = new Date();

    const result = await db
      .select({
        installment_id: hirePurchaseInstallments.id,
        installment_number: hirePurchaseInstallments.installment_number,
        due_date: hirePurchaseInstallments.due_date,
        amount_due: hirePurchaseInstallments.amount_due,
        amount_paid: hirePurchaseInstallments.amount_paid,
        days_overdue: sql`CAST(EXTRACT(DAY FROM NOW() - due_date) AS INTEGER)`,
        agreement_id: hirePurchaseAgreements.id,
        principal_amount: hirePurchaseAgreements.principal_amount,
        status: hirePurchaseAgreements.status,
      })
      .from(hirePurchaseInstallments)
      .innerJoin(
        hirePurchaseAgreements,
        eq(hirePurchaseInstallments.agreement_id, hirePurchaseAgreements.id)
      )
      .where(
        and(
          eq(hirePurchaseAgreements.business_id, businessId),
          eq(hirePurchaseAgreements.status, 'active'),
          ne(hirePurchaseInstallments.status, 'paid'),
          sqlOp`due_date < ${today}`
        )
      )
      .orderBy(desc(hirePurchaseInstallments.due_date));

    return result.map(r => ({
      ...r,
      amount_due: parseFloat(r.amount_due),
      amount_paid: parseFloat(r.amount_paid || 0),
      principal_amount: parseFloat(r.principal_amount),
      days_overdue: parseInt(r.days_overdue) || 0,
    }));
  } catch (error) {
    logger.error('Error fetching overdue installments:', error);
    throw error;
  }
}

/**
 * Get upcoming installments
 * @param {number} businessId - Business ID
 * @param {number} daysAhead - Number of days to look ahead (default 30)
 * @returns {Promise<Array>} Upcoming installments
 */
export async function getUpcomingInstallments(businessId, daysAhead = 30) {
  try {
    const today = new Date();
    const futureDate = new Date(today.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    const result = await db
      .select({
        installment_id: hirePurchaseInstallments.id,
        installment_number: hirePurchaseInstallments.installment_number,
        due_date: hirePurchaseInstallments.due_date,
        amount_due: hirePurchaseInstallments.amount_due,
        agreement_id: hirePurchaseAgreements.id,
        status: hirePurchaseAgreements.status,
      })
      .from(hirePurchaseInstallments)
      .innerJoin(
        hirePurchaseAgreements,
        eq(hirePurchaseInstallments.agreement_id, hirePurchaseAgreements.id)
      )
      .where(
        and(
          eq(hirePurchaseAgreements.business_id, businessId),
          eq(hirePurchaseAgreements.status, 'active'),
          eq(hirePurchaseInstallments.status, 'pending'),
          gte(hirePurchaseInstallments.due_date, today),
          lte(hirePurchaseInstallments.due_date, futureDate)
        )
      )
      .orderBy(hirePurchaseInstallments.due_date);

    return result.map(r => ({
      ...r,
      amount_due: parseFloat(r.amount_due),
    }));
  } catch (error) {
    logger.error('Error fetching upcoming installments:', error);
    throw error;
  }
}

/**
 * Calculate agreement summary
 * @param {number} businessId - Business ID
 * @returns {Promise<Object>} Summary statistics
 */
export async function getAgreementSummary(businessId) {
  try {
    const result = await db
      .select({
        total_agreements: sql`COUNT(*)`,
        active_agreements: sql`SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)`,
        completed_agreements: sql`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
        defaulted_agreements: sql`SUM(CASE WHEN status = 'defaulted' THEN 1 ELSE 0 END)`,
        total_financed: sql`SUM(CAST(amount_financed AS DECIMAL))`,
        total_remaining: sql`SUM(CAST(balance_remaining AS DECIMAL))`,
        total_collected: sql`SUM(CAST(amount_financed AS DECIMAL)) - SUM(CAST(balance_remaining AS DECIMAL))`,
      })
      .from(hirePurchaseAgreements)
      .where(eq(hirePurchaseAgreements.business_id, businessId));

    return {
      total_agreements: parseInt(result[0].total_agreements) || 0,
      active_agreements: parseInt(result[0].active_agreements) || 0,
      completed_agreements: parseInt(result[0].completed_agreements) || 0,
      defaulted_agreements: parseInt(result[0].defaulted_agreements) || 0,
      total_financed: parseFloat(result[0].total_financed) || 0,
      total_remaining: parseFloat(result[0].total_remaining) || 0,
      total_collected: parseFloat(result[0].total_collected) || 0,
    };
  } catch (error) {
    logger.error('Error calculating summary:', error);
    throw error;
  }
}

/**
 * Get agreement status distribution
 * @param {number} businessId - Business ID
 * @returns {Promise<Object>} Status breakdown
 */
export async function getStatusDistribution(businessId) {
  try {
    const result = await db
      .select({
        status: hirePurchaseAgreements.status,
        count: sql`COUNT(*)`,
        total_amount: sql`SUM(CAST(amount_financed AS DECIMAL))`,
      })
      .from(hirePurchaseAgreements)
      .where(eq(hirePurchaseAgreements.business_id, businessId))
      .groupBy(hirePurchaseAgreements.status);

    return result.reduce((acc, row) => {
      acc[row.status] = {
        count: parseInt(row.count),
        amount: parseFloat(row.total_amount),
      };
      return acc;
    }, {});
  } catch (error) {
    logger.error('Error getting status distribution:', error);
    throw error;
  }
}

/**
 * Update agreement status
 * @param {number} agreementId - Agreement ID
 * @param {string} status - New status
 * @returns {Promise<Object>} Updated agreement
 */
export async function updateAgreementStatus(agreementId, status) {
  try {
    const [updated] = await db
      .update(hirePurchaseAgreements)
      .set({
        status,
        updated_at: new Date(),
      })
      .where(eq(hirePurchaseAgreements.id, agreementId))
      .returning();

    logger.info(`Agreement ${agreementId} status updated to ${status}`);

    return updated;
  } catch (error) {
    logger.error('Error updating status:', error);
    throw error;
  }
}

/**
 * Get installment payment history
 * @param {number} agreementId - Agreement ID
 * @returns {Promise<Array>} Payment history
 */
export async function getPaymentHistory(agreementId) {
  try {
    const result = await db
      .select()
      .from(hirePurchaseInstallments)
      .where(eq(hirePurchaseInstallments.agreement_id, agreementId))
      .orderBy(hirePurchaseInstallments.installment_number);

    return result.map(r => ({
      ...r,
      amount_due: parseFloat(r.amount_due),
      amount_paid: parseFloat(r.amount_paid || 0),
    }));
  } catch (error) {
    logger.error('Error fetching payment history:', error);
    throw error;
  }
}

/**
 * Calculate collection rate
 * @param {number} businessId - Business ID
 * @returns {Promise<number>} Collection rate percentage
 */
export async function getCollectionRate(businessId) {
  try {
    const result = await db
      .select({
        total: sql`SUM(CAST(amount_financed AS DECIMAL))`,
        collected: sql`SUM(CAST(amount_financed AS DECIMAL)) - SUM(CAST(balance_remaining AS DECIMAL))`,
      })
      .from(hirePurchaseAgreements)
      .where(eq(hirePurchaseAgreements.business_id, businessId));

    const total = parseFloat(result[0].total) || 0;
    if (total === 0) return 0;

    const collected = parseFloat(result[0].collected) || 0;
    return (collected / total) * 100;
  } catch (error) {
    logger.error('Error calculating collection rate:', error);
    throw error;
  }
}

/**
 * Get revenue by installment frequency
 * @param {number} businessId - Business ID
 * @returns {Promise<Object>} Revenue by frequency
 */
export async function getRevenueByFrequency(businessId) {
  try {
    const result = await db
      .select({
        frequency: hirePurchaseAgreements.installment_frequency,
        count: sql`COUNT(*)`,
        total_amount: sql`SUM(CAST(amount_financed AS DECIMAL))`,
        avg_amount: sql`AVG(CAST(amount_financed AS DECIMAL))`,
      })
      .from(hirePurchaseAgreements)
      .where(eq(hirePurchaseAgreements.business_id, businessId))
      .groupBy(hirePurchaseAgreements.installment_frequency);

    return result.map(r => ({
      frequency: r.frequency,
      count: parseInt(r.count),
      total_amount: parseFloat(r.total_amount),
      avg_amount: parseFloat(r.avg_amount),
    }));
  } catch (error) {
    logger.error('Error getting revenue by frequency:', error);
    throw error;
  }
}
