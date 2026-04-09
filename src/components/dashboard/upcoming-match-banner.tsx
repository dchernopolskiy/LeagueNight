"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { format } from "date-fns";
import { CalendarClock, MapPin, Bell } from "lucide-react";
import type { Game, Team, Location } from "@/lib/types";

interface UpcomingMatch {
  game: Game;
  opponent: Team;
  venue: string;
  locationName?: string;
}

export function UpcomingMatchBanner({ leagueId }: { leagueId: string }) {
  const [matches, setMatches] = useState<UpcomingMatch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUpcoming();
  }, [leagueId]);

  async function loadUpcoming() {
    const supabase = createClient();

    // Get current user's profile
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("auth_id", user.id)
      .single();
    if (!profile) {
      setLoading(false);
      return;
    }

    // Find the player record(s) for this user in this league
    const { data: playerRecords } = await supabase
      .from("players")
      .select("id, team_id")
      .eq("league_id", leagueId)
      .eq("profile_id", profile.id);

    if (!playerRecords || playerRecords.length === 0) {
      setLoading(false);
      return;
    }

    const teamIds = playerRecords
      .map((p) => p.team_id)
      .filter(Boolean) as string[];

    if (teamIds.length === 0) {
      setLoading(false);
      return;
    }

    // Fetch upcoming games for these teams
    const now = new Date().toISOString();
    const { data: games } = await supabase
      .from("games")
      .select("*")
      .eq("league_id", leagueId)
      .eq("status", "scheduled")
      .gte("scheduled_at", now)
      .order("scheduled_at")
      .limit(5);

    if (!games || games.length === 0) {
      setLoading(false);
      return;
    }

    // Filter to only games involving user's teams
    const teamIdSet = new Set(teamIds);
    const myGames = (games as Game[]).filter(
      (g) => teamIdSet.has(g.home_team_id) || teamIdSet.has(g.away_team_id)
    );

    if (myGames.length === 0) {
      setLoading(false);
      return;
    }

    // Fetch teams for opponent names
    const allTeamIds = new Set<string>();
    myGames.forEach((g) => {
      allTeamIds.add(g.home_team_id);
      allTeamIds.add(g.away_team_id);
    });

    const { data: teams } = await supabase
      .from("teams")
      .select("*")
      .in("id", [...allTeamIds]);

    const teamsMap = new Map((teams || []).map((t: Team) => [t.id, t]));

    // Fetch locations if games have location_id
    const locationIds = [
      ...new Set(myGames.map((g) => g.location_id).filter(Boolean)),
    ] as string[];
    let locationsMap = new Map<string, Location>();
    if (locationIds.length > 0) {
      const { data: locs } = await supabase
        .from("locations")
        .select("*")
        .in("id", locationIds);
      locationsMap = new Map(
        (locs || []).map((l: Location) => [l.id, l])
      );
    }

    // Group by date — show next game day's games
    const firstDate = myGames[0].scheduled_at.split("T")[0];
    const nextDayGames = myGames.filter(
      (g) => g.scheduled_at.split("T")[0] === firstDate
    );

    const upcoming: UpcomingMatch[] = nextDayGames.map((game) => {
      const isHome = teamIdSet.has(game.home_team_id);
      const opponentId = isHome ? game.away_team_id : game.home_team_id;
      const opponent = teamsMap.get(opponentId);
      const location = game.location_id
        ? locationsMap.get(game.location_id)
        : undefined;
      return {
        game,
        opponent: opponent || { id: opponentId, name: "TBD" } as Team,
        venue: game.venue || location?.name || "TBD",
        locationName: location?.name,
      };
    });

    setMatches(upcoming);
    setLoading(false);
  }

  if (loading || matches.length === 0) return null;

  const firstGame = matches[0].game;
  const gameDate = format(new Date(firstGame.scheduled_at), "EEE, MMM d");
  const venueName =
    matches[0].locationName || matches[0].venue;

  // Deduplicate venues for display
  const venues = [...new Set(matches.map((m) => m.locationName || m.venue))];

  return (
    <div className="bg-primary/10 border border-primary/20 rounded-lg px-4 py-3 mb-4">
      <div className="flex items-start gap-3">
        <div className="bg-primary/20 rounded-full p-2 shrink-0 mt-0.5">
          <CalendarClock className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">
              Next match{matches.length > 1 ? "es" : ""}:
            </span>
            <span className="text-sm text-foreground">
              {gameDate}
            </span>
            <span className="text-sm text-muted-foreground">at</span>
            <span className="text-sm font-medium text-foreground">
              {matches.map((m) =>
                format(new Date(m.game.scheduled_at), "h:mm a")
              ).join(", ")}
            </span>
          </div>
          <div className="flex items-center gap-4 mt-1 flex-wrap">
            {matches.map((m, i) => (
              <span key={m.game.id} className="text-xs text-muted-foreground">
                vs {m.opponent.name}
                {m.game.court ? ` · ${m.game.court}` : ""}
              </span>
            ))}
            {venues.length > 0 && venues[0] !== "TBD" && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {venues.join(", ")}
              </span>
            )}
          </div>
        </div>
        {/* Notification plug — future: in-browser push notifications */}
        <button
          className="shrink-0 p-1.5 rounded-md hover:bg-primary/20 transition-colors text-primary"
          title="Notification settings (coming soon)"
          aria-label="Notification settings"
        >
          <Bell className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
