jest.mock('#services/record.service.js', () => ({
  createRecord: jest.fn(),
  getRecords: jest.fn(),
  getRecordById: jest.fn(),
  calculateTotals: jest.fn(),
  getDashboardInsights: jest.fn(),
}));

jest.mock('#services/statementService.js', () => ({
  generateBusinessStatement: jest.fn(),
}));

jest.mock('#services/sales.service.js', () => ({
  getStatementFinancials: jest.fn(),
}));

import { resolveStatementRange, toBusinessDayKey } from '#utils/businessDay.js';
import {
  generateStatementSchema,
  statementRangeSchema,
} from '#validations/record.validation.js';
import { getStatementFinancialsPreview } from '../src/controllers/record.controller.js';
import { getStatementFinancials } from '#services/sales.service.js';

// 14:30 Nairobi on 2026-10-23. Pinned so "today" is deterministic.
const NOW = new Date('2026-10-23T14:30:00+03:00');

describe('resolveStatementRange', () => {
  it('defaults the end to today in Nairobi when omitted', () => {
    const { startKey, endKey, end } = resolveStatementRange('2026-10-01', undefined, NOW);

    expect(startKey).toBe('2026-10-01');
    expect(endKey).toBe('2026-10-23');
    expect(end.toISOString()).toBe(new Date('2026-10-23T23:59:59.999+03:00').toISOString());
  });

  it('clamps an end date in the future to today', () => {
    const { endKey } = resolveStatementRange('2026-10-01', '2026-12-31', NOW);

    expect(endKey).toBe('2026-10-23');
  });

  it('reduces a full ISO end datetime to its Nairobi day, then covers that whole day', () => {
    const { endKey, end } = resolveStatementRange(
      '2026-10-01',
      '2026-10-20T08:15:00+03:00',
      NOW
    );

    expect(endKey).toBe('2026-10-20');
    expect(end.toISOString()).toBe(new Date('2026-10-20T23:59:59.999+03:00').toISOString());
  });

  it('keeps the last day of a bare YYYY-MM-DD end date (regression: UTC midnight)', () => {
    const { end } = resolveStatementRange('2026-07-01', '2026-07-20', NOW);

    // A Date coerced from '2026-07-20' would be 2026-07-20T00:00Z, which is 03:00
    // Nairobi. The end must instead be 23:59:59.999 Nairobi on the 20th.
    expect(end.toISOString()).toBe(new Date('2026-07-20T23:59:59.999+03:00').toISOString());
  });

  it('throws a RangeError for an unparseable date', () => {
    expect(() => resolveStatementRange('not-a-date', undefined, NOW)).toThrow(RangeError);
  });
});

describe('toBusinessDayKey', () => {
  it('passes a bare day through and reduces an ISO datetime to its Nairobi day', () => {
    expect(toBusinessDayKey('2026-10-23')).toBe('2026-10-23');
    // 23:30 UTC on the 22nd is already the 23rd in Nairobi.
    expect(toBusinessDayKey('2026-10-22T23:30:00Z')).toBe('2026-10-23');
  });
});

describe('sale at 14:00 EAT today appears in a statement ending today', () => {
  it('falls inside the window for end_date = today', () => {
    const sale = new Date('2026-10-23T14:00:00+03:00');
    const { start, end } = resolveStatementRange('2026-10-01', '2026-10-23', NOW);

    expect(sale.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(sale.getTime()).toBeLessThanOrEqual(end.getTime());
  });

  it('is inside the preview window the controller passes to getStatementFinancials', async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    try {
      getStatementFinancials.mockResolvedValue({ ledgerRows: [], totals: {} });

      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();
      await getStatementFinancialsPreview(
        { params: { business_id: '7' }, query: { start_date: '2026-10-01', end_date: '2026-10-23' } },
        res,
        next
      );

      const [, start, end] = getStatementFinancials.mock.calls[0];
      const sale = new Date('2026-10-23T14:00:00+03:00');
      expect(sale.getTime()).toBeGreaterThanOrEqual(start.getTime());
      expect(sale.getTime()).toBeLessThanOrEqual(end.getTime());
      expect(next).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('statement date schemas', () => {
  it('keeps YYYY-MM-DD as a string instead of coercing it to a Date', () => {
    const parsed = generateStatementSchema.parse({
      business_id: 7,
      start_date: '2026-07-01',
      end_date: '2026-07-20',
    });

    expect(parsed.start_date).toBe('2026-07-01');
    expect(parsed.end_date).toBe('2026-07-20');
  });

  it('accepts a full ISO datetime with an offset', () => {
    const parsed = generateStatementSchema.parse({
      business_id: 7,
      start_date: '2026-07-01T00:00:00+03:00',
      end_date: '2026-07-20T12:00:00+03:00',
    });

    expect(parsed.end_date).toBe('2026-07-20T12:00:00+03:00');
  });

  it('rejects an impossible calendar day', () => {
    const result = generateStatementSchema.safeParse({
      business_id: 7,
      start_date: '2026-02-30',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an end date before the start date, comparing Nairobi days', () => {
    const result = statementRangeSchema.safeParse({
      start_date: '2026-07-20',
      end_date: '2026-07-01',
    });

    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toMatch(/cannot be before start_date/);
  });
});
