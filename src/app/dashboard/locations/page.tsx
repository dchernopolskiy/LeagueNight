import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/supabase/helpers";
import { redirect } from "next/navigation";
import { LocationsManager } from "@/components/dashboard/locations-manager";
import type { Location, LocationUnavailability, League, Game } from "@/lib/types";

export default async function LocationsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();

  const [locationsRes, leaguesRes] = await Promise.all([
    supabase
      .from("locations")
      .select("*")
      .eq("organizer_id", profile.id)
      .order("name"),
    supabase
      .from("leagues")
      .select("*")
      .eq("organizer_id", profile.id)
      .is("archived_at", null),
  ]);

  const locations = (locationsRes.data || []) as Location[];
  const leagues = (leaguesRes.data || []) as League[];
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
