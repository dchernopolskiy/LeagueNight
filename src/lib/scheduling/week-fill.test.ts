import { describe, it, expect } from "vitest";
import { schedulePreflight } from "./week-fill";
import {
  buildTeams,
  checkInvariants,
  defaultPattern,
  type ScenarioTeam,
} from "./__fixtures__/helpers";
import { runScheduler, type SchedulerMode } from "./__fixtures__/run-scheduler";

// Engines under test. Flip to ["greedy", "solver"] once the ILP models land;
// the harness is already shape-compatible. Using `satisfies` so extending the
// list surfaces any TS mismatch.
const ENGINES: SchedulerMode[] = ["greedy", "solver"] satisfies SchedulerMode[];

function perEngine(
  name: string,
  body: (mode: SchedulerMode) => void
): void {
  for (const mode of ENGINES) {
    describe(`${name} [${mode}]`, () => body(mode));
  }
}

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

perEngine("scheduler: single-division round-robin", (mode) => {
  it("6-team league plays a full single round-robin in 5 weeks", async () => {
    const teams = mkTeams(6, "d1", "T");
    const { weekFillTeams, teamsMap } = buildTeams(teams);
    const pattern = defaultPattern({
      courtCount: 3,
      endsOn: new Date("2026-02-16"), // ~6 Mondays available
    });

    const result = await runScheduler(mode, {
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

  it("odd-team count tolerates a per-week BYE", async () => {
    const teams = mkTeams(7, "d1", "T");
    const { weekFillTeams, teamsMap } = buildTeams(teams);
    const pattern = defaultPattern({
      courtCount: 3,
      endsOn: new Date("2026-02-23"), // 7 Mondays
    });

    const result = await runScheduler(mode, {
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

perEngine("scheduler: multi-division with crossplay", (mode) => {
  it("A/B+/B with restricted crossplay (A↔B+, B+↔B only)", async () => {
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

    const result = await runScheduler(mode, {
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

perEngine("scheduler: games_per_team > round-robin", (mode) => {
  it("extends season length to hit the games-per-team target", async () => {
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

    const result = await runScheduler(mode, {
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

perEngine("scheduler: tiny 4-team league", (mode) => {
  it("schedules a minimal round-robin without collisions", async () => {
    const teams = mkTeams(4, "d1", "T");
    const { weekFillTeams, teamsMap } = buildTeams(teams);
    const pattern = defaultPattern({
      courtCount: 2,
      endsOn: new Date("2026-02-02"), // 4 Mondays
    });

    const result = await runScheduler(mode, {
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

perEngine("scheduler: within-night adjacency", (mode) => {
  it("schedules a team's two games in adjacent buckets when possible", async () => {
    // 4 teams, gamesPerSession=2, 1 court → 4 buckets per night.
    // Each team plays twice; ideal is buckets [k, k+1] not [k, k+2].
    const teams = mkTeams(4, "d1", "T");
    const { weekFillTeams, teamsMap } = buildTeams(teams);
    const pattern = defaultPattern({
      courtCount: 1,
      // 2 hours total / 30-min games = 4 slots per night
      startTime: "18:00",
      endTime: "20:00",
      durationMinutes: 30,
      endsOn: new Date("2026-01-19"), // 3 Mondays
    });

    const result = await runScheduler(mode, {
      teams: weekFillTeams,
      pattern,
      opts: {
        matchupFrequency: 1,
        gamesPerSession: 2,
        allowCrossPlay: false,
        gamesPerTeam: 6,
      },
      teamsMap,
    });

    // Count total gap-bucket-units across all teams and nights. 0 gap = every
    // team's two games are back-to-back. Allow small slack for hard cases.
    const byNight = new Map<string, typeof result.games>();
    for (const g of result.games) {
      const k = g.scheduledAt.toISOString().slice(0, 10);
      const arr = byNight.get(k) || [];
      arr.push(g);
      byNight.set(k, arr);
    }
    let totalGap = 0;
    for (const games of byNight.values()) {
      const byTeam = new Map<string, number[]>();
      for (const g of games) {
        for (const tid of [g.home, g.away]) {
          const arr = byTeam.get(tid) || [];
          arr.push(g.scheduledAt.getTime());
          byTeam.set(tid, arr);
        }
      }
      for (const buckets of byTeam.values()) {
        if (buckets.length < 2) continue;
        buckets.sort((a, b) => a - b);
        for (let k = 1; k < buckets.length; k++) {
          const slots = (buckets[k] - buckets[k - 1]) / (30 * 60_000) - 1;
          totalGap += Math.max(0, slots);
        }
      }
    }
    // This setup asks for 6 games per team across 3 Mondays, so repeats force
    // three full doubleheader nights. Greedy has a local adjacency bonus; the
    // solver's Phase 1 first optimizes season-level pairing fairness, then
    // Phase 2 minimizes within-night gaps for the chosen week graph.
    expect(totalGap).toBeLessThanOrEqual(mode === "solver" ? 4 : 3);
  });
});

perEngine("scheduler: BYE repair", (mode) => {
  it("minimizes back-to-back BYEs in a 7-team odd league", async () => {
    const teams = mkTeams(7, "d1", "T");
    const { weekFillTeams, teamsMap } = buildTeams(teams);
    const pattern = defaultPattern({
      courtCount: 3,
      endsOn: new Date("2026-02-23"),
    });

    const result = await runScheduler(mode, {
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

    const backToBack = result.byes.filter((b) => b.backToBack).length;
    // 7 teams with 1 BYE per week for 7 weeks = 7 total BYEs; a random
    // arrangement averages ~1 back-to-back. Repair should drive it to 0 or 1.
    expect(backToBack).toBeLessThanOrEqual(1);
  });
});

perEngine("scheduler: truncation under tight calendar", (mode) => {
  it("reports droppedPairs when endsOn forces truncation", async () => {
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

    const result = await runScheduler(mode, {
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
