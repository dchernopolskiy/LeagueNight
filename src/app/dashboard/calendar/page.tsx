import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/supabase/helpers";
import { redirect } from "next/navigation";
import { CalendarView } from "@/components/dashboard/calendar-filters";
import type { Game, League, Team, Location, LocationUnavailability, OpenGymSession } from "@/lib/types";

export default async function CalendarPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();

  // Get all leagues for this user (owned, staff, or player)
  const [ownedRes, staffRes, playerRes] = await Promise.all([
    supabase.from("leagues").select("*").eq("organizer_id", profile.id).is("archived_at", null),
    supabase.from("league_staff").select("league_id, leagues(*)").eq("profile_id", profile.id),
    supabase.from("players").select("league_id, leagues(*)").eq("profile_id", profile.id),
  ]);
  const owned = (ownedRes.data || []) as League[];
  const knownIds = new Set(owned.map((l) => l.id));
  const staffLeagues = (staffRes.data || []).map((s: any) => s.leagues).filter((l: any) => l && !l.archived_at && !knownIds.has(l.id)) as League[];
  staffLeagues.forEach((l) => knownIds.add(l.id));
  const playerLeagues = (playerRes.data || []).map((p: any) => p.leagues).filter((l: any) => l && !l.archived_at && !knownIds.has(l.id)) as League[];
  const leagues = [...owned, ...staffLeagues, ...playerLeagues];

  if (!leagues || leagues.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Calendar</h1>
        <p className="text-sm text-muted-foreground text-center py-12">
          No upcoming games across your leagues
        </p>
      </div>
    );
  }

  const leagueIds = leagues.map((l) => l.id);

  // Fetch all games, teams, and locations across all leagues
  const [gamesRes, teamsRes, locationsRes] = await Promise.all([
    supabase
      .from("games")
      .select("*")
      .in("league_id", leagueIds)
      .order("scheduled_at"),
    supabase
      .from("teams")
      .select("*")
      .in("league_id", leagueIds),
    supabase
      .from("locations")
      .select("*")
      .eq("organizer_id", profile.id)
      .order("name"),
  ]);

  const games = (gamesRes.data || []) as Game[];
  const teams = (teamsRes.data || []) as Team[];
  const locations = (locationsRes.data || []) as Location[];

  // Fetch location unavailability and open gym sessions in parallel
  const [locationUnavailabilityRes, openGymRes] = await Promise.all([
    locations.length > 0
      ? supabase
          .from("location_unavailability")
          .select("*")
          .in("location_id", locations.map((l) => l.id))
          .order("unavailable_date")
      : Promise.resolve({ data: [] }),
    supabase
      .from("open_gym_sessions")
      .select("*")
      .eq("organizer_id", profile.id)
      .eq("is_active", true),
  ]);
  const locationUnavailability = (locationUnavailabilityRes.data || []) as LocationUnavailability[];
  const openGymSessions = (openGymRes.data || []) as OpenGymSession[];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Calendar</h1>
      <CalendarView
        games={games}
        leagues={leagues as League[]}
        teams={teams}
        locations={locations}
        locationUnavailability={locationUnavailability}
        openGymSessions={openGymSessions}
      />
    </div>
  );
}
