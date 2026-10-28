import { formatAccountAge } from '#utils/formatAccountAge.js';

describe('formatAccountAge', () => {
  it('formats an age in days using Nairobi calendar dates', () => {
    expect(
      formatAccountAge('2026-10-10T21:00:00.000Z', '2026-10-22T21:00:00.000Z')
    ).toBe('12 days');
  });

  it('formats completed months', () => {
    expect(
      formatAccountAge('2026-03-15T09:00:00+03:00', '2026-10-15T09:00:00+03:00')
    ).toBe('7 months');
  });

  it('formats years with remaining months', () => {
    expect(
      formatAccountAge('2025-08-15T09:00:00+03:00', '2026-10-15T09:00:00+03:00')
    ).toBe('1 year 2 months');
  });

  it('uses completed calendar months when the current day is earlier', () => {
    expect(
      formatAccountAge('2026-03-31T09:00:00+03:00', '2026-04-30T09:00:00+03:00')
    ).toBe('30 days');
  });

  it('returns zero days for future dates and N/A for invalid dates', () => {
    expect(
      formatAccountAge('2026-10-24T09:00:00+03:00', '2026-10-23T09:00:00+03:00')
    ).toBe('0 days');
    expect(formatAccountAge('invalid', '2026-10-23T09:00:00+03:00')).toBe(
      'N/A'
    );
  });
});
