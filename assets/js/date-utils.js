const DATE_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function parseDateInput(value) {
  if (!value) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

export function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "—";
  }

  return DATE_FORMATTER.format(date);
}

export function toInputValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function compareDates(left, right) {
  return left.getTime() - right.getTime();
}

export function addMonths(date, months) {
  const provisional = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1),
  );
  const lastDay = new Date(
    Date.UTC(provisional.getUTCFullYear(), provisional.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDay);
  return new Date(Date.UTC(provisional.getUTCFullYear(), provisional.getUTCMonth(), day));
}

export function addYears(date, years) {
  const targetYear = date.getUTCFullYear() + years;
  const lastDay = new Date(Date.UTC(targetYear, date.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDay);
  return new Date(Date.UTC(targetYear, date.getUTCMonth(), day));
}

export function subtractDays(date, days) {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

export function isValidDate(date) {
  return date instanceof Date && !Number.isNaN(date.getTime());
}

export function formatDateRange(startDate, endDate) {
  if (!isValidDate(startDate) || !isValidDate(endDate)) {
    return "期間未確定";
  }

  return `${formatDate(startDate)}〜${formatDate(endDate)}`;
}
