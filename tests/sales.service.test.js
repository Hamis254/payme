jest.mock('#config/logger.js', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
  },
}));

jest.mock('#config/database.js', () => ({
  __esModule: true,
  db: {
    select: jest.fn(),
  },
}));

jest.mock('#models/sales.model.js', () => ({
  __esModule: true,
  sales: { name: 'sales' },
  saleItems: { name: 'saleItems' },
}));

jest.mock('#models/stock.model.js', () => ({
  __esModule: true,
  products: { name: 'products' },
  stockMovements: { name: 'stockMovements' },
}));

jest.mock('#models/setting.model.js', () => ({
  __esModule: true,
  businesses: { name: 'businesses' },
}));

jest.mock('#models/credit.model.js', () => ({
  __esModule: true,
  creditSales: { name: 'creditSales' },
  creditAccounts: { name: 'creditAccounts' },
  creditPayments: { name: 'creditPayments' },
}));

jest.mock('#models/higherPurchase.model.js', () => ({
  __esModule: true,
  hirePurchaseAgreements: { name: 'hirePurchaseAgreements' },
  hirePurchaseInstallmentPayments: { name: 'hirePurchaseInstallmentPayments' },
}));

jest.mock('#models/spoiledStock.model.js', () => ({
  __esModule: true,
  spoiledStock: { name: 'spoiledStock' },
}));

jest.mock('#models/expense.model.js', () => ({
  __esModule: true,
  expenses: { name: 'expenses' },
}));

// Only the two opening-ledger helpers are stubbed, because these tests
// assert on how they're called. Everything else — calculateExpenseImpact
// in particular — stays real: the module is pure, so there is nothing to
// isolate, and stubbing it would let the statement's expense split pass
// against a mock that doesn't implement the rule.
jest.mock('#services/financialCalculations.js', () => ({
  __esModule: true,
  ...jest.requireActual('#services/financialCalculations.js'),
  calculateCreditSaleOpening: jest.fn(),
  calculateHPAgreementOpening: jest.fn(),
}));

jest.mock('#services/stock.service.js', () => ({
  __esModule: true,
  checkStockAvailability: jest.fn(),
  deductStockFIFO: jest.fn(),
  reserveStockFIFO: jest.fn(),
  checkAndNotifyLowStock: jest.fn(),
}));

jest.mock('#utils/notificationEmitter.js', () => ({
  __esModule: true,
  emitNotification: jest.fn(),
  notifications: {
    paymentComplete: jest.fn(() => ({ type: 'payment_complete' })),
  },
}));

import { db } from '#config/database.js';
import { getStatementFinancials } from '../src/services/sales.service.js';

describe('getStatementFinancials', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    db.select.mockImplementation((columns) => ({
      from: jest.fn(table => {
        const query = {
          where: jest.fn(() => {
            if (table.name === 'sales') {
              if (columns && columns.sale_id) {
                return [{ sale_id: 2, total_amount: '200', created_at: new Date('2024-01-02'), customer_name: 'Bob' }];
              }
              return [{
                id: 1,
                total_amount: '100',
                created_at: new Date('2024-01-01'),
                payment_mode: 'cash',
                status: 'completed',
                customer_name: 'Alice',
                mpesa_sender_phone: '254700000001',
                mpesa_transaction_id: 'txn-1',
              }];
            }

            if (table.name === 'saleItems') {
              return [{
                sale_id: 1,
                product_id: 10,
                quantity: '1',
                total_price: '100',
                unit_cost: '50',
                profit: '50',
                product_name: 'Widget',
              }];
            }

            if (table.name === 'creditPayments') {
              return [{
                amount: '30',
                profit_realized: '3',
                created_at: new Date('2024-01-03'),
                payment_method: 'cash',
                mpesa_transaction_id: 'txn-2',
                customer_name: 'Bob',
              }];
            }

            if (table.name === 'creditAccounts') {
              return [{ total: 0 }];
            }

            if (table.name === 'hirePurchaseAgreements') {
              return [{ sale_id: 3, total_amount: '300', created_at: new Date('2024-01-04'), customer_name: 'Carol' }];
            }

            if (table.name === 'hirePurchaseInstallmentPayments') {
              return [{
                amount: '20',
                payment_type: 'deposit',
                profit_realized: '2',
                payment_date: new Date('2024-01-05'),
                payment_method: 'mpesa',
                mpesa_transaction_id: 'txn-3',
                customer_name: 'Carol',
              }];
            }

            if (table.name === 'expenses') {
              return [];
            }

            if (table.name === 'spoiledStock') {
              return [{ total: 0 }];
            }

            return [];
          }),
          innerJoin: jest.fn(() => ({
            where: jest.fn(() => {
              if (table.name === 'creditPayments') {
                return [{
                  amount: '30',
                  profit_realized: '3',
                  created_at: new Date('2024-01-03'),
                  payment_method: 'cash',
                  mpesa_transaction_id: 'txn-2',
                  customer_name: 'Bob',
                }];
              }

              if (table.name === 'hirePurchaseInstallmentPayments') {
                return [{
                  amount: '20',
                  payment_type: 'deposit',
                  profit_realized: '2',
                  payment_date: new Date('2024-01-05'),
                  payment_method: 'mpesa',
                  mpesa_transaction_id: 'txn-3',
                  customer_name: 'Carol',
                }];
              }

              return [];
            }),
            innerJoin: jest.fn(() => ({
              where: jest.fn(() => {
                if (table.name === 'hirePurchaseInstallmentPayments') {
                  return [{
                    amount: '20',
                    payment_type: 'deposit',
                    profit_realized: '2',
                    payment_date: new Date('2024-01-05'),
                    payment_method: 'mpesa',
                    mpesa_transaction_id: 'txn-3',
                    customer_name: 'Carol',
                  }];
                }
                return [];
              }),
            })),
          })),
        };

        return query;
      }),
    }));
  });

  it('includes customer names on ledger rows for all row types', async () => {
    const result = await getStatementFinancials(1, new Date('2024-01-01'), new Date('2024-01-31'));

    expect(result.ledgerRows.length).toBeGreaterThan(0);
    expect(result.ledgerRows.every(row => Object.prototype.hasOwnProperty.call(row, 'customer'))).toBe(true);
    expect(result.ledgerRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ product: 'Widget', customer: 'Alice' }),
      expect.objectContaining({ product: 'Credit repayment', customer: 'Bob' }),
      expect.objectContaining({ product: 'HP deposit', customer: 'Carol' }),
    ]));
  });
});
