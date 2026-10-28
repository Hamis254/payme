import {
  initiateMyWalletTokenPurchaseSchema,
  initiateTokenPurchaseSchema,
  tokenPackages,
} from '#validations/wallet.validation.js';

const purchaseSchemas = [
  { schema: initiateTokenPurchaseSchema, fields: { businessId: 1 } },
  { schema: initiateMyWalletTokenPurchaseSchema, fields: {} },
];

describe('token purchase package validation', () => {
  it('accepts every token package key in both purchase schemas', () => {
    for (const packageType of Object.keys(tokenPackages)) {
      const purchase = { packageType, phone: '+254700000001' };

      expect(
        initiateTokenPurchaseSchema.safeParse({
          ...purchase,
          businessId: 1,
        }).success
      ).toBe(true);
      expect(
        initiateMyWalletTokenPurchaseSchema.safeParse(purchase).success
      ).toBe(true);
    }
  });

  it('accepts custom whole-KES amounts in both purchase schemas', () => {
    const purchase = { amount: 50, phone: '+254700000001' };

    expect(
      initiateTokenPurchaseSchema.safeParse({
        ...purchase,
        businessId: 1,
      }).success
    ).toBe(true);
    expect(
      initiateMyWalletTokenPurchaseSchema.safeParse(purchase).success
    ).toBe(true);
  });

  it('requires exactly one package type or custom amount', () => {
    const phone = '+254700000001';

    for (const { schema, fields } of purchaseSchemas) {
      expect(
        schema.safeParse({
          ...fields,
          phone,
        }).success
      ).toBe(false);
      expect(
        schema.safeParse({
          ...fields,
          packageType: '30',
          amount: 50,
          phone,
        }).success
      ).toBe(false);
    }
  });

  it('rejects custom amounts below the minimum or not in whole KES', () => {
    for (const { schema, fields } of purchaseSchemas) {
      for (const amount of [49, 50.5]) {
        expect(
          schema.safeParse({
            ...fields,
            amount,
            phone: '+254700000001',
          }).success
        ).toBe(false);
      }
    }
  });

  it('rejects custom amounts above the maximum', () => {
    for (const { schema, fields } of purchaseSchemas) {
      expect(
        schema.safeParse({
          ...fields,
          amount: 100_001,
          phone: '+254700000001',
        }).success
      ).toBe(false);
    }
  });
});
