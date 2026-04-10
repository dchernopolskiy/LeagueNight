import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/supabase/helpers";
import { redirect } from "next/navigation";
import { LocationsManager } from "@/components/dashboard/locations-manager";
import type { Location, LocationUnavailability, League, Game } from "@/lib/types";

export default async function LocationsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();

  // Find organizer IDs for leagues where this user is staff (co-organizer)
  const { data: staffLeagues } = await supabase
    .from("league_staff")
    .select("league_id, league:leagues!league_staff_league_id_fkey(organizer_id)")
    .eq("profile_id", profile.id);

  const organizerIds = [
    profile.id,
    ...new Set(
      (staffLeagues || [])
        .map((s: any) => s.league?.organizer_id)
        .filter((id: string | undefined): id is string => !!id && id !== profile.id)
    ),
  ];
  const staffLeagueIds = (staffLeagues || []).map((s: any) => s.league_id).filter(Boolean);

  const [locationsRes, ownedLeaguesRes, staffLeaguesRes] = await Promise.all([
    supabase
      .from("locations")
      .select("*")
      .in("organizer_id", organizerIds)
      .order("name"),
    supabase
      .from("leagues")
      .select("*")
      .eq("organizer_id", profile.id)
      .is("archived_at", null),
    staffLeagueIds.length > 0
      ? supabase
          .from("leagues")
          .select("*")
          .in("id", staffLeagueIds)
          .is("archived_at", null)
      : Promise.resolve({ data: [] }),
  ]);

  // Merge owned + staff leagues, deduplicate
  const leagueMap = new Map<string, League>();
  for (const l of (ownedLeaguesRes.data || []) as League[]) leagueMap.set(l.id, l);
  for (const l of ((staffLeaguesRes as any).data || []) as League[]) {
    if (!leagueMap.has(l.id)) leagueMap.set(l.id, l);
  }

  const locations = (locationsRes.data || []) as Location[];
  const leagues = Array.from(leagueMap.values());
  const locationIds = locations.map((l) => l.id);
  const leagueIds = leagues.map((l) => l.id);

  let unavailability: LocationUnavailability[] = [];
  let games: Game[] = [];

  if (locationIds.length > 0 && leagueIds.length > 0) {
    const [unavailRes, gamesRes] = await Promise.all([
      supabase
        .from("location_unavailability")
        .select("*")
        .in("location_id", locationIds)
        .order("unavailable_date"),
      supabase
        .from("games")
        .select("*")
        .in("league_id", leagueIds)
        .eq("status", "scheduled")
        .order("scheduled_at"),
    ]);
    unavailability = (unavailRes.data || []) as LocationUnavailability[];
    games = (gamesRes.data || []) as Game[];
  } else if (locationIds.length > 0) {
    const { data } = await supabase
      .from("location_unavailability")
      .select("*")
      .in("location_id", locationIds)
      .order("unavailable_date");
    unavailability = (data || []) as LocationUnavailability[];
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Locations</h1>
      <LocationsManager
        initialLocations={locations}
        initialUnavailability={unavailability}
        organizerId={profile.id}
        leagues={leagues}
        games={games}
      />
    </div>
  );
}
