import type {
  WeekFillOptions,
  WeekFillPattern,
  WeekFillTeam,
} from "../week-fill";

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — matchup-to-week assignment via ILP (HiGHS).
//
// Decision: for each pair p and week w, a binary x[p,w] = 1 iff pair p plays
// in week w. The model enforces hard frequency/capacity constraints and
// minimizes a penalty over soft objectives: games-per-team shortfall,
// back-to-back BYEs, crossplay usage, and pair repeats beyond the required
// frequency.
//
// We build the model as a CPLEX LP file (HiGHS's most reliable input format)
// and hand it to the solver. Slack variables on every soft constraint keep
// the model feasible under tight calendars — an infeasible model would be a
// bug, not a real-world case.
// ─────────────────────────────────────────────────────────────────────────────

export interface Phase1Pair {
  key: string; // deterministic id, e.g. "t1|t2"
  teamA: string;
  teamB: string;
  crossDiv: boolean;
  required: number; // matchupFrequency for within-div; 0 for crossplay
  priorPlayed: number;
  skillAlignment?: number; // 0..1, only present in re-seed mode
}

export interface Phase1Input {
  teams: WeekFillTeam[];
  weeks: number;
  pairs: Phase1Pair[];
  opts: Pick<
    WeekFillOptions,
    "matchupFrequency" | "gamesPerSession" | "gamesPerTeam"
  >;
  slotsPerWeek: number; // total games a single night can host
}

export interface Phase1Assignment {
  pairKey: string;
  week: number;
}

export interface Phase1DroppedPair {
  pairKey: string;
  teamA: string;
  teamB: string;
  missed: number;
}

export interface Phase1Result {
  assignments: Phase1Assignment[];
  droppedPairs: Phase1DroppedPair[];
  notes: string[];
  objective: number;
  status: string;
}

/**
 * Lazily-loaded HiGHS WASM solver. Re-importing between calls is cheap; the
 * wasm module itself is cached by Node's module resolver.
 */
type HighsModule = {
  solve: (lp: string) => HighsResult;
};
type HighsResult = {
  Status: string;
  ObjectiveValue: number;
  Columns: Record<string, { Primal: number; Name: string }>;
};

// HiGHS WASM holds solver state in the module instance; calling .solve()
// multiple times on the same instance corrupts internal memory (observed:
// "RuntimeError: memory access out of bounds" on the 3rd+ call). We pay a
// small init cost per solve to guarantee a clean state — for our problem
// sizes the wasm boot is dominated by the solve itself.
async function loadHighs(): Promise<HighsModule> {
  const mod = await import("highs");
  const loader = (mod as unknown as { default: () => Promise<HighsModule> })
    .default;
  return loader();
}

// ── LP construction ─────────────────────────────────────────────────────────

const PENALTY_UNDER_GAMES = 1_000;
const PENALTY_OVER_GAMES = 100;
const PENALTY_BACK_TO_BACK_BYE = 500;
const PENALTY_CROSSPLAY_USE = 20;
const PENALTY_CROSSPLAY_REPEAT = 80;
const PENALTY_PRIOR_MATCHUP = 50;
const BONUS_SKILL_ALIGNMENT = 27;
// Dropping a required within-div pair is heavier than any other soft penalty
// so the model only drops pairs when the calendar is genuinely insufficient.
const PENALTY_DROP_REQUIRED_PAIR = 5_000;

function xVar(pairKey: string, week: number): string {
  return `x_${sanitize(pairKey)}_w${week}`;
}
function playsVar(teamId: string, week: number): string {
  return `plays_${sanitize(teamId)}_w${week}`;
}
function b2bVar(teamId: string, week: number): string {
  return `b2b_${sanitize(teamId)}_w${week}`;
}
function underVar(teamId: string): string {
  return `under_${sanitize(teamId)}`;
}
function overVar(teamId: string): string {
  return `over_${sanitize(teamId)}`;
}
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "_");
}

export function buildPhase1LP(input: Phase1Input): {
  lp: string;
  binaries: string[];
  generals: string[];
  meta: {
    pairKeyByVar: Map<string, string>;
    weekByVar: Map<string, number>;
  };
} {
  const { teams, weeks, pairs, opts, slotsPerWeek } = input;
  const gamesPerTeamGoal = opts.gamesPerTeam ?? 0;

  const pairKeyByVar = new Map<string, string>();
  const weekByVar = new Map<string, number>();

  const objectiveTerms: string[] = [];
  const constraints: string[] = [];
  const binaries: string[] = [];
  const generals: string[] = []; // integer slack

  // Decision vars x[p,w] — binary.
  for (const p of pairs) {
    for (let w = 1; w <= weeks; w++) {
      const v = xVar(p.key, w);
      binaries.push(v);
      pairKeyByVar.set(v, p.key);
      weekByVar.set(v, w);

      // Objective contributions.
      if (p.crossDiv) {
        objectiveTerms.push(`${PENALTY_CROSSPLAY_USE} ${v}`);
      }
      if (p.priorPlayed > 0) {
        objectiveTerms.push(`${PENALTY_PRIOR_MATCHUP * p.priorPlayed} ${v}`);
      }
      if (p.skillAlignment !== undefined) {
        objectiveTerms.push(`${(-BONUS_SKILL_ALIGNMENT * p.skillAlignment).toFixed(3)} ${v}`);
      }
    }
  }

  // Crossplay repeat penalty: if a crossplay pair plays more than once across
  // the season, the marginal extra plays get the repeat penalty. Model this
  // by adding `crossRepeat[p] ≥ Σ_w x[p,w] - 1` with a 0 lower bound, then
  // penalize crossRepeat in objective.
  for (const p of pairs) {
    if (!p.crossDiv) continue;
    const repeatVar = `crossrep_${sanitize(p.key)}`;
    generals.push(repeatVar);
    const lhs = Array.from({ length: weeks }, (_, i) =>
      xVar(p.key, i + 1)
    ).join(" + ");
    constraints.push(`${lhs} - ${repeatVar} <= 1`);
    objectiveTerms.push(`${PENALTY_CROSSPLAY_REPEAT} ${repeatVar}`);
  }

  // Required within-div pair frequency — soft lower bound. The model must
  // schedule each pair at least `required` times unless the calendar can't
  // fit it (slack = drop). Repeats beyond `required` are allowed so the
  // games-per-team goal can drive extras. Pays PENALTY_DROP_REQUIRED_PAIR
  // per missed play (heavier than every other soft term).
  for (const p of pairs) {
    if (p.crossDiv) continue;
    if (p.required <= 0) continue;
    const lhs = Array.from({ length: weeks }, (_, i) =>
      xVar(p.key, i + 1)
    ).join(" + ");
    const dropVar = `drop_${sanitize(p.key)}`;
    generals.push(dropVar);
    // Σ x[p,w] + drop[p] >= required. drop ≥ 0 counts missed plays.
    constraints.push(`${lhs} + ${dropVar} >= ${p.required}`);
    objectiveTerms.push(`${PENALTY_DROP_REQUIRED_PAIR} ${dropVar}`);
  }

  // Per-team per-week cap: games played ≤ gamesPerSession.
  // Also defines plays[t,w] via: plays[t,w] ≤ Σ_{p∋t} x[p,w] and
  // plays[t,w] ≥ Σ_{p∋t} x[p,w] / gamesPerSession — i.e. plays is 1 iff any
  // game happens. For a boolean interpretation we use two inequalities.
  for (const t of teams) {
    for (let w = 1; w <= weeks; w++) {
      const termsForTeam = pairs
        .filter((p) => p.teamA === t.id || p.teamB === t.id)
        .map((p) => xVar(p.key, w));
      if (termsForTeam.length === 0) continue;
      const sum = termsForTeam.join(" + ");
      // Cap.
      constraints.push(`${sum} <= ${opts.gamesPerSession}`);

      // plays[t,w] binary: plays = 1 iff any game.
      const pv = playsVar(t.id, w);
      binaries.push(pv);
      // sum ≤ gamesPerSession * plays  → sum - gamesPerSession*plays ≤ 0
      constraints.push(
        `${sum} - ${opts.gamesPerSession} ${pv} <= 0`
      );
      // plays ≤ sum  → plays - sum ≤ 0. Negate every term of sum.
      const negatedSum = termsForTeam.map((v) => `- ${v}`).join(" ");
      constraints.push(`${pv} ${negatedSum} <= 0`);
    }
  }

  // Back-to-back BYE detector. b2b[t,w] ≥ (1 - plays[t,w]) + (1 - plays[t,w+1]) - 1
  //                            = 1 - plays[t,w] - plays[t,w+1]
  // So b2b[t,w] + plays[t,w] + plays[t,w+1] ≥ 1 if we want to FLAG a b2b.
  // Rewrite: b2b[t,w] ≥ 1 - plays[t,w] - plays[t,w+1]
  //          b2b[t,w] + plays[t,w] + plays[t,w+1] ≥ 1
  // b2b is binary; penalize in objective.
  for (const t of teams) {
    for (let w = 1; w < weeks; w++) {
      const bv = b2bVar(t.id, w);
      binaries.push(bv);
      constraints.push(
        `${bv} + ${playsVar(t.id, w)} + ${playsVar(t.id, w + 1)} >= 1`
      );
      objectiveTerms.push(`${PENALTY_BACK_TO_BACK_BYE} ${bv}`);
    }
  }

  // Weekly capacity: total games ≤ slotsPerWeek.
  for (let w = 1; w <= weeks; w++) {
    const sum = pairs.map((p) => xVar(p.key, w)).join(" + ");
    if (sum) constraints.push(`${sum} <= ${slotsPerWeek}`);
  }

  // Games-per-team target via slack. For each team:
  // Σ_w Σ_{p∋t} x[p,w] + under[t] - over[t] = gamesPerTeamGoal
  if (gamesPerTeamGoal > 0) {
    for (const t of teams) {
      const allGames = pairs
        .filter((p) => p.teamA === t.id || p.teamB === t.id)
        .flatMap((p) =>
          Array.from({ length: weeks }, (_, i) => xVar(p.key, i + 1))
        );
      if (allGames.length === 0) continue;
      const uv = underVar(t.id);
      const ov = overVar(t.id);
      generals.push(uv, ov);
      constraints.push(
        `${allGames.join(" + ")} + ${uv} - ${ov} = ${gamesPerTeamGoal}`
      );
      objectiveTerms.push(`${PENALTY_UNDER_GAMES} ${uv}`);
      objectiveTerms.push(`${PENALTY_OVER_GAMES} ${ov}`);
    }
  }

  // Assemble LP text.
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
  for (const v of generals) lp.push(`  0 <= ${v}`);
  if (binaries.length > 0) {
    lp.push("Binary");
    // CPLEX LP allows multi-line Binary sections; keep lines short-ish.
    const chunk = 10;
    for (let i = 0; i < binaries.length; i += chunk) {
      lp.push("  " + binaries.slice(i, i + chunk).join(" "));
    }
  }
  if (generals.length > 0) {
    lp.push("General");
    const chunk = 10;
    for (let i = 0; i < generals.length; i += chunk) {
      lp.push("  " + generals.slice(i, i + chunk).join(" "));
    }
  }
  lp.push("End");

  return {
    lp: lp.join("\n"),
    binaries,
    generals,
    meta: { pairKeyByVar, weekByVar },
  };
}

export async function solvePhase1(input: Phase1Input): Promise<Phase1Result> {
  const { lp, meta } = buildPhase1LP(input);
  const highs = await loadHighs();
  const result = highs.solve(lp);

  const notes: string[] = [];
  if (result.Status !== "Optimal") {
    notes.push(`Phase 1 solver status: ${result.Status}`);
  }

  const assignments: Phase1Assignment[] = [];
  const droppedPairs: Phase1DroppedPair[] = [];
  const pairByKey = new Map(input.pairs.map((p) => [p.key, p]));
  for (const [name, col] of Object.entries(result.Columns)) {
    if (name.startsWith("x_")) {
      if (Math.round(col.Primal) !== 1) continue;
      const pairKey = meta.pairKeyByVar.get(name);
      const week = meta.weekByVar.get(name);
      if (pairKey && week !== undefined) {
        assignments.push({ pairKey, week });
      }
    } else if (name.startsWith("drop_")) {
      const missed = Math.round(col.Primal);
      if (missed <= 0) continue;
      // Recover pairKey from variable name. `drop_<sanitized>` — rather than
      // reverse-sanitize, look up by matching sanitized form against known pairs.
      for (const p of pairByKey.values()) {
        if (name === `drop_${sanitize(p.key)}`) {
          droppedPairs.push({
            pairKey: p.key,
            teamA: p.teamA,
            teamB: p.teamB,
            missed,
          });
          break;
        }
      }
    }
  }

  return {
    assignments,
    droppedPairs,
    notes,
    objective: result.ObjectiveValue,
    status: result.Status,
  };
}

// ── Public entry from WeekFill inputs ───────────────────────────────────────

export function buildPhase1InputFromWeekFill(
  teams: WeekFillTeam[],
  pattern: WeekFillPattern,
  opts: WeekFillOptions,
  weeks: number,
  slotsPerWeek: number,
  extras: {
    existingMatchupCounts?: Map<string, number>;
    teamWeights?: Map<string, number>;
  } = {}
): Phase1Input {
  const pairs: Phase1Pair[] = [];
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const pairMeta = (a: string, b: string, required: number) => {
    const key = pairKey(a, b);
    const priorPlayed = extras.existingMatchupCounts?.get(key) ?? 0;
    const wA = extras.teamWeights?.get(a);
    const wB = extras.teamWeights?.get(b);
    const skillAlignment =
      wA !== undefined && wB !== undefined ? 1 - Math.abs(wA - wB) : undefined;
    return {
      key,
      priorPlayed,
      required: Math.max(0, required - priorPlayed),
      skillAlignment,
    };
  };

  const byDivision = new Map<string, WeekFillTeam[]>();
  for (const t of teams) {
    const k = t.division_id ?? "__none__";
    const arr = byDivision.get(k) || [];
    arr.push(t);
    byDivision.set(k, arr);
  }

  // Within-division required pairs.
  for (const divTeams of byDivision.values()) {
    for (let i = 0; i < divTeams.length; i++) {
      for (let j = i + 1; j < divTeams.length; j++) {
        const meta = pairMeta(
          divTeams[i].id,
          divTeams[j].id,
          opts.matchupFrequency
        );
        pairs.push({
          key: meta.key,
          teamA: divTeams[i].id < divTeams[j].id ? divTeams[i].id : divTeams[j].id,
          teamB: divTeams[i].id < divTeams[j].id ? divTeams[j].id : divTeams[i].id,
          crossDiv: false,
          required: meta.required,
          priorPlayed: meta.priorPlayed,
          skillAlignment: meta.skillAlignment,
        });
      }
    }
  }

  // Crossplay pairs (optional filler).
  if (opts.allowCrossPlay) {
    const canCross = (a: string | null, b: string | null) => {
      if (!a || !b) return true;
      if (a === b) return true;
      if (!opts.crossPlayRules || opts.crossPlayRules.length === 0) return true;
      const [lo, hi] = a < b ? [a, b] : [b, a];
      return opts.crossPlayRules.some(
        (r) => r.division_a_id === lo && r.division_b_id === hi
      );
    };
    const divs = [...byDivision.keys()];
    for (let i = 0; i < divs.length; i++) {
      for (let j = i + 1; j < divs.length; j++) {
        const dA = divs[i];
        const dB = divs[j];
        const divA = dA === "__none__" ? null : dA;
        const divB = dB === "__none__" ? null : dB;
        if (!canCross(divA, divB)) continue;
        const teamsA = byDivision.get(dA) || [];
        const teamsB = byDivision.get(dB) || [];
        for (const tA of teamsA) {
          for (const tB of teamsB) {
            const meta = pairMeta(tA.id, tB.id, 0);
            // Skip if this pair is already a within-div pair (can't happen
            // since crossdiv pairs span buckets, but guard anyway).
            pairs.push({
              key: meta.key,
              teamA: tA.id < tB.id ? tA.id : tB.id,
              teamB: tA.id < tB.id ? tB.id : tA.id,
              crossDiv: true,
              required: 0,
              priorPlayed: meta.priorPlayed,
              skillAlignment: meta.skillAlignment,
            });
          }
        }
      }
    }
  }

  void pattern; // reserved: will use skipDates/endsOn when we add location capacity

  return {
    teams,
    weeks,
    pairs,
    opts: {
      matchupFrequency: opts.matchupFrequency,
      gamesPerSession: opts.gamesPerSession,
      gamesPerTeam: opts.gamesPerTeam,
    },
    slotsPerWeek,
  };
}
