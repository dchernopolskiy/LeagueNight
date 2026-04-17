import type { Standing, LeagueSettings } from "@/lib/types";

export interface TeamWeight {
  teamId: string;
  weight: number; // 0..1
  components: {
    setWinRate: number | null;
    matchWinRate: number;
    pointDifferential: number;
  };
  gamesPlayed: number;
}

/**
 * Compute a numerical weight for each team in [0, 1] used for re-seeding.
 *
 * In "sets" scoring mode, `points_for` / `points_against` store sets won/lost,
 * so we can derive a set-win rate. In "game" mode, no set-level detail exists
 * so we fall back to points-as-magnitude.
 *
 * Ties broken by point differential on the way in — the weight itself does not
 * encode the tiebreak, callers can sort by (weight desc, point_diff desc).
 */
export function computeTeamWeights(
  standings: Standing[],
  settings: LeagueSettings
): Map<string, TeamWeight> {
  const mode = settings.scoring_mode || "game";
  const out = new Map<string, TeamWeight>();

  for (const s of standings) {
    const games = s.wins + s.losses + s.ties;
    const matchWinRate = games > 0 ? (s.wins + s.ties * 0.5) / games : 0;
    const pointDiff = s.points_for - s.points_against;

    let weight: number;
    let setWinRate: number | null = null;

    if (mode === "sets") {
      const setsTotal = s.points_for + s.points_against;
      setWinRate = setsTotal > 0 ? s.points_for / setsTotal : 0;
      // Set-results weighted higher than match W/L.
      weight = 0.7 * setWinRate + 0.3 * matchWinRate;
    } else {
      // Game mode: no set-level data. Match W/L is the primary signal;
      // point ratio is the tiebreaker proxy.
      const pointsTotal = s.points_for + s.points_against;
      const pointRatio = pointsTotal > 0 ? s.points_for / pointsTotal : 0;
      weight = 0.7 * matchWinRate + 0.3 * pointRatio;
    }

    out.set(s.team_id, {
      teamId: s.team_id,
      weight,
      components: {
        setWinRate,
        matchWinRate,
        pointDifferential: pointDiff,
      },
      gamesPlayed: games,
    });
  }

  return out;
}

/**
 * Rank teams by weight desc, tie-broken by point differential desc.
 * Returns team IDs in rank order.
 */
export function rankByWeight(
  weights: Map<string, TeamWeight>
): string[] {
  const list = Array.from(weights.values());
  list.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return b.components.pointDifferential - a.components.pointDifferential;
  });
  return list.map((w) => w.teamId);
}
