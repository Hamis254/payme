const NAIROBI_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Nairobi',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

function getNairobiDate(date) {
  if (!date || isNaN(date.getTime())) return null;

  const parts = Object.fromEntries(
    NAIROBI_DATE_FORMATTER.formatToParts(date).map(({ type, value }) => [
      type,
      value,
    ])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function calendarDayNumber({ year, month, day }) {
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

export function formatAccountAge(createdAt, now) {
  const createdDate = getNairobiDate(new Date(createdAt));
  const currentDate = getNairobiDate(new Date(now));

  if (!createdDate || !currentDate) return 'N/A';

  const dayDifference =
    calendarDayNumber(currentDate) - calendarDayNumber(createdDate);
  if (dayDifference <= 0) return '0 days';

  let months =
    (currentDate.year - createdDate.year) * 12 +
    currentDate.month -
    createdDate.month;
  if (currentDate.day < createdDate.day) months -= 1;

  if (months < 1) {
    return `${dayDifference} ${dayDifference === 1 ? 'day' : 'days'}`;
  }

  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;

  if (years === 0) {
    return `${months} ${months === 1 ? 'month' : 'months'}`;
  }

  const yearLabel = `${years} ${years === 1 ? 'year' : 'years'}`;
  if (remainingMonths === 0) return yearLabel;

  const monthLabel = remainingMonths === 1 ? 'month' : 'months';
  return `${yearLabel} ${remainingMonths} ${monthLabel}`;
}
