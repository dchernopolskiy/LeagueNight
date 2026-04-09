import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import Link from "next/link";
import type { Player, League, Team, Game, Rsvp } from "@/lib/types";

export default async function PlayerPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = createAdminClient();

  // Resolve player from token
  const { data: player } = await supabase
    .from("players")
    .select("*")
    .eq("token", token)
    .single();

  if (!player) notFound();
  const p = player as Player;

  // Get league + team info
  const { data: league } = await supabase
    .from("leagues")
    .select("*")
    .eq("id", p.league_id)
    .single();

  const lg = league as League;

  const { data: team } = p.team_id
    ? await supabase.from("teams").select("*").eq("id", p.team_id).single()
    : { data: null };

  // Get upcoming games for this player's team
  const upcomingGamesQuery = supabase
    .from("games")
    .select("*")
    .eq("league_id", p.league_id)
    .eq("status", "scheduled")
    .order("scheduled_at")
    .limit(10);

  if (p.team_id) {
    upcomingGamesQuery.or(
      `home_team_id.eq.${p.team_id},away_team_id.eq.${p.team_id}`
    );
  }

  const { data: games } = await upcomingGamesQuery;
  const upcomingGames = (games || []) as Game[];

  // Get teams for display
  const { data: allTeams } = await supabase
    .from("teams")
    .select("*")
    .eq("league_id", p.league_id);
  const teamsMap = new Map((allTeams || []).map((t) => [t.id, t as Team]));

  // Get RSVPs for these games
  const gameIds = upcomingGames.map((g) => g.id);
  const { data: rsvps } = gameIds.length
    ? await supabase
        .from("rsvps")
        .select("*")
        .eq("player_id", p.id)
        .in("game_id", gameIds)
    : { data: [] };
  const rsvpMap = new Map((rsvps || []).map((r) => [r.game_id, r as Rsvp]));

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto p-4 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">{lg.name}</h1>
          <p className="text-muted-foreground">
            Welcome, {p.name}
            {(team as Team | null)?.name && (
              <> &mdash; {(team as Team).name}</>
            )}
          </p>
        </div>

        {/* Upcoming games */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upcoming Games</CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingGames.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upcoming games.</p>
            ) : (
              <div className="space-y-3">
                {upcomingGames.map((game) => {
                  const home = teamsMap.get(game.home_team_id);
                  const away = teamsMap.get(game.away_team_id);
                  const rsvp = rsvpMap.get(game.id);
                  const dateStr = format(
                    new Date(game.scheduled_at),
                    "EEE, MMM d 'at' h:mm a"
                  );

                  return (
                    <div
                      key={game.id}
                      className="border rounded-lg p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">
                          {home?.name ?? "TBD"} vs {away?.name ?? "TBD"}
                        </span>
                        {rsvp && (
                          <Badge
                            variant={
                              rsvp.response === "yes"
                                ? "default"
                                : rsvp.response === "no"
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {rsvp.response}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{dateStr}</p>
                      {game.venue && (
                        <p className="text-xs text-muted-foreground">
                          {game.venue}
                        </p>
                      )}
                      {/* RSVP buttons */}
                      <div className="flex gap-2">
                        {(["yes", "no", "maybe"] as const).map((action) => (
                          <Link
                            key={action}
                            href={`/p/${token}/rsvp/${game.id}?action=${action}`}
                            className={`flex-1 text-center py-1.5 rounded text-sm font-medium border transition-colors ${
                              rsvp?.response === action
                                ? "bg-primary text-primary-foreground"
                                : "hover:bg-accent"
                            }`}
                          >
                            {action === "yes"
                              ? "In"
                              : action === "no"
                              ? "Out"
                              : "Maybe"}
                          </Link>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick links */}
        <div className="flex gap-2 text-sm">
          <Link
            href={`/league/${lg.slug}`}
            className="text-muted-foreground hover:text-foreground underline"
          >
            League page
          </Link>
          <Link
            href={`/p/${token}/settings`}
            className="text-muted-foreground hover:text-foreground underline"
          >
            Notification settings
          </Link>
        </div>
      </div>
    </div>
  );
}
