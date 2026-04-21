import { describe, it, expect } from "vitest";
import {
  buildPhase1LP,
  buildPhase1InputFromWeekFill,
  solvePhase1,
} from "./phase1";

describe("Phase 1: matchup-to-week ILP", () => {
  it("schedules a 4-team single round-robin across 3 weeks (gamesPerSession=1)", async () => {
    const teams = Array.from({ length: 4 }, (_, i) => ({
      id: `T${i + 1}`,
      name: `Team ${i + 1}`,
      division_id: "d1",
    }));
    const pattern = {
      dayOfWeek: 1,
      startTime: "18:00",
      endTime: "22:00",
      venue: null,
      courtCount: 2,
      startsOn: new Date("2026-01-05"),
      endsOn: new Date("2026-02-02"),
      durationMinutes: 60,
      skipDates: [],
    };
    const opts = {
      matchupFrequency: 1,
      gamesPerSession: 1,
      allowCrossPlay: false,
      gamesPerTeam: 3,
    };

    const input = buildPhase1InputFromWeekFill(teams, pattern, opts, 3, 2);
    const result = await solvePhase1(input);

    expect(result.status).toBe("Optimal");
    // Full RR = 6 pairs, all must be scheduled.
    expect(result.assignments.length).toBe(6);

    // Each team plays 3 games total.
    const gamesPerTeam = new Map<string, number>();
    for (const a of result.assignments) {
      const [tA, tB] = a.pairKey.split("|");
      gamesPerTeam.set(tA, (gamesPerTeam.get(tA) || 0) + 1);
      gamesPerTeam.set(tB, (gamesPerTeam.get(tB) || 0) + 1);
    }
    for (const count of gamesPerTeam.values()) {
      expect(count).toBe(3);
    }

    // Each week has exactly 2 games (capacity) and no team plays twice.
    const byWeek = new Map<number, string[]>();
    for (const a of result.assignments) {
      const arr = byWeek.get(a.week) || [];
      arr.push(a.pairKey);
      byWeek.set(a.week, arr);
    }
    for (const [, pairs] of byWeek) {
      expect(pairs.length).toBe(2);
      const teamsThisWeek = new Set<string>();
      for (const key of pairs) {
        const [a, b] = key.split("|");
        expect(teamsThisWeek.has(a)).toBe(false);
        expect(teamsThisWeek.has(b)).toBe(false);
        teamsThisWeek.add(a);
        teamsThisWeek.add(b);
      }
    }
  }, 15_000);

  it("schedules a 6-team single round-robin across 5 weeks", async () => {
    const teams = Array.from({ length: 6 }, (_, i) => ({
      id: `T${i + 1}`,
      name: `Team ${i + 1}`,
      division_id: "d1",
    }));
    const pattern = {
      dayOfWeek: 1,
      startTime: "18:00",
      endTime: "22:00",
      venue: null,
      courtCount: 3,
      startsOn: new Date("2026-01-05"),
      endsOn: new Date("2026-02-16"),
      durationMinutes: 60,
      skipDates: [],
    };
    const opts = {
      matchupFrequency: 1,
      gamesPerSession: 1,
      allowCrossPlay: false,
      gamesPerTeam: 5,
    };
    const input = buildPhase1InputFromWeekFill(teams, pattern, opts, 5, 3);
    const result = await solvePhase1(input);

    expect(result.status).toBe("Optimal");
    // C(6,2) = 15 pairs.
    expect(result.assignments.length).toBe(15);
    // Each team plays 5 games.
    const gamesPerTeam = new Map<string, number>();
    for (const a of result.assignments) {
      const [tA, tB] = a.pairKey.split("|");
      gamesPerTeam.set(tA, (gamesPerTeam.get(tA) || 0) + 1);
      gamesPerTeam.set(tB, (gamesPerTeam.get(tB) || 0) + 1);
    }
    for (const count of gamesPerTeam.values()) expect(count).toBe(5);
  }, 20_000);

  it("handles gamesPerSession=2 with two divisions", async () => {
    // 2 divisions × 4 teams each. Each team plays 2 games per night.
    // 3 weeks → 6 games per team. RR per div = C(4,2)=6 pairs per div.
    // 12 pairs total, 3 weeks × 4 courts = 12 slot capacity: tight but feasible.
    const teams = [
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `A${i + 1}`,
        name: `Alpha ${i + 1}`,
        division_id: "dA",
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `B${i + 1}`,
        name: `Bravo ${i + 1}`,
        division_id: "dB",
      })),
    ];
    const pattern = {
      dayOfWeek: 1,
      startTime: "18:00",
      endTime: "22:00",
      venue: null,
      courtCount: 4,
      startsOn: new Date("2026-01-05"),
      endsOn: new Date("2026-01-19"),
      durationMinutes: 60,
      skipDates: [],
    };
    const opts = {
      matchupFrequency: 1,
      gamesPerSession: 2,
      allowCrossPlay: false,
      gamesPerTeam: 6,
    };
    const input = buildPhase1InputFromWeekFill(teams, pattern, opts, 3, 4);
    const result = await solvePhase1(input);

    expect(result.status).toBe("Optimal");
    expect(result.assignments.length).toBe(12);

    // No team plays more than 2 games per week.
    const perTeamPerWeek = new Map<string, number>();
    for (const a of result.assignments) {
      const [tA, tB] = a.pairKey.split("|");
      for (const t of [tA, tB]) {
        const k = `${t}@${a.week}`;
        perTeamPerWeek.set(k, (perTeamPerWeek.get(k) || 0) + 1);
      }
    }
    for (const count of perTeamPerWeek.values()) {
      expect(count).toBeLessThanOrEqual(2);
    }
  }, 30_000);

  it("avoids scheduling a team in its forbidden week when capacity allows", async () => {
    // 4 teams, 3 weeks × 2 courts = 6 slots = full round-robin.
    // Team A is forbidden from playing week 2. With 6 pairs and 3 weeks,
    // the solver has to schedule A in 3 of those weeks (A plays 3 games);
    // the calendar allows this without touching week 2. Expect 0 games for A
    // in week 2.
    const teams = Array.from({ length: 4 }, (_, i) => ({
      id: `T${i + 1}`,
      name: `Team ${i + 1}`,
      division_id: "d1",
    }));
    const pattern = {
      dayOfWeek: 1,
      startTime: "18:00",
      endTime: "22:00",
      venue: null,
      courtCount: 2,
      startsOn: new Date("2026-01-05"),
      endsOn: new Date("2026-02-02"),
      durationMinutes: 60,
      skipDates: [],
    };
    const opts = {
      matchupFrequency: 1,
      gamesPerSession: 1,
      allowCrossPlay: false,
      gamesPerTeam: 3,
    };
    // Note: with 4 teams × 3 weeks × 2 courts, each team MUST play every
    // week (A plays 3 games in 3 weeks). So we use a looser setup: 6 weeks,
    // gamesPerTeam=3, giving slack to skip week 2 for team A.
    const loose = {
      ...pattern,
      endsOn: new Date("2026-02-16"),
    };
    const input = buildPhase1InputFromWeekFill(
      teams,
      loose,
      opts,
      6,
      2,
      {
        forbiddenWeeksByTeam: new Map([["T1", new Set([2])]]),
      }
    );
    const result = await solvePhase1(input);
    expect(result.status).toBe("Optimal");

    let t1PlaysWeek2 = 0;
    for (const a of result.assignments) {
      if (a.week !== 2) continue;
      const [tA, tB] = a.pairKey.split("|");
      if (tA === "T1" || tB === "T1") t1PlaysWeek2++;
    }
    expect(t1PlaysWeek2).toBe(0);
  }, 15_000);

  it("LP builder produces valid CPLEX LP format", () => {
    const teams = [
      { id: "a", name: "A", division_id: "d1" },
      { id: "b", name: "B", division_id: "d1" },
      { id: "c", name: "C", division_id: "d1" },
    ];
    const pattern = {
      dayOfWeek: 1,
      startTime: "18:00",
      endTime: "22:00",
      venue: null,
      courtCount: 2,
      startsOn: new Date("2026-01-05"),
      endsOn: new Date("2026-02-02"),
      durationMinutes: 60,
      skipDates: [],
    };
    const opts = {
      matchupFrequency: 1,
      gamesPerSession: 1,
      allowCrossPlay: false,
      gamesPerTeam: 2,
    };
    const input = buildPhase1InputFromWeekFill(teams, pattern, opts, 3, 1);
    const { lp } = buildPhase1LP(input);
    expect(lp).toContain("Minimize");
    expect(lp).toContain("Subject To");
    expect(lp).toContain("End");
    expect(lp).toContain("Binary");
  });

  it("carries prior matchup counts and skill weights into the model", async () => {
    const teams = [
      { id: "a", name: "A", division_id: "d1" },
      { id: "b", name: "B", division_id: "d1" },
      { id: "c", name: "C", division_id: "d1" },
      { id: "d", name: "D", division_id: "d1" },
    ];
    const pattern = {
      dayOfWeek: 1,
      startTime: "18:00",
      endTime: "22:00",
      venue: null,
      courtCount: 2,
      startsOn: new Date("2026-01-05"),
      endsOn: new Date("2026-01-19"),
      durationMinutes: 60,
      skipDates: [],
    };
    const opts = {
      matchupFrequency: 1,
      gamesPerSession: 1,
      allowCrossPlay: false,
      gamesPerTeam: 2,
    };
    const input = buildPhase1InputFromWeekFill(teams, pattern, opts, 3, 2, {
      existingMatchupCounts: new Map([["a|b", 1]]),
      teamWeights: new Map([
        ["a", 0.90],
        ["b", 0.85],
        ["c", 0.20],
        ["d", 0.10],
      ]),
    });

    const priorPair = input.pairs.find((p) => p.key === "a|b");
    expect(priorPair?.priorPlayed).toBe(1);
    expect(priorPair?.required).toBe(0);
    expect(priorPair?.skillAlignment).toBeCloseTo(0.95);

    const { lp } = buildPhase1LP(input);
    expect(lp).toContain("50 x_a_b_w1");
    expect(lp).toContain("-25.650 x_a_b_w1");

    const result = await solvePhase1(input);
    expect(result.status).toBe("Optimal");
  }, 15_000);
});
