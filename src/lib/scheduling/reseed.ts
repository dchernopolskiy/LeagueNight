import type { Standing, LeagueSettings } from "@/lib/types";
import { computeTeamWeights, rankByWeight, type TeamWeight } from "@/lib/standings/weights";

type ReseedTeam = { id: string; division_id: string | null };

export type ReseedMode = "by_skill" | "within_division";

export interface ReseedPool {
  id: string; // stable identifier (division id when within_division, "pool-N" when by_skill)
  name: string;
  originalDivisionId: string | null; // for within_division mode
  teamIds: string[];
}

export interface ReseedResult {
  mode: ReseedMode;
  pools: ReseedPool[];
  teamPool: Map<string, string>; // teamId -> pool.id
  teamWeights: Map<string, TeamWeight>;
}

/**
 * Compute new pools for mid-season re-seeding.
 *
 * - `by_skill` (default, production): teams ranked by weight; pools match the
 *   sizes of existing divisions (largest pool = biggest division, filled from
 *   top-ranked down). Pool names come from the largest-to-smallest original
 *   divisions (so top pool gets the top-division name, second pool gets next, etc.).
 *   Teams can play anyone in their new pool regardless of original division.
 *
 * - `within_division` (kept but hidden): pools match original divisions 1:1.
 *   Re-seed scoring still prioritizes "haven't played before" but matches stay
 *   within-division.
 */
export function computeReseedPools(
  teams: ReseedTeam[],
  standings: Standing[],
  divisions: Array<{ id: string; name: string }>,
  settings: LeagueSettings,
  mode: ReseedMode = "by_skill"
): ReseedResult {
  const weights = computeTeamWeights(standings, settings);

  // Teams without standings entries (e.g. new teams) get weight 0.
  for (const t of teams) {
    if (!weights.has(t.id)) {
      weights.set(t.id, {
        teamId: t.id,
        weight: 0,
        components: { setWinRate: null, matchWinRate: 0, pointDifferential: 0 },
        gamesPlayed: 0,
      });
    }
  }

  if (mode === "within_division") {
    const pools: ReseedPool[] = [];
    const teamPool = new Map<string, string>();
    for (const div of divisions) {
      const ids = teams.filter((t) => t.division_id === div.id).map((t) => t.id);
      if (ids.length === 0) continue;
      pools.push({
        id: div.id,
        name: div.name,
        originalDivisionId: div.id,
        teamIds: ids,
      });
      for (const id of ids) teamPool.set(id, div.id);
    }
    // Teams without division
    const unassigned = teams.filter((t) => !t.division_id);
    if (unassigned.length > 0) {
      const poolId = "no-division";
      pools.push({
        id: poolId,
        name: "No Division",
        originalDivisionId: null,
        teamIds: unassigned.map((t) => t.id),
      });
      for (const t of unassigned) teamPool.set(t.id, poolId);
    }
    return { mode, pools, teamPool, teamWeights: weights };
  }

  // by_skill mode
  const ranked = rankByWeight(weights);
  // Keep only teams that exist in `teams` (filter out departed teams)
  const teamIdSet = new Set(teams.map((t) => t.id));
  const rankedFiltered = ranked.filter((id) => teamIdSet.has(id));
  // Append any teams missing from standings at the bottom of the ranking.
  for (const t of teams) {
    if (!rankedFiltered.includes(t.id)) rankedFiltered.push(t.id);
  }

  // Pool sizes match divisions sorted by team count DESC.
  const divSizes = divisions
    .map((d) => ({
      id: d.id,
      name: d.name,
      size: teams.filter((t) => t.division_id === d.id).length,
    }))
    .filter((d) => d.size > 0)
    .sort((a, b) => b.size - a.size);

  // Teams in no division fall into an extra pool slot (appended).
  const unassignedCount = teams.filter((t) => !t.division_id).length;
  if (unassignedCount > 0) {
    divSizes.push({
      id: "no-division",
      name: "No Division",
      size: unassignedCount,
    });
  }

  const pools: ReseedPool[] = [];
  const teamPool = new Map<string, string>();
  let cursor = 0;
  for (let i = 0; i < divSizes.length; i++) {
    const slot = divSizes[i];
    const poolTeams = rankedFiltered.slice(cursor, cursor + slot.size);
    cursor += slot.size;
    const poolId = `pool-${i + 1}`;
    pools.push({
      id: poolId,
      name: slot.name, // reuse division name for labeling
      originalDivisionId: null, // by_skill pools are not tied to an original division
      teamIds: poolTeams,
    });
    for (const tid of poolTeams) teamPool.set(tid, poolId);
  }

  // Any leftover teams (e.g. from rounding) go into the last pool.
  if (cursor < rankedFiltered.length && pools.length > 0) {
    const leftover = rankedFiltered.slice(cursor);
    const last = pools[pools.length - 1];
    last.teamIds.push(...leftover);
    for (const tid of leftover) teamPool.set(tid, last.id);
  }

  return { mode, pools, teamPool, teamWeights: weights };
}
