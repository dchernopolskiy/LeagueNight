"use client";

import { useCallback } from "react";
import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";
import type { Location, LocationUnavailability } from "@/lib/types";

interface LocationsBundle {
  locations: Location[];
  unavailability: LocationUnavailability[];
}

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

async function fetchLocationsBundle(organizerId: string): Promise<LocationsBundle> {
  const supabase = createClient();
  const { data: locsData, error: locsError } = await supabase
    .from("locations")
    .select("*")
    .eq("organizer_id", organizerId)
    .order("name");
  if (locsError) throw new Error(locsError.message);

  const locations = locsData || [];
  let unavailability: LocationUnavailability[] = [];
  if (locations.length > 0) {
    const locationIds = locations.map((l) => l.id);
    const { data: unavailData, error: unavailError } = await supabase
      .from("location_unavailability")
      .select("*")
      .in("location_id", locationIds)
      .order("unavailable_date");
    if (unavailError) throw new Error(unavailError.message);
    unavailability = unavailData || [];
  }

  return { locations, unavailability };
}

/**
 * Hook for managing locations and their unavailability schedules.
 * Backed by SWR.
 */
export function useLocations(organizerId: string | null): UseLocationsReturn {
  const swrKey = organizerId ? (["locations", organizerId] as const) : null;
  const { data, error, isLoading, mutate } = useSWR(
    swrKey,
    ([, id]) => fetchLocationsBundle(id),
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  );

  const locations = data?.locations || [];
  const unavailability = data?.unavailability || [];

  const addLocation = useCallback(
    async (location: Omit<Location, "id" | "created_at">): Promise<Location | null> => {
      const supabase = createClient();
      const { data: inserted, error: insertError } = await supabase
        .from("locations")
        .insert(location)
        .select()
        .single();
      if (insertError) return null;
      await mutate(
        (prev) => ({
          locations: [...(prev?.locations || []), inserted],
          unavailability: prev?.unavailability || [],
        }),
        { revalidate: false }
      );
      return inserted;
    },
    [mutate]
  );

  const updateLocation = useCallback(
    async (id: string, updates: Partial<Location>): Promise<boolean> => {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("locations")
        .update(updates)
        .eq("id", id);
      if (updateError) return false;
      await mutate(
        (prev) => ({
          locations: (prev?.locations || []).map((l) =>
            l.id === id ? { ...l, ...updates } : l
          ),
          unavailability: prev?.unavailability || [],
        }),
        { revalidate: false }
      );
      return true;
    },
    [mutate]
  );

  const deleteLocation = useCallback(
    async (id: string): Promise<boolean> => {
      const supabase = createClient();
      const { error: deleteError } = await supabase
        .from("locations")
        .delete()
        .eq("id", id);
      if (deleteError) return false;
      await mutate(
        (prev) => ({
          locations: (prev?.locations || []).filter((l) => l.id !== id),
          unavailability: (prev?.unavailability || []).filter(
            (u) => u.location_id !== id
          ),
        }),
        { revalidate: false }
      );
      return true;
    },
    [mutate]
  );

  const addUnavailability = useCallback(
    async (
      unavail: Omit<LocationUnavailability, "id" | "created_at">
    ): Promise<LocationUnavailability | null> => {
      const supabase = createClient();
      const { data: inserted, error: insertError } = await supabase
        .from("location_unavailability")
        .insert(unavail)
        .select()
        .single();
      if (insertError) return null;
      await mutate(
        (prev) => ({
          locations: prev?.locations || [],
          unavailability: [...(prev?.unavailability || []), inserted],
        }),
        { revalidate: false }
      );
      return inserted;
    },
    [mutate]
  );

  const deleteUnavailability = useCallback(
    async (id: string): Promise<boolean> => {
      const supabase = createClient();
      const { error: deleteError } = await supabase
        .from("location_unavailability")
        .delete()
        .eq("id", id);
      if (deleteError) return false;
      await mutate(
        (prev) => ({
          locations: prev?.locations || [],
          unavailability: (prev?.unavailability || []).filter((u) => u.id !== id),
        }),
        { revalidate: false }
      );
      return true;
    },
    [mutate]
  );

  return {
    locations,
    unavailability,
    loading: isLoading,
    error: error instanceof Error ? error.message : null,
    refetch: async () => {
      await mutate();
    },
    addLocation,
    updateLocation,
    deleteLocation,
    addUnavailability,
    deleteUnavailability,
  };
}
