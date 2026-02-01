// audit.validation.js
import { z } from 'zod';

// Audit log query schema
export const auditLogQuerySchema = z.object({
  limit: z.number().int().positive().max(500).optional(),
  offset: z.number().int().nonnegative().optional(),
  entityType: z.string().optional(),
  action: z.string().optional(),
  userId: z.number().int().positive().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

// Audit action types (for reference)
export const AUDIT_ACTIONS = {
  // Sales
  SALE_CREATED: 'sale_created',
  SALE_COMPLETED: 'sale_completed',
  SALE_CANCELLED: 'sale_cancelled',
  SALE_REFUNDED: 'sale_refunded',
  
  // Stock
  PRODUCT_CREATED: 'product_created',
  PRODUCT_UPDATED: 'product_updated',
  PRODUCT_DELETED: 'product_deleted',
  STOCK_ADDED: 'stock_added',
  STOCK_DEDUCTED: 'stock_deducted',
  STOCK_ADJUSTED: 'stock_adjusted',
  SPOILED_STOCK_RECORDED: 'spoiled_stock_recorded',
  
  // Expenses
  EXPENSE_RECORDED: 'expense_recorded',
  EXPENSE_UPDATED: 'expense_updated',
  EXPENSE_DELETED: 'expense_deleted',
  
  // Wallet
  TOKENS_PURCHASED: 'tokens_purchased',
  TOKENS_CHARGED: 'tokens_charged',
  TOKENS_REFUNDED: 'tokens_refunded',
  
  // Customers
  CUSTOMER_CREATED: 'customer_created',
  CUSTOMER_UPDATED: 'customer_updated',
  LOYALTY_POINTS_ADDED: 'loyalty_points_added',
  LOYALTY_POINTS_REDEEMED: 'loyalty_points_redeemed',
  
  // Settings
  PAYMENT_CONFIG_UPDATED: 'payment_config_updated',
  BUSINESS_SETTINGS_UPDATED: 'business_settings_updated',
  USER_INVITED: 'user_invited',
  USER_ROLE_CHANGED: 'user_role_changed',
  
  // Reconciliation
  CASH_RECONCILIATION_CREATED: 'cash_reconciliation_created',
  CASH_RECONCILIATION_APPROVED: 'cash_reconciliation_approved',
  MPESA_RECONCILIATION_CREATED: 'mpesa_reconciliation_created',
  
  // Auth
  LOGIN: 'login',
  LOGOUT: 'logout',
  PASSWORD_CHANGED: 'password_changed',
};

// Entity types (for reference)
export const ENTITY_TYPES = {
  SALE: 'sale',
  PRODUCT: 'product',
  STOCK: 'stock',
  EXPENSE: 'expense',
  WALLET: 'wallet',
  CUSTOMER: 'customer',
  LOYALTY: 'loyalty',
  PAYMENT: 'payment',
  BUSINESS: 'business',
  USER: 'user',
  RECONCILIATION: 'reconciliation',
  SETTINGS: 'settings',
};
