/**
 * US Federal Holidays and common scheduling blackout dates
 */
export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
}

/**
 * Fixed-date US federal holidays
 */
export const FIXED_US_HOLIDAYS: Holiday[] = [
  { date: "01-01", name: "New Year's Day" },
  { date: "07-04", name: "Independence Day" },
  { date: "11-11", name: "Veterans Day" },
  { date: "12-25", name: "Christmas Day" },
];

/**
 * Calculate US federal holidays for a given year.
 * Includes both fixed and floating holidays.
 */
export function getUSHolidays(year: number): Holiday[] {
  const holidays: Holiday[] = [];

  // Add fixed holidays
  FIXED_US_HOLIDAYS.forEach((h) => {
    holidays.push({
      date: `${year}-${h.date}`,
      name: h.name,
    });
  });

  // MLK Day - Third Monday of January
  holidays.push({
    date: getNthWeekdayOfMonth(year, 0, 1, 3), // January, Monday, 3rd
    name: "Martin Luther King Jr. Day",
  });

  // Presidents Day - Third Monday of February
  holidays.push({
    date: getNthWeekdayOfMonth(year, 1, 1, 3), // February, Monday, 3rd
    name: "Presidents Day",
  });

  // Memorial Day - Last Monday of May
  holidays.push({
    date: getLastWeekdayOfMonth(year, 4, 1), // May, Monday
    name: "Memorial Day",
  });

  // Labor Day - First Monday of September
  holidays.push({
    date: getNthWeekdayOfMonth(year, 8, 1, 1), // September, Monday, 1st
    name: "Labor Day",
  });

  // Thanksgiving - Fourth Thursday of November
  holidays.push({
    date: getNthWeekdayOfMonth(year, 10, 4, 4), // November, Thursday, 4th
    name: "Thanksgiving",
  });

  return holidays.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Get the Nth occurrence of a weekday in a month.
 * @param year - Year
 * @param month - Month (0-11)
 * @param weekday - Day of week (0=Sun, 1=Mon, ..., 6=Sat)
 * @param n - Which occurrence (1st, 2nd, 3rd, etc.)
 */
function getNthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  n: number
): string {
  const firstDay = new Date(year, month, 1);
  const firstWeekday = firstDay.getDay();

  // Calculate days until target weekday
  let daysUntil = (weekday - firstWeekday + 7) % 7;
  if (daysUntil === 0 && firstWeekday !== weekday) daysUntil = 7;

  // Calculate the date
  const date = 1 + daysUntil + (n - 1) * 7;
  const d = new Date(year, month, date);

  return formatYMD(d);
}

/**
 * Get the last occurrence of a weekday in a month.
 */
function getLastWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number
): string {
  // Start from the last day of the month
  const lastDay = new Date(year, month + 1, 0);
  const lastDate = lastDay.getDate();
  const lastWeekday = lastDay.getDay();

  // Calculate days back to target weekday
  let daysBack = (lastWeekday - weekday + 7) % 7;

  const date = lastDate - daysBack;
  const d = new Date(year, month, date);

  return formatYMD(d);
}

/**
 * Get all holidays in a date range.
 */
export function getHolidaysInRange(
  startDate: string,
  endDate: string
): Holiday[] {
  const start = new Date(startDate);
  const end = new Date(endDate);

  const startYear = start.getFullYear();
  const endYear = end.getFullYear();

  const allHolidays: Holiday[] = [];

  for (let year = startYear; year <= endYear; year++) {
    allHolidays.push(...getUSHolidays(year));
  }

  // Filter to only holidays in range
  return allHolidays.filter((h) => {
    const holidayDate = new Date(h.date);
    return holidayDate >= start && holidayDate <= end;
  });
}

/**
 * Format a date as YYYY-MM-DD
 */
function formatYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
