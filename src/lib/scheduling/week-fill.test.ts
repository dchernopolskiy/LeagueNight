import { describe, it, expect } from "vitest";
import { fillScheduleByWeek, schedulePreflight } from "./week-fill";
import {
  buildTeams,
  checkInvariants,
  defaultPattern,
  type ScenarioTeam,
} from "./__fixtures__/helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Scenarios
//
// Each scenario locks a realistic league configuration and asserts the
// scheduler's output satisfies a shared invariant checker. New tests should
// follow this shape: a tiny teams[] list, a pattern, the opts you actually use
// in prod, and an invariant call with a short justification for any loose
// bounds. The goal is regression-safety, not exhaustive coverage — that's the
// fast-check layer (Chunk 2).
// ─────────────────────────────────────────────────────────────────────────────

function mkTeams(count: number, division: string | null, prefix: string): ScenarioTeam[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i + 1}`,
    name: `${prefix} ${i + 1}`,
    division,
  }));
}

describe("scheduler: single-division round-robin", () => {
  it("6-team league plays a full single round-robin in 5 weeks", () => {
    const teams = mkTeams(6, "d1", "T");
    const { weekFillTeams, teamsMap } = buildTeams(teams);
    const pattern = defaultPattern({
      courtCount: 3,
      endsOn: new Date("2026-02-16"), // ~6 Mondays available
    });

    const result = fillScheduleByWeek({
      teams: weekFillTeams,
      pattern,
      opts: {
        matchupFrequency: 1,
        gamesPerSession: 1,
        allowCrossPlay: false,
        gamesPerTeam: 5,
      },
      teamsMap,
    });

    const report = checkInvariants(result, teams, pattern, {
      maxGamesSpread: 0,
      strictWithinDivision: true,
    });

    expect(report.violations).toEqual([]);
    // Full round-robin on 6 teams = 15 pairings.
    expect(report.stats.uniquePairs).toBe(15);
    expect(report.stats.repeatPairs).toBe(0);
    expect(report.stats.gamesPerTeam.min).toBe(5);
    expect(report.stats.gamesPerTeam.max).toBe(5);
  });

  it("odd-team count tolerates a per-week BYE", () => {
    const teams = mkTeams(7, "d1", "T");
    const { weekFillTeams, teamsMap } = buildTeams(teams);
    const pattern = defaultPattern({
      courtCount: 3,
      endsOn: new Date("2026-02-23"), // 7 Mondays
    });

    const result = fillScheduleByWeek({
      teams: weekFillTeams,
      pattern,
      opts: {
        matchupFrequency: 1,
        gamesPerSession: 1,
        allowCrossPlay: false,
        gamesPerTeam: 6,
      },
      teamsMap,
    });

    const report = checkInvariants(result, teams, pattern, {
      maxGamesSpread: 1,
      strictWithinDivision: true,
    });

    expect(report.violations).toEqual([]);
    // 7 teams: full RR = 21 pairs. Each team plays 6 games.
    expect(report.stats.uniquePairs).toBe(21);
    expect(report.stats.gamesPerTeam.max).toBe(6);
  });
});

describe("scheduler: multi-division with crossplay", () => {
  it("A/B+/B with restricted crossplay (A↔B+, B+↔B only)", () => {
    const teams: ScenarioTeam[] = [
      ...mkTeams(5, "A", "A"),
      ...mkTeams(5, "BP", "BP"),
      ...mkTeams(5, "B", "B"),
    ];
    const { weekFillTeams, teamsMap } = buildTeams(teams);
    const pattern = defaultPattern({
      courtCount: 4,
      endsOn: new Date("2026-04-27"),
    });

    const result = fillScheduleByWeek({
      teams: weekFillTeams,
      pattern,
      opts: {
        matchupFrequency: 1,
        gamesPerSession: 2,
        allowCrossPlay: true,
        crossPlayRules: [
          { division_a_id: "A", division_b_id: "BP" },
          { division_a_id: "BP", division_b_id: "B" },
        ],
        gamesPerTeam: 12,
      },
      teamsMap,
    });

    // Games-per-team spread is observed to be up to 3 in mixed crossplay
    // scenarios — the scheduler favors pair coverage over perfect parity once
    // crossplay rules restrict the pool. Tighten this bound if the scheduler
    // learns to balance per-team counts under crossplay.
    const report = checkInvariants(result, teams, pattern, {
      maxGamesSpread: 3,
      crossPlayAllowed: [
        ["A", "BP"],
        ["BP", "B"],
      ],
    });

    expect(report.violations).toEqual([]);
    // 15 teams × 12 games / 2 per game = ~90 games expected.
    expect(report.stats.games).toBeGreaterThanOrEqual(80);
  });
});

describe("scheduler: games_per_team > round-robin", () => {
  it("extends season length to hit the games-per-team target", () => {
    const teams = mkTeams(4, "d1", "T");
    const { weekFillTeams, teamsMap } = buildTeams(teams);
    const pattern = defaultPattern({
      courtCount: 2,
      endsOn: new Date("2026-04-27"), // plenty of weeks
    });

    // 4 teams: full RR = 3 rounds. Asking for 10 games/team forces repeats
    // across ~10 weeks.
    const preflight = schedulePreflight(
      weekFillTeams,
      pattern,
      { matchupFrequency: 1, gamesPerSession: 1, gamesPerTeam: 10 }
    );
    expect(preflight.targetWeeks).toBeGreaterThanOrEqual(10);

    const result = fillScheduleByWeek({
      teams: weekFillTeams,
      pattern,
      opts: {
        matchupFrequency: 1,
        gamesPerSession: 1,
        allowCrossPlay: false,
        gamesPerTeam: 10,
      },
      teamsMap,
    });

    const report = checkInvariants(result, teams, pattern, {
      maxGamesSpread: 1,
      strictWithinDivision: true,
    });

    expect(report.violations).toEqual([]);
    expect(report.stats.gamesPerTeam.max).toBeGreaterThanOrEqual(9);
    // Repeats are expected and healthy here — not a violation.
    expect(report.stats.repeatPairs).toBeGreaterThan(0);
  });
});

describe("scheduler: tiny 4-team league", () => {
  it("schedules a minimal round-robin without collisions", () => {
    const teams = mkTeams(4, "d1", "T");
    const { weekFillTeams, teamsMap } = buildTeams(teams);
    const pattern = defaultPattern({
      courtCount: 2,
      endsOn: new Date("2026-02-02"), // 4 Mondays
    });

    const result = fillScheduleByWeek({
      teams: weekFillTeams,
      pattern,
      opts: {
        matchupFrequency: 1,
        gamesPerSession: 1,
        allowCrossPlay: false,
        gamesPerTeam: 3,
      },
      teamsMap,
    });

    const report = checkInvariants(result, teams, pattern, {
      maxGamesSpread: 0,
      strictWithinDivision: true,
    });

    expect(report.violations).toEqual([]);
    expect(report.stats.uniquePairs).toBe(6); // C(4,2)
    expect(report.stats.gamesPerTeam.min).toBe(3);
  });
});

describe("scheduler: truncation under tight calendar", () => {
  it("reports droppedPairs when endsOn forces truncation", () => {
    const teams = mkTeams(8, "d1", "T");
    const { weekFillTeams, teamsMap } = buildTeams(teams);
    // 8 teams → full RR = 7 weeks. Only 3 Mondays available.
    const pattern = defaultPattern({
      courtCount: 4,
      startsOn: new Date("2026-01-05"),
      endsOn: new Date("2026-01-19"),
    });

    const preflight = schedulePreflight(
      weekFillTeams,
      pattern,
      { matchupFrequency: 1, gamesPerSession: 1, gamesPerTeam: 7 }
    );
    expect(preflight.fits).toBe(false);
    expect(preflight.droppedPairCount).toBeGreaterThan(0);

    const result = fillScheduleByWeek({
      teams: weekFillTeams,
      pattern,
      opts: {
        matchupFrequency: 1,
        gamesPerSession: 1,
        allowCrossPlay: false,
        acceptTruncation: true,
        gamesPerTeam: 7,
      },
      teamsMap,
    });

    const report = checkInvariants(result, teams, pattern, {
      maxGamesSpread: 2,
      strictWithinDivision: true,
    });

    expect(report.violations).toEqual([]);
    // Under truncation we expect fewer games than the full RR.
    expect(report.stats.games).toBeLessThan(28); // C(8,2)=28
  });
});
