"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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

/**
 * Comprehensive hook for loading all league-related data.
 * Handles loading states, errors, and provides a refetch function.
 *
 * @param leagueId - The league ID to fetch data for
 * @param options - Optional configuration for what data to load
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
  // Memoize options to prevent unnecessary re-renders
  const memoizedOptions = useMemo(() => options, [
    options.includeGames,
    options.includePlayers,
    options.includePatterns,
    options.includeStaff,
  ]);

  const {
    includeGames = true,
    includePlayers = true,
    includePatterns = true,
    includeStaff = true,
  } = memoizedOptions;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LeagueData>({
    league: null,
    teams: [],
    divisions: [],
    players: [],
    games: [],
    patterns: [],
    crossPlayRules: [],
    staff: [],
  });

  const fetchData = useCallback(async () => {
    if (!leagueId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const supabase = createClient();

      // Fetch all data in parallel for performance
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
        includePlayers
          ? supabase.from("players").select("*").eq("league_id", leagueId)
          : Promise.resolve({ data: null, error: null }),
        includeGames
          ? supabase
              .from("games")
              .select("*")
              .eq("league_id", leagueId)
              .order("scheduled_at")
          : Promise.resolve({ data: null, error: null }),
        includePatterns
          ? supabase
              .from("game_day_patterns")
              .select("*")
              .eq("league_id", leagueId)
              .order("starts_on")
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from("division_cross_play")
          .select("*")
          .eq("league_id", leagueId),
        includeStaff
          ? supabase.from("league_staff").select("*").eq("league_id", leagueId)
          : Promise.resolve({ data: null, error: null }),
      ]);

      // Check for errors
      if (leagueRes.error) throw new Error(leagueRes.error.message);
      if (teamsRes.error) throw new Error(teamsRes.error.message);
      if (divisionsRes.error) throw new Error(divisionsRes.error.message);

      setData({
        league: leagueRes.data,
        teams: teamsRes.data || [],
        divisions: divisionsRes.data || [],
        players: playersRes.data || [],
        games: gamesRes.data || [],
        patterns: patternsRes.data || [],
        crossPlayRules: crossPlayRes.data || [],
        staff: staffRes.data || [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load league data");
    } finally {
      setLoading(false);
    }
  }, [leagueId, includeGames, includePlayers, includePatterns, includeStaff]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    ...data,
    loading,
    error,
    refetch: fetchData,
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
