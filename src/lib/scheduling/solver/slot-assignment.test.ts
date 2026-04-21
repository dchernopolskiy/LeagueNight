import { describe, it, expect } from "vitest";
import { buildPhase2LP, solvePhase2, type Phase2Game } from "./slot-assignment";

describe("Phase 2: slot/court ILP", () => {
  it("places 2 games in 2 buckets × 1 court with adjacent scheduling", async () => {
    // Two games, 2 buckets, 1 court each. Only 2 assignments possible: any
    // permutation. No team plays twice, so adjacency doesn't matter. Both
    // solutions are optimal with objective 0.
    const games: Phase2Game[] = [
      { id: "g1", pairKey: "A|B", teamA: "A", teamB: "B" },
      { id: "g2", pairKey: "C|D", teamA: "C", teamB: "D" },
    ];
    const result = await solvePhase2({
      games,
      buckets: 2,
      courtsPerBucket: 1,
    });

    expect(result.status).toBe("Optimal");
    expect(result.slots.length).toBe(2);
    const byBucket = new Map<number, string[]>();
    for (const s of result.slots) {
      const arr = byBucket.get(s.bucket) || [];
      arr.push(s.gameId);
      byBucket.set(s.bucket, arr);
    }
    expect(byBucket.size).toBe(2);
  });

  it("uses parallel courts before spilling games into later buckets", async () => {
    const games: Phase2Game[] = [
      { id: "g1", pairKey: "A|B", teamA: "A", teamB: "B" },
      { id: "g2", pairKey: "C|D", teamA: "C", teamB: "D" },
    ];
    const result = await solvePhase2({
      games,
      buckets: 3,
      courtsPerBucket: 2,
    });

    expect(result.status).toBe("Optimal");
    expect(result.slots.map((s) => s.bucket).sort()).toEqual([0, 0]);
  }, 15_000);

  it("keeps a team's two games in adjacent buckets", async () => {
    // Team X plays 2 games. Given 3 buckets × 2 courts, the optimal placement
    // puts X's games in bucket 0 and bucket 1 (adjacent). A non-adjacent
    // placement (bucket 0 and bucket 2) would incur the gap penalty.
    const games: Phase2Game[] = [
      { id: "g1", pairKey: "X|Y", teamA: "X", teamB: "Y" },
      { id: "g2", pairKey: "X|Z", teamA: "X", teamB: "Z" },
      { id: "g3", pairKey: "P|Q", teamA: "P", teamB: "Q" },
    ];
    const result = await solvePhase2({
      games,
      buckets: 3,
      courtsPerBucket: 2,
    });

    expect(result.status).toBe("Optimal");

    // Find X's two buckets.
    const xBuckets: number[] = [];
    for (const s of result.slots) {
      const game = games.find((g) => g.id === s.gameId)!;
      if (game.teamA === "X" || game.teamB === "X") {
        xBuckets.push(s.bucket);
      }
    }
    xBuckets.sort((a, b) => a - b);
    expect(xBuckets.length).toBe(2);
    expect(xBuckets[1] - xBuckets[0]).toBe(1);
  }, 15_000);

  it("keeps a team's games at one location when venue slots are provided", async () => {
    const games: Phase2Game[] = [
      { id: "g1", pairKey: "X|Y", teamA: "X", teamB: "Y" },
      { id: "g2", pairKey: "X|Z", teamA: "X", teamB: "Z" },
    ];
    const result = await solvePhase2({
      games,
      buckets: 2,
      courtSlots: [
        { locationId: "reeves", locationName: "Reeves", courtNum: 1, totalCourts: 1 },
        { locationId: "marshall", locationName: "Marshall", courtNum: 1, totalCourts: 1 },
      ],
    });

    expect(result.status).toBe("Optimal");
    const xSlots = result.slots.filter((slot) => {
      const game = games.find((g) => g.id === slot.gameId)!;
      return game.teamA === "X" || game.teamB === "X";
    });
    expect(xSlots).toHaveLength(2);
    expect(new Set(xSlots.map((slot) => slot.locationId))).toEqual(new Set(["reeves"]));
  }, 15_000);

  it("honors a team's early time preference when capacity allows", async () => {
    // 2 games across 4 buckets × 1 court. Team A prefers early; it should
    // land in bucket 0 or 1 (the early half), not 2 or 3.
    const games: Phase2Game[] = [
      { id: "g1", pairKey: "A|B", teamA: "A", teamB: "B" },
      { id: "g2", pairKey: "C|D", teamA: "C", teamB: "D" },
    ];
    const result = await solvePhase2({
      games,
      buckets: 4,
      courtsPerBucket: 1,
      teamPreferences: [
        { teamId: "A", prefer: "early", source: "preferred_time" },
      ],
    });
    expect(result.status).toBe("Optimal");
    const aSlot = result.slots.find((s) => s.gameId === "g1")!;
    expect(aSlot.bucket).toBeLessThan(2);
    expect(aSlot.preferenceHits).toEqual([
      { teamId: "A", source: "preferred_time" },
    ]);
  }, 15_000);

  it("prefers week_specific_time over preferred_time when both are set", async () => {
    // Team A has preferred_time=early but week_specific=late. Expect late.
    const games: Phase2Game[] = [
      { id: "g1", pairKey: "A|B", teamA: "A", teamB: "B" },
      { id: "g2", pairKey: "C|D", teamA: "C", teamB: "D" },
    ];
    const result = await solvePhase2({
      games,
      buckets: 4,
      courtsPerBucket: 1,
      teamPreferences: [
        { teamId: "A", prefer: "late", source: "week_specific_time" },
      ],
    });
    expect(result.status).toBe("Optimal");
    const aSlot = result.slots.find((s) => s.gameId === "g1")!;
    expect(aSlot.bucket).toBeGreaterThanOrEqual(2);
    expect(aSlot.preferenceHits).toEqual([
      { teamId: "A", source: "week_specific_time" },
    ]);
  }, 15_000);

  it("LP builder emits valid CPLEX LP with binary section", () => {
    const { lp } = buildPhase2LP({
      games: [{ id: "g1", pairKey: "A|B", teamA: "A", teamB: "B" }],
      buckets: 2,
      courtsPerBucket: 1,
    });
    expect(lp).toContain("Minimize");
    expect(lp).toContain("Subject To");
    expect(lp).toContain("Binary");
    expect(lp).toContain("End");
  });
});
