// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — per-week slot/court/location assignment via ILP (HiGHS).
//
// Given Phase 1's pair→week decisions, Phase 2 places each game on a specific
// time bucket and court within that week. When venue-specific court slots are
// provided, it also chooses the location and enforces that a team uses at most
// one location on a given night.
// ─────────────────────────────────────────────────────────────────────────────

export type BucketHalfPreference = "early" | "late";

export interface SlotAssignmentTeamPreference {
  teamId: string;
  prefer: BucketHalfPreference;
  source: "preferred_time" | "week_specific_time";
}

export interface SlotAssignmentGame {
  id: string;
  pairKey: string;
  teamA: string;
  teamB: string;
}

export interface SlotAssignmentCourtSlot {
  locationId: string | null;
  locationName: string | null;
  courtNum: number;
  totalCourts: number;
}

export interface SlotAssignmentInput {
  games: SlotAssignmentGame[];
  buckets: number;
  courtsPerBucket?: number;
  courtSlots?: SlotAssignmentCourtSlot[];
  teamPreferences?: SlotAssignmentTeamPreference[];
}

export interface SlotAssignmentSlot {
  gameId: string;
  bucket: number;
  court: number;
  locationId?: string | null;
  locationName?: string | null;
  totalCourts?: number;
  preferenceHits: Array<{
    teamId: string;
    source: "preferred_time" | "week_specific_time";
  }>;
}

export interface SlotAssignmentResult {
  slots: SlotAssignmentSlot[];
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

async function loadHighs(): Promise<HighsModule> {
  const mod = await import("highs");
  const loader = (mod as unknown as { default: () => Promise<HighsModule> })
    .default;
  return loader();
}

const PENALTY_GAP = 100;
const PENALTY_LATER_BUCKET = 1;
const PENALTY_WEEK_PREF_MISS = 25;
const PENALTY_PREF_TIME_MISS = 11;

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "_");
}

function yVar(gameId: string, bucket: number, slotIdx: number): string {
  return `y_${sanitize(gameId)}_b${bucket}_s${slotIdx}`;
}

function playsBucketVar(teamId: string, bucket: number): string {
  return `plb_${sanitize(teamId)}_b${bucket}`;
}

function teamLocationVar(teamId: string, locationId: string): string {
  return `tloc_${sanitize(teamId)}_${sanitize(locationId)}`;
}

export function buildSlotAssignmentLP(input: SlotAssignmentInput): {
  lp: string;
  meta: {
    gameKeyByVar: Map<string, { gameId: string; bucket: number; slot: SlotAssignmentCourtSlot }>;
    slots: SlotAssignmentCourtSlot[];
  };
} {
  const { games, buckets } = input;
  const slots = input.courtSlots?.length
    ? input.courtSlots
    : Array.from({ length: input.courtsPerBucket || 1 }, (_, idx) => ({
        locationId: null,
        locationName: null,
        courtNum: idx + 1,
        totalCourts: input.courtsPerBucket || 1,
      }));

  const gameKeyByVar = new Map<
    string,
    { gameId: string; bucket: number; slot: SlotAssignmentCourtSlot }
  >();

  const objectiveTerms: string[] = [];
  const constraints: string[] = [];
  const binaries: string[] = [];

  const gamesByTeam = new Map<string, SlotAssignmentGame[]>();
  for (const g of games) {
    for (const t of [g.teamA, g.teamB]) {
      const arr = gamesByTeam.get(t) || [];
      arr.push(g);
      gamesByTeam.set(t, arr);
    }
  }

  for (const g of games) {
    for (let b = 0; b < buckets; b++) {
      for (let s = 0; s < slots.length; s++) {
        const v = yVar(g.id, b, s);
        binaries.push(v);
        if (b > 0) {
          objectiveTerms.push(`${PENALTY_LATER_BUCKET * b} ${v}`);
        }
        gameKeyByVar.set(v, { gameId: g.id, bucket: b, slot: slots[s] });
      }
    }
  }

  for (const g of games) {
    const terms: string[] = [];
    for (let b = 0; b < buckets; b++) {
      for (let s = 0; s < slots.length; s++) {
        terms.push(yVar(g.id, b, s));
      }
    }
    constraints.push(`${terms.join(" + ")} = 1`);
  }

  const preferencesByTeam = new Map<string, SlotAssignmentTeamPreference>();
  for (const p of input.teamPreferences || []) {
    const existing = preferencesByTeam.get(p.teamId);
    if (
      !existing ||
      (existing.source === "preferred_time" && p.source === "week_specific_time")
    ) {
      preferencesByTeam.set(p.teamId, p);
    }
  }

  if (buckets > 1 && preferencesByTeam.size > 0) {
    const midBucket = Math.ceil(buckets / 2);
    for (const g of games) {
      for (const teamId of [g.teamA, g.teamB]) {
        const pref = preferencesByTeam.get(teamId);
        if (!pref) continue;
        const penalty =
          pref.source === "week_specific_time"
            ? PENALTY_WEEK_PREF_MISS
            : PENALTY_PREF_TIME_MISS;
        for (let b = 0; b < buckets; b++) {
          const isEarly = b < midBucket;
          const isLate = b >= midBucket;
          const miss =
            (pref.prefer === "early" && !isEarly) ||
            (pref.prefer === "late" && !isLate);
          if (!miss) continue;
          for (let s = 0; s < slots.length; s++) {
            objectiveTerms.push(`${penalty} ${yVar(g.id, b, s)}`);
          }
        }
      }
    }
  }

  for (let b = 0; b < buckets; b++) {
    for (let s = 0; s < slots.length; s++) {
      const terms = games.map((g) => yVar(g.id, b, s));
      if (terms.length > 0) {
        constraints.push(`${terms.join(" + ")} <= 1`);
      }
    }
  }

  for (const [team, teamGames] of gamesByTeam) {
    for (let b = 0; b < buckets; b++) {
      const terms: string[] = [];
      for (const g of teamGames) {
        for (let s = 0; s < slots.length; s++) {
          terms.push(yVar(g.id, b, s));
        }
      }
      if (terms.length === 0) continue;
      constraints.push(`${terms.join(" + ")} <= 1`);

      const pv = playsBucketVar(team, b);
      binaries.push(pv);
      const negated = terms.map((v) => `- ${v}`).join(" ");
      constraints.push(`${pv} ${negated} = 0`);
    }
  }

  for (const team of gamesByTeam.keys()) {
    if ((gamesByTeam.get(team) || []).length < 2) continue;
    for (let b1 = 0; b1 < buckets; b1++) {
      for (let b2 = b1 + 2; b2 < buckets; b2++) {
        const weight = (b2 - b1 - 1) * PENALTY_GAP;
        const gv = `gap_${sanitize(team)}_b${b1}_${b2}`;
        binaries.push(gv);
        constraints.push(
          `${playsBucketVar(team, b1)} + ${playsBucketVar(team, b2)} - ${gv} <= 1`
        );
        objectiveTerms.push(`${weight} ${gv}`);
      }
    }
  }

  const locationIds = [
    ...new Set(slots.map((slot) => slot.locationId).filter((id): id is string => !!id)),
  ];
  if (locationIds.length > 1) {
    for (const [team, teamGames] of gamesByTeam) {
      const teamLocationVars: string[] = [];
      for (const locationId of locationIds) {
        const tv = teamLocationVar(team, locationId);
        binaries.push(tv);
        teamLocationVars.push(tv);
        for (const g of teamGames) {
          for (let b = 0; b < buckets; b++) {
            for (let s = 0; s < slots.length; s++) {
              if (slots[s].locationId !== locationId) continue;
              constraints.push(`${yVar(g.id, b, s)} - ${tv} <= 0`);
            }
          }
        }
      }
      constraints.push(`${teamLocationVars.join(" + ")} <= 1`);
    }
  }

  const lp: string[] = [];
  lp.push("Minimize");
  lp.push(
    "  obj: " + (objectiveTerms.length > 0 ? objectiveTerms.join(" + ") : "0")
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
    meta: { gameKeyByVar, slots },
  };
}

export async function solveSlotAssignment(
  input: SlotAssignmentInput
): Promise<SlotAssignmentResult> {
  const { lp, meta } = buildSlotAssignmentLP(input);
  const highs = await loadHighs();
  const result = highs.solve(lp);

  const notes: string[] = [];
  if (result.Status !== "Optimal") {
    notes.push(`Slot assignment solver status: ${result.Status}`);
  }

  const preferencesByTeam = new Map<string, SlotAssignmentTeamPreference>();
  for (const p of input.teamPreferences || []) {
    const existing = preferencesByTeam.get(p.teamId);
    if (
      !existing ||
      (existing.source === "preferred_time" && p.source === "week_specific_time")
    ) {
      preferencesByTeam.set(p.teamId, p);
    }
  }
  const gameById = new Map(input.games.map((g) => [g.id, g]));
  const midBucket = Math.ceil(input.buckets / 2);

  const slots: SlotAssignmentSlot[] = [];
  for (const [name, col] of Object.entries(result.Columns)) {
    if (!name.startsWith("y_")) continue;
    if (Math.round(col.Primal) !== 1) continue;
    const ref = meta.gameKeyByVar.get(name);
    if (!ref) continue;

    const game = gameById.get(ref.gameId);
    const preferenceHits: SlotAssignmentSlot["preferenceHits"] = [];
    if (game && input.buckets > 1) {
      const isEarly = ref.bucket < midBucket;
      const isLate = ref.bucket >= midBucket;
      for (const teamId of [game.teamA, game.teamB]) {
        const pref = preferencesByTeam.get(teamId);
        if (!pref) continue;
        const hit =
          (pref.prefer === "early" && isEarly) ||
          (pref.prefer === "late" && isLate);
        if (hit) {
          preferenceHits.push({ teamId, source: pref.source });
        }
      }
    }
    slots.push({
      gameId: ref.gameId,
      bucket: ref.bucket,
      court: ref.slot.courtNum,
      locationId: ref.slot.locationId,
      locationName: ref.slot.locationName,
      totalCourts: ref.slot.totalCourts,
      preferenceHits,
    });
  }

  return {
    slots,
    objective: result.ObjectiveValue,
    status: result.Status,
    notes,
  };
}
