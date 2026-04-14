"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Location, LocationUnavailability } from "@/lib/types";

interface UseLocationsReturn {
  locations: Location[];
  unavailability: LocationUnavailability[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  addLocation: (location: Omit<Location, "id" | "created_at">) => Promise<Location | null>;
  updateLocation: (id: string, updates: Partial<Location>) => Promise<boolean>;
  deleteLocation: (id: string) => Promise<boolean>;
  addUnavailability: (
    unavail: Omit<LocationUnavailability, "id" | "created_at">
  ) => Promise<LocationUnavailability | null>;
  deleteUnavailability: (id: string) => Promise<boolean>;
}

/**
 * Hook for managing locations and their unavailability schedules.
 * Used by organizers to manage their venues.
 */
export function useLocations(organizerId: string | null): UseLocationsReturn {
  const [locations, setLocations] = useState<Location[]>([]);
  const [unavailability, setUnavailability] = useState<LocationUnavailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!organizerId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const supabase = createClient();

      const { data: locsData, error: locsError } = await supabase
        .from("locations")
        .select("*")
        .eq("organizer_id", organizerId)
        .order("name");

      if (locsError) throw new Error(locsError.message);

      setLocations(locsData || []);

      // Fetch unavailability for all locations
      if (locsData && locsData.length > 0) {
        const locationIds = locsData.map((l) => l.id);
        const { data: unavailData, error: unavailError } = await supabase
          .from("location_unavailability")
          .select("*")
          .in("location_id", locationIds)
          .order("unavailable_date");

        if (unavailError) throw new Error(unavailError.message);
        setUnavailability(unavailData || []);
      } else {
        setUnavailability([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load locations");
    } finally {
      setLoading(false);
    }
  }, [organizerId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const addLocation = useCallback(
    async (location: Omit<Location, "id" | "created_at">): Promise<Location | null> => {
      try {
        const supabase = createClient();
        const { data, error: insertError } = await supabase
          .from("locations")
          .insert(location)
          .select()
          .single();

        if (insertError) throw new Error(insertError.message);

        setLocations((prev) => [...prev, data]);
        return data;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add location");
        return null;
      }
    },
    []
  );

  const updateLocation = useCallback(
    async (id: string, updates: Partial<Location>): Promise<boolean> => {
      try {
        const supabase = createClient();
        const { error: updateError } = await supabase
          .from("locations")
          .update(updates)
          .eq("id", id);

        if (updateError) throw new Error(updateError.message);

        setLocations((prev) =>
          prev.map((loc) => (loc.id === id ? { ...loc, ...updates } : loc))
        );
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update location");
        return false;
      }
    },
    []
  );

  const deleteLocation = useCallback(async (id: string): Promise<boolean> => {
    try {
      const supabase = createClient();
      const { error: deleteError } = await supabase
        .from("locations")
        .delete()
        .eq("id", id);

      if (deleteError) throw new Error(deleteError.message);

      setLocations((prev) => prev.filter((loc) => loc.id !== id));
      setUnavailability((prev) => prev.filter((u) => u.location_id !== id));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete location");
      return false;
    }
  }, []);

  const addUnavailability = useCallback(
    async (
      unavail: Omit<LocationUnavailability, "id" | "created_at">
    ): Promise<LocationUnavailability | null> => {
      try {
        const supabase = createClient();
        const { data, error: insertError } = await supabase
          .from("location_unavailability")
          .insert(unavail)
          .select()
          .single();

        if (insertError) throw new Error(insertError.message);

        setUnavailability((prev) => [...prev, data]);
        return data;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add unavailability");
        return null;
      }
    },
    []
  );

  const deleteUnavailability = useCallback(async (id: string): Promise<boolean> => {
    try {
      const supabase = createClient();
      const { error: deleteError } = await supabase
        .from("location_unavailability")
        .delete()
        .eq("id", id);

      if (deleteError) throw new Error(deleteError.message);

      setUnavailability((prev) => prev.filter((u) => u.id !== id));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete unavailability");
      return false;
    }
  }, []);

  return {
    locations,
    unavailability,
    loading,
    error,
    refetch: fetchData,
    addLocation,
    updateLocation,
    deleteLocation,
    addUnavailability,
    deleteUnavailability,
  };
}
