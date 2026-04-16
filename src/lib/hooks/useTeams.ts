"use client";

import { useCallback } from "react";
import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";
import type { Team } from "@/lib/types";

interface UseTeamsReturn {
  teams: Team[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  addTeam: (team: Omit<Team, "id" | "created_at">) => Promise<Team | null>;
  updateTeam: (id: string, updates: Partial<Team>) => Promise<boolean>;
  deleteTeam: (id: string) => Promise<boolean>;
}

async function fetchTeams(leagueId: string): Promise<Team[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("teams")
    .select("*")
    .eq("league_id", leagueId)
    .order("name");
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * Hook for managing teams in a league.
 * Backed by SWR: concurrent mounts share one request, results are cached.
 * CRUD mutations update the SWR cache via `mutate`.
 */
export function useTeams(leagueId: string | null): UseTeamsReturn {
  const swrKey = leagueId ? (["teams", leagueId] as const) : null;
  const { data, error, isLoading, mutate } = useSWR(
    swrKey,
    ([, id]) => fetchTeams(id),
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  );

  const teams = data || [];

  const addTeam = useCallback(
    async (team: Omit<Team, "id" | "created_at">): Promise<Team | null> => {
      const supabase = createClient();
      const { data: inserted, error: insertError } = await supabase
        .from("teams")
        .insert(team)
        .select()
        .single();
      if (insertError) return null;
      await mutate((prev) => [...(prev || []), inserted], { revalidate: false });
      return inserted;
    },
    [mutate]
  );

  const updateTeam = useCallback(
    async (id: string, updates: Partial<Team>): Promise<boolean> => {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("teams")
        .update(updates)
        .eq("id", id);
      if (updateError) return false;
      await mutate(
        (prev) => (prev || []).map((t) => (t.id === id ? { ...t, ...updates } : t)),
        { revalidate: false }
      );
      return true;
    },
    [mutate]
  );

  const deleteTeam = useCallback(
    async (id: string): Promise<boolean> => {
      const supabase = createClient();
      const { error: deleteError } = await supabase
        .from("teams")
        .delete()
        .eq("id", id);
      if (deleteError) return false;
      await mutate(
        (prev) => (prev || []).filter((t) => t.id !== id),
        { revalidate: false }
      );
      return true;
    },
    [mutate]
  );

  return {
    teams,
    loading: isLoading,
    error: error instanceof Error ? error.message : null,
    refetch: async () => {
      await mutate();
    },
    addTeam,
    updateTeam,
    deleteTeam,
  };
}
