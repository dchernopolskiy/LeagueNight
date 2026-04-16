/**
 * Scheduling date utilities for LeagueNight
 */

/**
 * Parse a local date string (handles both YYYY-MM-DD and YYYY-MM-DDTHH:mm:ss formats).
 * Date-only strings like "2026-04-06" are parsed as UTC midnight, which shifts the day
 * backward in western timezones. This function appends T00:00:00 to force local-time parsing.
 */
export function parseLocalDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  return new Date(dateStr.includes("T") ? dateStr : `${dateStr}T00:00:00`);
}

/**
 * Format a Date as YYYY-MM-DD
 */
export function formatYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Format a Date as HH:mm
 */
export function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Convert a Date whose get*() components represent the intended local time
 * in `timezone` into a correct UTC ISO string.
 *
 * On the server (UTC), `setHours(19, 0)` creates 19:00 UTC — but we actually
 * mean 19:00 in the league's timezone. This function finds the real UTC instant
 * that corresponds to those year/month/day/hour/minute values in the given tz.
 *
 * DST handling:
 * - "Spring forward" gap (e.g. 02:30 never happens): the solver produces the
 *   wall-clock that DOES exist on either side — acceptable.
 * - "Fall back" overlap (e.g. 01:30 happens twice): deterministically returns
 *   the EARLIER of the two instants. Scheduling games in duplicated local
 *   hours is already unusual, and picking the earlier instant is the common
 *   convention (matches CLDR "earlier" rule and Temporal's default).
 */
export function localToUTCISO(date: Date, timezone: string): string {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();

  const wantMs = Date.UTC(year, month, day, hours, minutes, 0);

  const wallMsInTz = (utcMs: number): number => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(utcMs));

    const get = (type: string) =>
      parseInt(parts.find((p) => p.type === type)?.value || "0");

    const gotH = get("hour") === 24 ? 0 : get("hour");
    return Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      gotH,
      get("minute"),
      0
    );
  };

  // Iteratively adjust until the wall-clock in `timezone` matches what we want
  let guess = wantMs;
  for (let i = 0; i < 3; i++) {
    const gotMs = wallMsInTz(guess);
    const drift = wantMs - gotMs;
    if (drift === 0) break;
    guess += drift;
  }

  // DST fall-back disambiguation: if shifting back one hour still produces the
  // same wall-clock, the wall-time is duplicated — prefer the earlier instant.
  const earlierCandidate = guess - 3600_000;
  if (wallMsInTz(earlierCandidate) === wantMs) {
    guess = earlierCandidate;
  }

  return new Date(guess).toISOString();
}

/**
 * Estimate how many games each team will play given total teams and games per session.
 * Simple round-robin formula.
 */
export function estimateGamesPerTeam(
  totalTeams: number,
  gamesPerSession: number,
  matchupFrequency: number = 1
): number {
  if (totalTeams < 2) return 0;
  // In a round-robin, each team plays (n-1) other teams
  return (totalTeams - 1) * matchupFrequency;
}

/**
 * Build a combined list of skip dates from base dates, holidays, and optional range filtering.
 */
export function buildSkipDates(
  baseDates: string[],
  holidays: string[] = [],
  range?: { start: string; end: string }
): string[] {
  const allDates = new Set([...baseDates, ...holidays]);

  if (range) {
    const start = new Date(range.start);
    const end = new Date(range.end);

    return Array.from(allDates).filter((dateStr) => {
      const d = new Date(dateStr);
      return d >= start && d <= end;
    });
  }

  return Array.from(allDates);
}

/**
 * Get all dates in a range
 */
export function getDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);

  while (current <= end) {
    dates.push(formatYMD(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * Check if a date is a weekend
 */
export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Get the day of week name
 */
export function getDayName(dayOfWeek: number): string {
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return days[dayOfWeek] || "Unknown";
}
