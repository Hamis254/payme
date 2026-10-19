import { mergeFinancialRecords, applyRecordFilters } from '../src/utils/recordAggregation.js';

describe('record aggregation', () => {
  it('includes operational sales rows even when the mirror ledger has no entry for them', () => {
    const merged = mergeFinancialRecords([], [
      {
        type: 'sales',
        amount: '120.50',
        transaction_date: new Date('2026-01-02T10:00:00.000Z'),
        payment_method: 'cash',
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      type: 'sales',
      amount: 120.5,
      payment_method: 'cash',
    });
  });

  it('filters merged rows by type and date range', () => {
    const merged = mergeFinancialRecords(
      [
        {
          type: 'expense',
          amount: '15',
          transaction_date: new Date('2026-01-03T10:00:00.000Z'),
        },
      ],
      [
        {
          type: 'sales',
          amount: '120.50',
          transaction_date: new Date('2026-01-02T10:00:00.000Z'),
          payment_method: 'cash',
        },
        {
          type: 'sales',
          amount: '200',
          transaction_date: new Date('2026-01-05T10:00:00.000Z'),
          payment_method: 'mpesa',
        },
      ]
    );

    const filtered = applyRecordFilters(merged, {
      type: 'sales',
      start_date: new Date('2026-01-01T00:00:00.000Z'),
      end_date: new Date('2026-01-03T23:59:59.999Z'),
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toMatchObject({
      type: 'sales',
      amount: 120.5,
    });
  });
});
