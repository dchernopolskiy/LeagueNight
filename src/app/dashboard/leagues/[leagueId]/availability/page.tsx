import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import type { Game, Team, Player, Rsvp } from "@/lib/types";

export default async function AvailabilityPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const supabase = await createClient();

  const [gamesRes, teamsRes, playersRes] = await Promise.all([
    supabase
      .from("games")
      .select("*")
      .eq("league_id", leagueId)
      .eq("status", "scheduled")
      .order("scheduled_at")
      .limit(5),
    supabase.from("teams").select("*").eq("league_id", leagueId),
    supabase
      .from("players")
      .select("*")
      .eq("league_id", leagueId)
      .eq("is_sub", false)
      .order("name"),
  ]);

  const games = (gamesRes.data || []) as Game[];
  const teams = (teamsRes.data || []) as Team[];
  const players = (playersRes.data || []) as Player[];
  const teamsMap = new Map(teams.map((t) => [t.id, t]));

  // Get all RSVPs for these games
  const gameIds = games.map((g) => g.id);
  const { data: rsvps } = gameIds.length
    ? await supabase.from("rsvps").select("*").in("game_id", gameIds)
    : { data: [] };

  const rsvpMap = new Map<string, Rsvp>();
  for (const r of (rsvps || []) as Rsvp[]) {
    rsvpMap.set(`${r.game_id}:${r.player_id}`, r);
  }

  if (games.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">
            No upcoming games. Generate a schedule first.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Group players by team
  const teamGroups = teams.map((team) => ({
    team,
    players: players.filter((p) => p.team_id === team.id),
  }));

  return (
    <div className="space-y-6">
      {teamGroups.map(({ team, players: teamPlayers }) => {
        if (teamPlayers.length === 0) return null;

        // Filter to games involving this team
        const teamGames = games.filter(
          (g) => g.home_team_id === team.id || g.away_team_id === team.id
        );

        if (teamGames.length === 0) return null;

        return (
          <Card key={team.id}>
            <CardHeader>
              <CardTitle className="text-base">{team.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 bg-card">
                        Player
                      </TableHead>
                      {teamGames.map((game) => {
                        const opponent =
                          game.home_team_id === team.id
                            ? teamsMap.get(game.away_team_id)
                            : teamsMap.get(game.home_team_id);
                        return (
                          <TableHead key={game.id} className="text-center min-w-20">
                            <div className="text-xs">
                              {format(new Date(game.scheduled_at), "MMM d")}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              vs {opponent?.name}
                            </div>
                          </TableHead>
                        );
                      })}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {teamPlayers.map((player) => (
                      <TableRow key={player.id}>
                        <TableCell className="sticky left-0 bg-card font-medium">
                          {player.name}
                        </TableCell>
                        {teamGames.map((game) => {
                          const rsvp = rsvpMap.get(
                            `${game.id}:${player.id}`
                          );
                          return (
                            <TableCell key={game.id} className="text-center">
                              {rsvp ? (
                                <Badge
                                  variant={
                                    rsvp.response === "yes"
                                      ? "default"
                                      : rsvp.response === "no"
                                      ? "destructive"
                                      : "secondary"
                                  }
                                  className="text-xs"
                                >
                                  {rsvp.response === "yes"
                                    ? "In"
                                    : rsvp.response === "no"
                                    ? "Out"
                                    : "?"}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  --
                                </span>
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
