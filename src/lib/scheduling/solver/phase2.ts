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

// New HiGHS instance per solve — see phase1.ts for rationale.
async function loadHighs(): Promise<HighsModule> {
  const mod = await import("highs");
  const loader = (mod as unknown as { default: () => Promise<HighsModule> })
    .default;
  return loader();
}

const PENALTY_GAP = 100;
const PENALTY_LATER_BUCKET = 1;
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
        if (b > 0) {
          objectiveTerms.push(`${PENALTY_LATER_BUCKET * b} ${v}`);
        }
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
      // plays is just equal to the sum (binary-valued). Negate each term
      // explicitly — CPLEX LP format requires a sign in front of every term.
      const pv = playsBucketVar(team, b);
      binaries.push(pv);
      const negated = terms.map((v) => `- ${v}`).join(" ");
      constraints.push(`${pv} ${negated} = 0`);
    }
  }

  // Non-adjacency penalty: for each team, for each ordered pair of buckets
  // (b1 < b2) with distance d = b2 - b1 > 1, create a binary indicator
  // `pairPlay[t,b1,b2]` that equals 1 when the team has games in BOTH b1 and
  // b2. Penalty weight scales with (d - 1) so two-bucket gaps hurt less than
  // three-bucket gaps. This directly mirrors the fixture's gap accounting:
  //   totalGap = Σ_teams Σ_{consecutive team games} (bucketDistance - 1)
  //
  // pairPlay[t,b1,b2] >= plays[t,b1] + plays[t,b2] - 1
  for (const team of gamesByTeam.keys()) {
    if ((gamesByTeam.get(team) || []).length < 2) continue;
    for (let b1 = 0; b1 < buckets; b1++) {
      for (let b2 = b1 + 2; b2 < buckets; b2++) {
        const weight = (b2 - b1 - 1) * PENALTY_GAP;
        const gv = `gap_${sanitize(team)}_b${b1}_${b2}`;
        binaries.push(gv);
        // plays[t,b1] + plays[t,b2] - gap <= 1
        constraints.push(
          `${playsBucketVar(team, b1)} + ${playsBucketVar(team, b2)} - ${gv} <= 1`
        );
        objectiveTerms.push(`${weight} ${gv}`);
      }
    }
  }
  void gapVar;

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
