import type { Team } from "@/lib/types";
import type {
  WeekFillPattern,
  WeekFillResult,
  WeekFillTeam,
} from "@/lib/scheduling/week-fill";

export interface ScenarioTeam {
  id: string;
  name: string;
  division: string | null;
}

export function buildTeams(teams: ScenarioTeam[]): {
  weekFillTeams: WeekFillTeam[];
  teamsMap: Map<string, Pick<Team, "id" | "name" | "preferences">>;
} {
  const weekFillTeams = teams.map((t) => ({
    id: t.id,
    name: t.name,
    division_id: t.division,
  }));
  const teamsMap = new Map(
    teams.map((t) => [t.id, { id: t.id, name: t.name, preferences: undefined }])
  );
  return { weekFillTeams, teamsMap };
}

export function defaultPattern(overrides: Partial<WeekFillPattern> = {}): WeekFillPattern {
  return {
    dayOfWeek: 1, // Monday
    startTime: "18:00",
    endTime: "22:00",
    venue: null,
    courtCount: 3,
    startsOn: new Date("2026-01-05"), // Mon
    endsOn: new Date("2026-04-27"), // ~17 Mondays; scenarios trim via endsOn
    durationMinutes: 60,
    skipDates: [],
    ...overrides,
  };
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface InvariantReport {
  ok: boolean;
  violations: string[];
  stats: {
    games: number;
    weeks: number;
    gamesPerTeam: { min: number; max: number; avg: number };
    uniquePairs: number;
    repeatPairs: number;
    byesByTeam: Map<string, number>;
    backToBackByes: number;
  };
}

export interface InvariantOpts {
  /** Max games-per-team spread tolerated (max − min ≤ spread). */
  maxGamesSpread?: number;
  /** When set, cross-division pairs outside this allowlist flag a violation. */
  crossPlayAllowed?: Array<[string, string]>;
  /** When true, disallow any cross-division game. */
  strictWithinDivision?: boolean;
  /** Extra slack for collision check (should always be 0). */
}

export function checkInvariants(
  result: WeekFillResult,
  teams: ScenarioTeam[],
  pattern: WeekFillPattern,
  opts: InvariantOpts = {}
): InvariantReport {
  const violations: string[] = [];
  const teamById = new Map(teams.map((t) => [t.id, t]));

  // 1. No team double-booked in a single (date, slot). Two games can share a
  //    date+time only if they're on different courts.
  const slotBookings = new Map<string, Set<string>>();
  for (const g of result.games) {
    const slot = g.scheduledAt.toISOString();
    const booked = slotBookings.get(slot) ?? new Set<string>();
    for (const tid of [g.home, g.away]) {
      if (booked.has(tid)) {
        violations.push(`team ${tid} double-booked at ${slot}`);
      }
      booked.add(tid);
    }
    slotBookings.set(slot, booked);
  }

  // 2. Per-team games within [0, targetWeeks * gamesPerSession] (loose upper).
  const gamesPerTeam = new Map<string, number>();
  for (const t of teams) gamesPerTeam.set(t.id, 0);
  for (const g of result.games) {
    gamesPerTeam.set(g.home, (gamesPerTeam.get(g.home) ?? 0) + 1);
    gamesPerTeam.set(g.away, (gamesPerTeam.get(g.away) ?? 0) + 1);
  }
  const counts = [...gamesPerTeam.values()];
  const min = counts.length ? Math.min(...counts) : 0;
  const max = counts.length ? Math.max(...counts) : 0;
  const avg = counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;

  if (opts.maxGamesSpread !== undefined && max - min > opts.maxGamesSpread) {
    violations.push(
      `games-per-team spread ${max - min} exceeds allowed ${opts.maxGamesSpread} (min=${min}, max=${max})`
    );
  }

  // 3. Crossplay rules.
  const allowedCross = new Set(
    (opts.crossPlayAllowed ?? []).map(([a, b]) => pairKey(a, b))
  );
  for (const g of result.games) {
    const home = teamById.get(g.home);
    const away = teamById.get(g.away);
    if (!home || !away) continue;
    if (home.division === away.division) continue;
    if (opts.strictWithinDivision) {
      violations.push(
        `cross-division game: ${g.home}(${home.division}) vs ${g.away}(${away.division})`
      );
      continue;
    }
    if (allowedCross.size > 0 && home.division && away.division) {
      const key = pairKey(home.division, away.division);
      if (!allowedCross.has(key)) {
        violations.push(
          `crossplay not allowed between ${home.division} and ${away.division}`
        );
      }
    }
  }

  // 4. Pattern day-of-week respected.
  for (const g of result.games) {
    if (g.scheduledAt.getDay() !== pattern.dayOfWeek) {
      violations.push(`game on wrong day: ${g.scheduledAt.toISOString()} (dow=${g.scheduledAt.getDay()})`);
    }
  }

  // 5. Pairs
  const pairCount = new Map<string, number>();
  for (const g of result.games) {
    const k = pairKey(g.home, g.away);
    pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
  }
  let repeatPairs = 0;
  for (const n of pairCount.values()) if (n > 1) repeatPairs++;

  // 6. BYE book-keeping
  const byesByTeam = new Map<string, number>();
  for (const b of result.byes) {
    byesByTeam.set(b.teamId, (byesByTeam.get(b.teamId) ?? 0) + 1);
  }
  const backToBack = result.byes.filter((b) => b.backToBack).length;

  return {
    ok: violations.length === 0,
    violations,
    stats: {
      games: result.games.length,
      weeks: result.targetWeeks,
      gamesPerTeam: { min, max, avg },
      uniquePairs: pairCount.size,
      repeatPairs,
      byesByTeam,
      backToBackByes: backToBack,
    },
  };
}
