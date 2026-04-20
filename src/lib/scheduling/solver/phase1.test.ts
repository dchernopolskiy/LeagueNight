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
});
