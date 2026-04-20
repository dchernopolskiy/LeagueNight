// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — per-week slot/court assignment via ILP (HiGHS).
//
// Given Phase 1's pair→week decisions, Phase 2 places each game on a specific
// time bucket and court within that week. The model minimizes non-adjacency
// for teams playing multiple games on the same night (so two games land in
// neighboring buckets instead of with 45-min gaps between).
//
// Multi-venue assignment is NOT handled here — it's orthogonal and already
// done by location-assignment.ts as a post-pass. Phase 2 assumes a single
// venue per week.
// ─────────────────────────────────────────────────────────────────────────────

export interface Phase2Game {
  id: string; // unique within the week
  pairKey: string;
  teamA: string;
  teamB: string;
}

export interface Phase2Input {
  games: Phase2Game[];
  buckets: number; // number of time buckets that night
  courtsPerBucket: number;
}

export interface Phase2Slot {
  gameId: string;
  bucket: number; // 0-indexed
  court: number; // 1-indexed
}

export interface Phase2Result {
  slots: Phase2Slot[];
  objective: number;
  status: string;
  notes: string[];
}

type HighsModule = {
  solve: (lp: string) => HighsResult;
};
type HighsResult = {
  Status: string;
  ObjectiveValue: number;
  Columns: Record<string, { Primal: number; Name: string }>;
};

let highsPromise: Promise<HighsModule> | null = null;
async function loadHighs(): Promise<HighsModule> {
  if (!highsPromise) {
    highsPromise = (async () => {
      const mod = await import("highs");
      const loader = (mod as unknown as { default: () => Promise<HighsModule> })
        .default;
      return loader();
    })();
  }
  return highsPromise;
}

const PENALTY_GAP = 100;
const PENALTY_SKIP = 10_000; // never leave a game unplaced; acts as hard

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "_");
}
function yVar(gameId: string, bucket: number, court: number): string {
  return `y_${sanitize(gameId)}_b${bucket}_c${court}`;
}
function gapVar(teamId: string, bucket: number): string {
  // 1 iff team has a game in bucket b but none in b+1 AND has another game later.
  // Simpler model: just penalize pairwise non-adjacency.
  return `gap_${sanitize(teamId)}_b${bucket}`;
}
function playsBucketVar(teamId: string, bucket: number): string {
  return `plb_${sanitize(teamId)}_b${bucket}`;
}

export function buildPhase2LP(input: Phase2Input): {
  lp: string;
  meta: {
    gameKeyByVar: Map<string, { gameId: string; bucket: number; court: number }>;
  };
} {
  const { games, buckets, courtsPerBucket } = input;

  const gameKeyByVar = new Map<
    string,
    { gameId: string; bucket: number; court: number }
  >();

  const objectiveTerms: string[] = [];
  const constraints: string[] = [];
  const binaries: string[] = [];

  // Collect teams and their games.
  const gamesByTeam = new Map<string, Phase2Game[]>();
  for (const g of games) {
    for (const t of [g.teamA, g.teamB]) {
      const arr = gamesByTeam.get(t) || [];
      arr.push(g);
      gamesByTeam.set(t, arr);
    }
  }

  // Decision vars y[g,b,c] — binary.
  for (const g of games) {
    for (let b = 0; b < buckets; b++) {
      for (let c = 1; c <= courtsPerBucket; c++) {
        const v = yVar(g.id, b, c);
        binaries.push(v);
        gameKeyByVar.set(v, { gameId: g.id, bucket: b, court: c });
      }
    }
  }

  // Each game placed exactly once (hard — we trust Phase 1 fits).
  for (const g of games) {
    const terms: string[] = [];
    for (let b = 0; b < buckets; b++) {
      for (let c = 1; c <= courtsPerBucket; c++) {
        terms.push(yVar(g.id, b, c));
      }
    }
    constraints.push(`${terms.join(" + ")} = 1`);
  }

  // At most one game per (bucket, court).
  for (let b = 0; b < buckets; b++) {
    for (let c = 1; c <= courtsPerBucket; c++) {
      const terms = games.map((g) => yVar(g.id, b, c));
      if (terms.length > 0) {
        constraints.push(`${terms.join(" + ")} <= 1`);
      }
    }
  }

  // Each team plays at most once per bucket. Also defines plays[t,b] = 1
  // iff team has a game in that bucket.
  for (const [team, teamGames] of gamesByTeam) {
    for (let b = 0; b < buckets; b++) {
      const terms: string[] = [];
      for (const g of teamGames) {
        for (let c = 1; c <= courtsPerBucket; c++) {
          terms.push(yVar(g.id, b, c));
        }
      }
      if (terms.length === 0) continue;
      // At most one (capacity).
      constraints.push(`${terms.join(" + ")} <= 1`);

      // playsBucket[t,b] = Σ of team's y's in bucket b. Since capacity is 1,
      // plays is just equal to the sum (binary-valued).
      const pv = playsBucketVar(team, b);
      binaries.push(pv);
      constraints.push(`${pv} - ${terms.join(" - ")} = 0`);
    }
  }

  // Non-adjacency penalty: for each team, penalize any bucket b where the
  // team plays in b but doesn't play in b+1, unless b is their last game.
  // Simpler formulation: for each team with ≥2 games, count "gaps" — pairs
  // of adjacent buckets where bucket b has a game but b+1 doesn't.
  //
  // gap[t,b] >= plays[t,b] - plays[t,b+1]     (if playing now but not next)
  // gap[t,b] binary.
  //
  // This overcounts at the end of the night (final game always has no "next"
  // play), but the lower bound is constant = number of games - 1 for each
  // team, so it doesn't affect which placement wins.
  for (const team of gamesByTeam.keys()) {
    if ((gamesByTeam.get(team) || []).length < 2) continue;
    for (let b = 0; b < buckets - 1; b++) {
      const gv = gapVar(team, b);
      binaries.push(gv);
      // gap >= plays[t,b] - plays[t,b+1]  →  plays[t,b] - plays[t,b+1] - gap <= 0
      constraints.push(
        `${playsBucketVar(team, b)} - ${playsBucketVar(team, b + 1)} - ${gv} <= 0`
      );
      objectiveTerms.push(`${PENALTY_GAP} ${gv}`);
    }
  }

  void PENALTY_SKIP; // reserved for soft-placement extension

  // Assemble LP.
  const lp: string[] = [];
  lp.push("Minimize");
  lp.push(
    "  obj: " +
      (objectiveTerms.length > 0 ? objectiveTerms.join(" + ") : "0")
  );
  lp.push("Subject To");
  constraints.forEach((c, i) => lp.push(`  c${i}: ${c}`));
  lp.push("Bounds");
  for (const v of binaries) lp.push(`  0 <= ${v} <= 1`);
  if (binaries.length > 0) {
    lp.push("Binary");
    const chunk = 10;
    for (let i = 0; i < binaries.length; i += chunk) {
      lp.push("  " + binaries.slice(i, i + chunk).join(" "));
    }
  }
  lp.push("End");

  return {
    lp: lp.join("\n"),
    meta: { gameKeyByVar },
  };
}

export async function solvePhase2(input: Phase2Input): Promise<Phase2Result> {
  const { lp, meta } = buildPhase2LP(input);
  const highs = await loadHighs();
  const result = highs.solve(lp);

  const notes: string[] = [];
  if (result.Status !== "Optimal") {
    notes.push(`Phase 2 solver status: ${result.Status}`);
  }

  const slots: Phase2Slot[] = [];
  for (const [name, col] of Object.entries(result.Columns)) {
    if (!name.startsWith("y_")) continue;
    if (Math.round(col.Primal) !== 1) continue;
    const ref = meta.gameKeyByVar.get(name);
    if (ref) {
      slots.push({ gameId: ref.gameId, bucket: ref.bucket, court: ref.court });
    }
  }

  return {
    slots,
    objective: result.ObjectiveValue,
    status: result.Status,
    notes,
  };
}
