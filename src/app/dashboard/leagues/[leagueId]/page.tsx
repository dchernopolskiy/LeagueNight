import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Link2 } from "lucide-react";
import type { League, Team, Player, Game } from "@/lib/types";
import { PublicLinkCopy } from "@/components/dashboard/public-link-copy";

export default async function LeagueOverviewPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const supabase = await createClient();

  const [teamsRes, playersRes, gamesRes, leagueRes] = await Promise.all([
    supabase.from("teams").select("*").eq("league_id", leagueId),
    supabase.from("players").select("*").eq("league_id", leagueId),
    supabase
      .from("games")
      .select("*")
      .eq("league_id", leagueId)
      .eq("status", "scheduled")
      .order("scheduled_at")
      .limit(5),
    supabase.from("leagues").select("slug").eq("id", leagueId).single(),
  ]);

  const teams = (teamsRes.data || []) as Team[];
  const players = (playersRes.data || []) as Player[];
  const upcomingGames = (gamesRes.data || []) as Game[];
  const slug = leagueRes.data?.slug || "";

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {/* Public Link - full width */}
      {slug && (
        <div className="sm:col-span-3">
          <Card>
            <CardContent className="flex items-center gap-3 py-3">
              <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <code className="text-sm bg-muted px-2 py-1 rounded flex-1 truncate">
                /league/{slug}
              </code>
              <PublicLinkCopy slug={slug} />
              <a
                href={`/league/${slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center h-8 w-8 rounded-md border text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors shrink-0"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </CardContent>
          </Card>
        </div>
      )}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Teams
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">{teams.length}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Players
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">{players.length}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Upcoming Games
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">{upcomingGames.length}</p>
        </CardContent>
      </Card>

      <div className="sm:col-span-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Next Games</CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingGames.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No upcoming games. Generate a schedule to get started.
              </p>
            ) : (
              <div className="space-y-2">
                {upcomingGames.map((game) => {
                  const homeTeam = teams.find((t) => t.id === game.home_team_id);
                  const awayTeam = teams.find((t) => t.id === game.away_team_id);
                  return (
                    <div
                      key={game.id}
                      className="flex items-center justify-between py-2 border-b last:border-0"
                    >
                      <span className="text-sm">
                        {homeTeam?.name ?? "TBD"} vs {awayTeam?.name ?? "TBD"}
                      </span>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">
                          {new Date(game.scheduled_at).toLocaleDateString()}
                        </Badge>
                        {game.venue && (
                          <span className="text-xs text-muted-foreground">
                            {game.venue}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
