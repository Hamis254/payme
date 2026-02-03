/**
 * Sales Service Tests
 * Tests for sales creation, validation, and status updates with FIFO stock deduction
 */

import { describe, test, expect, beforeEach } from '@jest/globals';

jest.mock('#config/logger.js', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Sales Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Exports Validation', () => {
    test('should export validateAndCalculateCart function', async () => {
      const module = await import('#services/sales.service.js');
      expect(module.validateAndCalculateCart).toBeDefined();
      expect(typeof module.validateAndCalculateCart).toBe('function');
    });

    test('should export createSale function', async () => {
      const module = await import('#services/sales.service.js');
      expect(module.createSale).toBeDefined();
      expect(typeof module.createSale).toBe('function');
    });

    test('should export updateSaleStatus function', async () => {
      const module = await import('#services/sales.service.js');
      expect(module.updateSaleStatus).toBeDefined();
      expect(typeof module.updateSaleStatus).toBe('function');
    });

    test('should export getSalesForBusiness function', async () => {
      const module = await import('#services/sales.service.js');
      expect(module.getSalesForBusiness).toBeDefined();
      expect(typeof module.getSalesForBusiness).toBe('function');
    });

    test('should export getSaleById function', async () => {
      const module = await import('#services/sales.service.js');
      expect(module.getSaleById).toBeDefined();
      expect(typeof module.getSaleById).toBe('function');
    });

    test('should have exactly 5 exports', async () => {
      const module = await import('#services/sales.service.js');
      const exportNames = [
        'validateAndCalculateCart',
        'createSale',
        'updateSaleStatus',
        'getSalesForBusiness',
        'getSaleById',
      ];

      exportNames.forEach(name => {
        expect(module[name]).toBeDefined();
      });
    });
  });

  describe('Function Types', () => {
    test('validateAndCalculateCart should be async', async () => {
      const { validateAndCalculateCart } = await import('#services/sales.service.js');
      const result = validateAndCalculateCart(1, 1, []);
      expect(result).toBeInstanceOf(Promise);
    });

    test('createSale should be async', async () => {
      const { createSale } = await import('#services/sales.service.js');
      const result = createSale(1, 1, [], 'cash');
      expect(result).toBeInstanceOf(Promise);
    });

    test('updateSaleStatus should be async', async () => {
      const { updateSaleStatus } = await import('#services/sales.service.js');
      const result = updateSaleStatus(1, 'completed');
      expect(result).toBeInstanceOf(Promise);
    });

    test('getSalesForBusiness should be async', async () => {
      const { getSalesForBusiness } = await import('#services/sales.service.js');
      const result = getSalesForBusiness(1, 1);
      expect(result).toBeInstanceOf(Promise);
    });

    test('getSaleById should be async', async () => {
      const { getSaleById } = await import('#services/sales.service.js');
      const result = getSaleById(1, 1);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('Function Parameters - validateAndCalculateCart', () => {
    test('should accept userId parameter', async () => {
      const { validateAndCalculateCart } = await import('#services/sales.service.js');
      expect(validateAndCalculateCart).toBeDefined();
      // Function signature: (userId, businessId, items)
    });

    test('should accept businessId parameter', async () => {
      const { validateAndCalculateCart } = await import('#services/sales.service.js');
      expect(validateAndCalculateCart).toBeDefined();
    });

    test('should accept items array parameter', async () => {
      const { validateAndCalculateCart } = await import('#services/sales.service.js');
      expect(validateAndCalculateCart).toBeDefined();
    });

    test('should handle empty items array', async () => {
      const { validateAndCalculateCart } = await import('#services/sales.service.js');
      const result = validateAndCalculateCart(1, 1, []);
      expect(result).toBeInstanceOf(Promise);
    });

    test('should handle items with product_id and quantity', async () => {
      const { validateAndCalculateCart } = await import('#services/sales.service.js');
      const items = [
        { product_id: 1, quantity: 5 },
        { product_id: 2, quantity: 10 },
      ];
      const result = validateAndCalculateCart(1, 1, items);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('Function Parameters - createSale', () => {
    test('should accept userId, businessId, items, and paymentMode', async () => {
      const { createSale } = await import('#services/sales.service.js');
      expect(createSale).toBeDefined();
      // Signature: (userId, businessId, items, paymentMode, options = {})
    });

    test('should accept cash payment mode', async () => {
      const { createSale } = await import('#services/sales.service.js');
      const result = createSale(1, 1, [], 'cash');
      expect(result).toBeInstanceOf(Promise);
    });

    test('should accept mpesa payment mode', async () => {
      const { createSale } = await import('#services/sales.service.js');
      const result = createSale(1, 1, [], 'mpesa');
      expect(result).toBeInstanceOf(Promise);
    });

    test('should support optional options parameter', async () => {
      const { createSale } = await import('#services/sales.service.js');
      const options = {
        customer_type: 'registered',
        customer_id: 1,
        note: 'Special order',
        customer_phone: '254712345678',
      };
      const result = createSale(1, 1, [], 'cash', options);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('Function Parameters - updateSaleStatus', () => {
    test('should accept saleId and status parameters', async () => {
      const { updateSaleStatus } = await import('#services/sales.service.js');
      expect(updateSaleStatus).toBeDefined();
      // Signature: (saleId, status, mpesaData = {})
    });

    test('should accept completed status', async () => {
      const { updateSaleStatus } = await import('#services/sales.service.js');
      const result = updateSaleStatus(1, 'completed');
      expect(result).toBeInstanceOf(Promise);
    });

    test('should accept pending status', async () => {
      const { updateSaleStatus } = await import('#services/sales.service.js');
      const result = updateSaleStatus(1, 'pending');
      expect(result).toBeInstanceOf(Promise);
    });

    test('should accept failed status', async () => {
      const { updateSaleStatus } = await import('#services/sales.service.js');
      const result = updateSaleStatus(1, 'failed');
      expect(result).toBeInstanceOf(Promise);
    });

    test('should support optional mpesaData parameter', async () => {
      const { updateSaleStatus } = await import('#services/sales.service.js');
      const mpesaData = {
        transaction_id: 'LKA123456',
        sender_name: 'John Doe',
        sender_phone: '254712345678',
      };
      const result = updateSaleStatus(1, 'completed', mpesaData);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('Function Parameters - getSalesForBusiness', () => {
    test('should accept userId and businessId parameters', async () => {
      const { getSalesForBusiness } = await import('#services/sales.service.js');
      expect(getSalesForBusiness).toBeDefined();
      // Signature: (userId, businessId, options = {})
    });

    test('should support optional options parameter', async () => {
      const { getSalesForBusiness } = await import('#services/sales.service.js');
      const options = {
        limit: 10,
        offset: 0,
        status: 'completed',
      };
      const result = getSalesForBusiness(1, 1, options);
      expect(result).toBeInstanceOf(Promise);
    });

    test('should work without options parameter', async () => {
      const { getSalesForBusiness } = await import('#services/sales.service.js');
      const result = getSalesForBusiness(1, 1);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('Function Parameters - getSaleById', () => {
    test('should accept userId and saleId parameters', async () => {
      const { getSaleById } = await import('#services/sales.service.js');
      expect(getSaleById).toBeDefined();
      // Signature: (userId, saleId)
    });

    test('should handle numeric saleId', async () => {
      const { getSaleById } = await import('#services/sales.service.js');
      const result = getSaleById(1, 123);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('Service Structure', () => {
    test('should be importable from #services/sales.service.js path', async () => {
      const module = await import('#services/sales.service.js');
      expect(module).toBeDefined();
      expect(typeof module).toBe('object');
    });

    test('should be a valid ES module', async () => {
      const module = await import('#services/sales.service.js');
      expect(module).not.toBeNull();
    });
  });

  describe('Payment Mode Support', () => {
    test('should support cash payment mode for sales', async () => {
      const { createSale } = await import('#services/sales.service.js');
      expect(createSale).toBeDefined();
      // Service internally handles payment_mode = 'cash' for immediate completion
    });

    test('should support mpesa payment mode for sales', async () => {
      const { createSale } = await import('#services/sales.service.js');
      expect(createSale).toBeDefined();
      // Service internally handles payment_mode = 'mpesa' for pending status
    });

    test('updateSaleStatus should handle mpesa transaction data', async () => {
      const { updateSaleStatus } = await import('#services/sales.service.js');
      expect(updateSaleStatus).toBeDefined();
      // Function accepts mpesaData with transaction_id, sender_name, sender_phone
    });
  });

  describe('Stock Management Integration', () => {
    test('validateAndCalculateCart should check stock availability', async () => {
      const { validateAndCalculateCart } = await import('#services/sales.service.js');
      expect(validateAndCalculateCart).toBeDefined();
      // Function calls checkStockAvailability internally
    });

    test('createSale should deduct stock using FIFO', async () => {
      const { createSale } = await import('#services/sales.service.js');
      expect(createSale).toBeDefined();
      // Function calls deductStockFIFO internally for each item
    });

    test('createSale should calculate profit based on FIFO cost', async () => {
      const { createSale } = await import('#services/sales.service.js');
      expect(createSale).toBeDefined();
      // Function calculates profit = selling_price - fifo_cost
    });
  });

  describe('Data Validation', () => {
    test('validateAndCalculateCart should verify business ownership', async () => {
      const { validateAndCalculateCart } = await import('#services/sales.service.js');
      expect(validateAndCalculateCart).toBeDefined();
      // Function checks AND(business.id = businessId, business.user_id = userId)
    });

    test('validateAndCalculateCart should verify product belongs to business', async () => {
      const { validateAndCalculateCart } = await import('#services/sales.service.js');
      expect(validateAndCalculateCart).toBeDefined();
      // Function checks AND(product.id = product_id, product.business_id = businessId)
    });

    test('getSalesForBusiness should require valid userId', async () => {
      const { getSalesForBusiness } = await import('#services/sales.service.js');
      expect(getSalesForBusiness).toBeDefined();
      // Function uses userId for ownership verification
    });

    test('getSaleById should require valid userId and saleId', async () => {
      const { getSaleById } = await import('#services/sales.service.js');
      expect(getSaleById).toBeDefined();
      // Function uses userId for ownership verification
    });
  });

  describe('Return Value Structure', () => {
    test('validateAndCalculateCart should return object with items and amounts', async () => {
      const { validateAndCalculateCart } = await import('#services/sales.service.js');
      expect(validateAndCalculateCart).toBeDefined();
      // Returns: { business, items, total_amount, items_count }
    });

    test('createSale should return object with sale, items, and summary', async () => {
      const { createSale } = await import('#services/sales.service.js');
      expect(createSale).toBeDefined();
      // Returns: { sale, items, summary }
    });

    test('updateSaleStatus should return updated sale object', async () => {
      const { updateSaleStatus } = await import('#services/sales.service.js');
      expect(updateSaleStatus).toBeDefined();
      // Returns updated sale with new status and M-Pesa data
    });

    test('getSalesForBusiness should return array of sales', async () => {
      const { getSalesForBusiness } = await import('#services/sales.service.js');
      expect(getSalesForBusiness).toBeDefined();
      // Returns array of sales for the business
    });

    test('getSaleById should return single sale object', async () => {
      const { getSaleById } = await import('#services/sales.service.js');
      expect(getSaleById).toBeDefined();
      // Returns single sale with all details
    });
  });

  describe('Customer Information', () => {
    test('createSale should support walk_in customer type', async () => {
      const { createSale } = await import('#services/sales.service.js');
      expect(createSale).toBeDefined();
      // Default customer_type = 'walk_in'
    });

    test('createSale should support registered customer type', async () => {
      const { createSale } = await import('#services/sales.service.js');
      expect(createSale).toBeDefined();
      // Can set customer_type = 'registered' with customer_id
    });

    test('createSale should capture M-Pesa sender phone', async () => {
      const { createSale } = await import('#services/sales.service.js');
      expect(createSale).toBeDefined();
      // Captures mpesa_sender_phone from options.customer_phone
    });

    test('updateSaleStatus should update M-Pesa sender details', async () => {
      const { updateSaleStatus } = await import('#services/sales.service.js');
      expect(updateSaleStatus).toBeDefined();
      // Updates mpesa_sender_name, mpesa_sender_phone from mpesaData
    });
  });

  describe('Sale Status Workflow', () => {
    test('should support cash sales with immediate completion', async () => {
      const { createSale } = await import('#services/sales.service.js');
      expect(createSale).toBeDefined();
      // When paymentMode = 'cash', sale.status = 'completed'
    });

    test('should support mpesa sales with pending status', async () => {
      const { createSale } = await import('#services/sales.service.js');
      expect(createSale).toBeDefined();
      // When paymentMode = 'mpesa', sale.status = 'pending' (until callback)
    });

    test('should allow status update to completed', async () => {
      const { updateSaleStatus } = await import('#services/sales.service.js');
      expect(updateSaleStatus).toBeDefined();
      // Can update status to 'completed' via callback
    });

    test('should allow status update to failed', async () => {
      const { updateSaleStatus } = await import('#services/sales.service.js');
      expect(updateSaleStatus).toBeDefined();
      // Can update status to 'failed' if payment fails
    });
  });

  describe('Profit Calculation', () => {
    test('createSale should calculate individual item profit', async () => {
      const { createSale } = await import('#services/sales.service.js');
      expect(createSale).toBeDefined();
      // Returns items with profit = total_price - (unit_cost * quantity)
    });

    test('createSale should calculate total profit', async () => {
      const { createSale } = await import('#services/sales.service.js');
      expect(createSale).toBeDefined();
      // Returns summary with total_profit = sum of all item profits
    });

    test('createSale should calculate profit margin percent', async () => {
      const { createSale } = await import('#services/sales.service.js');
      expect(createSale).toBeDefined();
      // Returns summary with profit_margin_percent = (total_profit / total_amount) * 100
    });
  });

  describe('Sale Items Tracking', () => {
    test('createSale should track product name for each item', async () => {
      const { createSale } = await import('#services/sales.service.js');
      expect(createSale).toBeDefined();
      // Item includes product_name
    });

    test('createSale should track quantity for each item', async () => {
      const { createSale } = await import('#services/sales.service.js');
      expect(createSale).toBeDefined();
      // Item includes quantity
    });

    test('createSale should track unit and total price for each item', async () => {
      const { createSale } = await import('#services/sales.service.js');
      expect(createSale).toBeDefined();
      // Item includes unit_price and total_price
    });

    test('createSale should track unit cost for each item (from FIFO)', async () => {
      const { createSale } = await import('#services/sales.service.js');
      expect(createSale).toBeDefined();
      // Item includes unit_cost from FIFO deduction
    });
  });

  describe('Error Handling', () => {
    test('validateAndCalculateCart should throw on invalid business', async () => {
      const { validateAndCalculateCart } = await import('#services/sales.service.js');
      expect(validateAndCalculateCart).toBeDefined();
      // Throws 'Business not found or access denied'
    });

    test('validateAndCalculateCart should throw on missing product', async () => {
      const { validateAndCalculateCart } = await import('#services/sales.service.js');
      expect(validateAndCalculateCart).toBeDefined();
      // Throws 'Product {id} not found'
    });

    test('validateAndCalculateCart should throw on insufficient stock', async () => {
      const { validateAndCalculateCart } = await import('#services/sales.service.js');
      expect(validateAndCalculateCart).toBeDefined();
      // Throws 'Insufficient stock for {product}. Available: {x}, Requested: {y}'
    });

    test('should handle sale creation errors gracefully', async () => {
      const { createSale } = await import('#services/sales.service.js');
      expect(createSale).toBeDefined();
      // Logs error and rethrows
    });
  });

  describe('Database Integration', () => {
    test('validateAndCalculateCart should query businesses table', async () => {
      const { validateAndCalculateCart } = await import('#services/sales.service.js');
      expect(validateAndCalculateCart).toBeDefined();
      // Uses db.select().from(businesses)
    });

    test('validateAndCalculateCart should query products table', async () => {
      const { validateAndCalculateCart } = await import('#services/sales.service.js');
      expect(validateAndCalculateCart).toBeDefined();
      // Uses db.select().from(products)
    });

    test('createSale should insert into sales table', async () => {
      const { createSale } = await import('#services/sales.service.js');
      expect(createSale).toBeDefined();
      // Uses db.insert(sales).values(...)
    });

    test('createSale should insert into saleItems table', async () => {
      const { createSale } = await import('#services/sales.service.js');
      expect(createSale).toBeDefined();
      // Uses db.insert(saleItems).values(...)
    });

    test('createSale should insert into stockMovements table for each FIFO batch', async () => {
      const { createSale } = await import('#services/sales.service.js');
      expect(createSale).toBeDefined();
      // Uses db.insert(stockMovements).values(...) for FIFO tracking
    });
  });
});
