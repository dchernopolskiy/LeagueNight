"use client";

import { useState, useEffect, useCallback } from "react";
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

/**
 * Hook for managing teams in a league.
 * Provides CRUD operations with optimistic updates.
 */
export function useTeams(leagueId: string | null): UseTeamsReturn {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTeams = useCallback(async () => {
    if (!leagueId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const supabase = createClient();

      const { data, error: fetchError } = await supabase
        .from("teams")
        .select("*")
        .eq("league_id", leagueId)
        .order("name");

      if (fetchError) throw new Error(fetchError.message);

      setTeams(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load teams");
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  const addTeam = useCallback(
    async (team: Omit<Team, "id" | "created_at">): Promise<Team | null> => {
      try {
        const supabase = createClient();
        const { data, error: insertError } = await supabase
          .from("teams")
          .insert(team)
          .select()
          .single();

        if (insertError) throw new Error(insertError.message);

        // Optimistic update
        setTeams((prev) => [...prev, data]);
        return data;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add team");
        return null;
      }
    },
    []
  );

  const updateTeam = useCallback(
    async (id: string, updates: Partial<Team>): Promise<boolean> => {
      try {
        const supabase = createClient();
        const { error: updateError } = await supabase
          .from("teams")
          .update(updates)
          .eq("id", id);

        if (updateError) throw new Error(updateError.message);

        // Optimistic update
        setTeams((prev) =>
          prev.map((team) => (team.id === id ? { ...team, ...updates } : team))
        );
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update team");
        return false;
      }
    },
    []
  );

  const deleteTeam = useCallback(async (id: string): Promise<boolean> => {
    try {
      const supabase = createClient();
      const { error: deleteError } = await supabase
        .from("teams")
        .delete()
        .eq("id", id);

      if (deleteError) throw new Error(deleteError.message);

      // Optimistic update
      setTeams((prev) => prev.filter((team) => team.id !== id));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete team");
      return false;
    }
  }, []);

  return {
    teams,
    loading,
    error,
    refetch: fetchTeams,
    addTeam,
    updateTeam,
    deleteTeam,
  };
}
