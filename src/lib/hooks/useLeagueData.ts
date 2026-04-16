"use client";

import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";
import type {
  League,
  Team,
  Division,
  Player,
  Game,
  GameDayPattern,
  DivisionCrossPlay,
  LeagueStaff,
} from "@/lib/types";

interface LeagueData {
  league: League | null;
  teams: Team[];
  divisions: Division[];
  players: Player[];
  games: Game[];
  patterns: GameDayPattern[];
  crossPlayRules: DivisionCrossPlay[];
  staff: LeagueStaff[];
}

interface UseLeagueDataReturn extends LeagueData {
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const EMPTY_DATA: LeagueData = {
  league: null,
  teams: [],
  divisions: [],
  players: [],
  games: [],
  patterns: [],
  crossPlayRules: [],
  staff: [],
};

interface FetchOptions {
  includeGames: boolean;
  includePlayers: boolean;
  includePatterns: boolean;
  includeStaff: boolean;
}

async function fetchLeagueData(
  leagueId: string,
  opts: FetchOptions
): Promise<LeagueData> {
  const supabase = createClient();

  const [
    leagueRes,
    teamsRes,
    divisionsRes,
    playersRes,
    gamesRes,
    patternsRes,
    crossPlayRes,
    staffRes,
  ] = await Promise.all([
    supabase.from("leagues").select("*").eq("id", leagueId).single(),
    supabase.from("teams").select("*").eq("league_id", leagueId),
    supabase.from("divisions").select("*").eq("league_id", leagueId).order("level"),
    opts.includePlayers
      ? supabase.from("players").select("*").eq("league_id", leagueId)
      : Promise.resolve({ data: null, error: null }),
    opts.includeGames
      ? supabase
          .from("games")
          .select("*")
          .eq("league_id", leagueId)
          .order("scheduled_at")
      : Promise.resolve({ data: null, error: null }),
    opts.includePatterns
      ? supabase
          .from("game_day_patterns")
          .select("*")
          .eq("league_id", leagueId)
          .order("starts_on")
      : Promise.resolve({ data: null, error: null }),
    supabase.from("division_cross_play").select("*").eq("league_id", leagueId),
    opts.includeStaff
      ? supabase.from("league_staff").select("*").eq("league_id", leagueId)
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (leagueRes.error) throw new Error(leagueRes.error.message);
  if (teamsRes.error) throw new Error(teamsRes.error.message);
  if (divisionsRes.error) throw new Error(divisionsRes.error.message);

  return {
    league: leagueRes.data,
    teams: teamsRes.data || [],
    divisions: divisionsRes.data || [],
    players: playersRes.data || [],
    games: gamesRes.data || [],
    patterns: patternsRes.data || [],
    crossPlayRules: crossPlayRes.data || [],
    staff: staffRes.data || [],
  };
}

/**
 * Comprehensive hook for loading all league-related data.
 *
 * Backed by SWR so concurrent mounts share a single in-flight request,
 * results are cached across route transitions, and windows/tabs can be
 * revalidated on focus. Public API (fields, loading, error, refetch) is
 * unchanged from the previous useState/useEffect implementation.
 */
export function useLeagueData(
  leagueId: string | null,
  options: {
    includeGames?: boolean;
    includePlayers?: boolean;
    includePatterns?: boolean;
    includeStaff?: boolean;
  } = {}
): UseLeagueDataReturn {
  const opts: FetchOptions = {
    includeGames: options.includeGames ?? true,
    includePlayers: options.includePlayers ?? true,
    includePatterns: options.includePatterns ?? true,
    includeStaff: options.includeStaff ?? true,
  };

  // Cache key encodes both leagueId and the include flags so different option
  // combinations don't collide in the cache.
  const swrKey = leagueId
    ? ([
        "leagueData",
        leagueId,
        opts.includeGames,
        opts.includePlayers,
        opts.includePatterns,
        opts.includeStaff,
      ] as const)
    : null;

  const { data, error, isLoading, mutate } = useSWR(
    swrKey,
    ([, id, g, p, pt, s]) =>
      fetchLeagueData(id, {
        includeGames: g,
        includePlayers: p,
        includePatterns: pt,
        includeStaff: s,
      }),
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  const effective = data || EMPTY_DATA;

  return {
    ...effective,
    loading: isLoading,
    error: error instanceof Error ? error.message : null,
    refetch: async () => {
      await mutate();
    },
  };
}

/**
 * Lightweight hook for just loading league basic info + teams + divisions
 */
export function useLeagueBasics(leagueId: string | null) {
  return useLeagueData(leagueId, {
    includeGames: false,
    includePlayers: false,
    includePatterns: false,
    includeStaff: false,
  });
}
