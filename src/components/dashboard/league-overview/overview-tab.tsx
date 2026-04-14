"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Calendar, Trophy } from "lucide-react";
import { format } from "date-fns";
import type { League, Team, Player, Game } from "@/lib/types";
import { PublicLinkCopy } from "@/components/dashboard/public-link-copy";

interface LeagueOverviewTabProps {
  league: League | null;
  teams: Team[];
  players: Player[];
  upcomingGames: Game[];
  loading: boolean;
}

export function LeagueOverviewTab({
  league,
  teams,
  players,
  upcomingGames,
  loading,
}: LeagueOverviewTabProps) {
  if (loading || !league) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Loading league overview...
          </CardContent>
        </Card>
      </div>
    );
  }

  const activePlayers = players.filter((p) => !p.is_sub);
  const subs = players.filter((p) => p.is_sub);

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Teams</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{teams.length}</div>
            <p className="text-xs text-muted-foreground">
              {activePlayers.length} players, {subs.length} subs
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Upcoming Games</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{upcomingGames.length}</div>
            <p className="text-xs text-muted-foreground">Next 5 scheduled</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Season</CardTitle>
            <Trophy className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold">
              {league.season_name || "Regular Season"}
            </div>
            {league.season_start && league.season_end && (
              <p className="text-xs text-muted-foreground">
                {format(new Date(league.season_start), "MMM d")} -{" "}
                {format(new Date(league.season_end), "MMM d, yyyy")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* League Info */}
      <Card>
        <CardHeader>
          <CardTitle>League Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="font-semibold text-sm mb-1">Name</h3>
            <p>{league.name}</p>
          </div>

          {league.description && (
            <div>
              <h3 className="font-semibold text-sm mb-1">Description</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {league.description}
              </p>
            </div>
          )}

          <div>
            <h3 className="font-semibold text-sm mb-1">Sport</h3>
            <Badge variant="outline">{league.sport || "Not specified"}</Badge>
          </div>

          <div>
            <h3 className="font-semibold text-sm mb-1">Timezone</h3>
            <p className="text-sm">{league.timezone}</p>
          </div>

          <div>
            <h3 className="font-semibold text-sm mb-1">Visibility</h3>
            <Badge variant={league.is_public ? "default" : "secondary"}>
              {league.is_public ? "Public" : "Private"}
            </Badge>
          </div>

          {league.is_public && (
            <div>
              <h3 className="font-semibold text-sm mb-1">Public Link</h3>
              <PublicLinkCopy slug={league.slug} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upcoming Games */}
      {upcomingGames.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Games</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {upcomingGames.map((game) => {
                const homeTeam = teams.find((t) => t.id === game.home_team_id);
                const awayTeam = teams.find((t) => t.id === game.away_team_id);
                return (
                  <div
                    key={game.id}
                    className="flex items-center justify-between text-sm py-2 border-b last:border-0"
                  >
                    <div className="flex-1">
                      <span className="font-medium">{homeTeam?.name || "TBD"}</span>
                      <span className="text-muted-foreground mx-2">vs</span>
                      <span className="font-medium">{awayTeam?.name || "TBD"}</span>
                    </div>
                    <div className="text-right text-muted-foreground">
                      {format(new Date(game.scheduled_at), "MMM d, h:mm a")}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
