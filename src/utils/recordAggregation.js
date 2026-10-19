import { startOfBusinessDay, endOfBusinessDay } from '#utils/businessDay.js';

function normalizeRecordRow(row) {
  const transactionDate = row.transaction_date || row.created_at || row.payment_date;
  return {
    ...row,
    amount: Number(row.amount ?? 0),
    transaction_date: transactionDate ? new Date(transactionDate) : null,
  };
}

export function mergeFinancialRecords(mirrorRecords = [], operationalRows = []) {
  const merged = [];

  for (const row of [...mirrorRecords, ...operationalRows]) {
    const normalized = normalizeRecordRow(row);
    if (!normalized.transaction_date || Number.isNaN(normalized.transaction_date.getTime())) {
      continue;
    }

    merged.push(normalized);
  }

  return merged.sort((a, b) => {
    const timeA = a.transaction_date ? a.transaction_date.getTime() : 0;
    const timeB = b.transaction_date ? b.transaction_date.getTime() : 0;
    return timeA - timeB;
  });
}

export function applyRecordFilters(records = [], filters = {}) {
  const { type = null, payment_method = null, start_date = null, end_date = null } = filters;

  return records.filter(record => {
    if (type && record.type !== type) {
      return false;
    }

    if (payment_method && record.payment_method !== payment_method) {
      return false;
    }

    const transactionDate = record.transaction_date;
    if (start_date && transactionDate && transactionDate < startOfBusinessDay(start_date)) {
      return false;
    }

    if (end_date && transactionDate && transactionDate > endOfBusinessDay(end_date)) {
      return false;
    }

    return true;
  });
}
