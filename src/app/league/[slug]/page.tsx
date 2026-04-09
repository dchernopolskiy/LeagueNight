import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
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
import type { League, Team, Game, Standing, Player } from "@/lib/types";

export default async function PublicLeaguePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = createAdminClient();

  const { data: league } = await supabase
    .from("leagues")
    .select("*")
    .eq("slug", slug)
    .eq("is_public", true)
    .single();

  if (!league) notFound();
  const lg = league as League;

  const [teamsRes, gamesRes, standingsRes] = await Promise.all([
    supabase.from("teams").select("*").eq("league_id", lg.id).order("name"),
    supabase
      .from("games")
      .select("*")
      .eq("league_id", lg.id)
      .order("scheduled_at"),
    supabase
      .from("standings")
      .select("*")
      .eq("league_id", lg.id)
      .order("rank"),
  ]);

  const teams = (teamsRes.data || []) as Team[];
  const games = (gamesRes.data || []) as Game[];
  const standings = (standingsRes.data || []) as Standing[];
  const teamsMap = new Map(teams.map((t) => [t.id, t]));

  const upcoming = games.filter((g) => g.status === "scheduled");
  const completed = games.filter((g) => g.status === "completed");

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-4 space-y-8">
        {/* Header */}
        <div className="text-center pt-8">
          <h1 className="text-3xl font-bold">{lg.name}</h1>
          <div className="flex items-center justify-center gap-2 mt-2">
            {lg.sport && <Badge>{lg.sport}</Badge>}
            {lg.season_name && (
              <span className="text-muted-foreground">{lg.season_name}</span>
            )}
          </div>
          {lg.description && (
            <p className="text-muted-foreground mt-2 max-w-md mx-auto">
              {lg.description}
            </p>
          )}
        </div>

        {/* Standings */}
        {standings.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Standings</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead className="text-center">W</TableHead>
                    <TableHead className="text-center">L</TableHead>
                    <TableHead className="text-center">T</TableHead>
                    <TableHead className="text-center">PD</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {standings.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.rank}</TableCell>
                      <TableCell>{teamsMap.get(s.team_id)?.name}</TableCell>
                      <TableCell className="text-center">{s.wins}</TableCell>
                      <TableCell className="text-center">{s.losses}</TableCell>
                      <TableCell className="text-center">{s.ties}</TableCell>
                      <TableCell className="text-center">
                        {s.points_for - s.points_against > 0 ? "+" : ""}
                        {s.points_for - s.points_against}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Upcoming Schedule */}
        <Card>
          <CardHeader>
            <CardTitle>
              {upcoming.length > 0 ? "Upcoming Games" : "Schedule"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 && completed.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Schedule not yet published.
              </p>
            ) : (
              <div className="space-y-2">
                {upcoming.map((game) => (
                  <div
                    key={game.id}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <span className="text-sm font-medium">
                      {teamsMap.get(game.home_team_id)?.name} vs{" "}
                      {teamsMap.get(game.away_team_id)?.name}
                    </span>
                    <div className="text-right">
                      <p className="text-sm">
                        {format(new Date(game.scheduled_at), "EEE, MMM d")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(game.scheduled_at), "h:mm a")}
                        {game.venue && ` — ${game.venue}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Results */}
        {completed.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Recent Results</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {completed
                  .slice(-10)
                  .reverse()
                  .map((game) => (
                    <div
                      key={game.id}
                      className="flex items-center justify-between py-2 border-b last:border-0"
                    >
                      <span className="text-sm">
                        {teamsMap.get(game.home_team_id)?.name}{" "}
                        <span className="font-bold">
                          {game.home_score} - {game.away_score}
                        </span>{" "}
                        {teamsMap.get(game.away_team_id)?.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(game.scheduled_at), "MMM d")}
                      </span>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Teams / Rosters */}
        <Card>
          <CardHeader>
            <CardTitle>Teams</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              {teams.map((team) => (
                <div key={team.id} className="border rounded-lg p-3">
                  <h3 className="font-medium">{team.name}</h3>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground pb-8">
          Powered by LeagueNight
        </p>
      </div>
    </div>
  );
}
