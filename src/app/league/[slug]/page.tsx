"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format, isSameWeek, startOfWeek } from "date-fns";
import { Search, X, TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { League, Team, Game, Standing } from "@/lib/types";

export default function PublicLeaguePage() {
  const { slug } = useParams<{ slug: string }>();
  const [league, setLeague] = useState<League | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);

  useEffect(() => {
    loadData();
  }, [slug]);

  async function loadData() {
    const supabase = createClient();

    const { data: leagueData } = await supabase
      .from("leagues")
      .select("*")
      .eq("slug", slug)
      .eq("is_public", true)
      .single();

    if (!leagueData) {
      setLoading(false);
      return;
    }

    const lg = leagueData as League;
    setLeague(lg);

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

    setTeams((teamsRes.data || []) as Team[]);
    setGames((gamesRes.data || []) as Game[]);
    setStandings((standingsRes.data || []) as Standing[]);
    setLoading(false);
  }

  const teamsMap = new Map(teams.map((t) => [t.id, t]));
  const standingsMap = new Map(standings.map((s) => [s.team_id, s]));

  // Filter teams based on search
  const filteredTeams = searchQuery.trim()
    ? teams.filter((t) =>
        t.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  // Auto-select team if only one match
  useEffect(() => {
    if (filteredTeams.length === 1 && filteredTeams[0].id !== selectedTeam?.id) {
      setSelectedTeam(filteredTeams[0]);
    } else if (filteredTeams.length !== 1 && searchQuery && selectedTeam) {
      // Clear selection if search changes and no longer matches selected team
      if (!selectedTeam.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        setSelectedTeam(null);
      }
    }
  }, [searchQuery, filteredTeams.length]);

  function selectTeam(team: Team) {
    setSelectedTeam(team);
    setSearchQuery(team.name);
  }

  function clearSearch() {
    setSearchQuery("");
    setSelectedTeam(null);
  }

  // Get team's standing info
  const getTeamStandingInfo = (teamId: string) => {
    const standing = standingsMap.get(teamId);
    if (!standing || standing.rank === null) return null;

    const rank = standing.rank;
    const total = standings.length;
    const percentile = total > 1 ? ((total - rank) / (total - 1)) * 100 : 50;

    // Determine trend icon
    let trend: "up" | "down" | "neutral" = "neutral";
    if (percentile >= 66) trend = "up";
    else if (percentile <= 33) trend = "down";

    return {
      standing,
      rank,
      total,
      percentile: Math.round(percentile),
      trend,
    };
  };

  // Get team's upcoming games grouped by week
  const getTeamUpcomingGames = (teamId: string) => {
    const teamGames = games.filter(
      (g) =>
        g.status === "scheduled" &&
        (g.home_team_id === teamId || g.away_team_id === teamId)
    );

    // Group by week
    const gamesByWeek = new Map<string, Game[]>();
    teamGames.forEach((game) => {
      const weekStart = startOfWeek(new Date(game.scheduled_at), {
        weekStartsOn: 0,
      });
      const weekKey = weekStart.toISOString();
      if (!gamesByWeek.has(weekKey)) {
        gamesByWeek.set(weekKey, []);
      }
      gamesByWeek.get(weekKey)!.push(game);
    });

    return Array.from(gamesByWeek.entries())
      .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
      .map(([weekKey, weekGames]) => ({
        weekStart: new Date(weekKey),
        games: weekGames.sort(
          (a, b) =>
            new Date(a.scheduled_at).getTime() -
            new Date(b.scheduled_at).getTime()
        ),
      }));
  };

  // Compact schedule view - grouped by week
  const getScheduleByWeek = () => {
    const upcoming = games.filter((g) => g.status === "scheduled");
    const gamesByWeek = new Map<string, Game[]>();

    upcoming.forEach((game) => {
      const weekStart = startOfWeek(new Date(game.scheduled_at), {
        weekStartsOn: 0,
      });
      const weekKey = weekStart.toISOString();
      if (!gamesByWeek.has(weekKey)) {
        gamesByWeek.set(weekKey, []);
      }
      gamesByWeek.get(weekKey)!.push(game);
    });

    return Array.from(gamesByWeek.entries())
      .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
      .slice(0, 4) // Only show next 4 weeks
      .map(([weekKey, weekGames]) => ({
        weekStart: new Date(weekKey),
        games: weekGames.sort(
          (a, b) =>
            new Date(a.scheduled_at).getTime() -
            new Date(b.scheduled_at).getTime()
        ),
      }));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!league) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">League not found</p>
      </div>
    );
  }

  const teamInfo = selectedTeam ? getTeamStandingInfo(selectedTeam.id) : null;
  const teamUpcoming = selectedTeam
    ? getTeamUpcomingGames(selectedTeam.id)
    : [];
  const scheduleByWeek = getScheduleByWeek();
  const completed = games.filter((g) => g.status === "completed");

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-4 space-y-6">
        {/* Header */}
        <div className="text-center pt-8">
          <h1 className="text-3xl font-bold">{league.name}</h1>
          <div className="flex items-center justify-center gap-2 mt-2">
            {league.sport && <Badge>{league.sport}</Badge>}
            {league.season_name && (
              <span className="text-muted-foreground">{league.season_name}</span>
            )}
          </div>
          {league.description && (
            <p className="text-muted-foreground mt-2 max-w-md mx-auto text-sm">
              {league.description}
            </p>
          )}
        </div>

        {/* Team Search */}
        <Card>
          <CardContent className="pt-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search for your team..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-9"
              />
              {searchQuery && (
                <button
                  onClick={clearSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Search Results */}
            {searchQuery && !selectedTeam && filteredTeams.length > 1 && (
              <div className="mt-3 space-y-1">
                {filteredTeams.map((team) => (
                  <button
                    key={team.id}
                    onClick={() => selectTeam(team)}
                    className="w-full text-left px-3 py-2 rounded hover:bg-muted text-sm"
                  >
                    {team.name}
                  </button>
                ))}
              </div>
            )}

            {searchQuery && filteredTeams.length === 0 && (
              <p className="text-sm text-muted-foreground mt-3">No teams found</p>
            )}
          </CardContent>
        </Card>

        {/* Team View */}
        {selectedTeam && teamInfo && (
          <div className="space-y-6">
            {/* Team Standing */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{selectedTeam.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearSearch}
                    className="h-8"
                  >
                    View All
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <div className="text-4xl font-bold">#{teamInfo.rank}</div>
                    <div className="text-sm text-muted-foreground">
                      of {teamInfo.total}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {teamInfo.trend === "up" && (
                      <TrendingUp className="h-5 w-5 text-green-600" />
                    )}
                    {teamInfo.trend === "down" && (
                      <TrendingDown className="h-5 w-5 text-red-600" />
                    )}
                    {teamInfo.trend === "neutral" && (
                      <Minus className="h-5 w-5 text-muted-foreground" />
                    )}
                    <div className="text-sm">
                      <div className="font-medium">
                        {teamInfo.standing.wins}W - {teamInfo.standing.losses}L
                        {teamInfo.standing.ties > 0 &&
                          ` - ${teamInfo.standing.ties}T`}
                      </div>
                      <div className="text-muted-foreground">
                        {teamInfo.standing.points_for - teamInfo.standing.points_against > 0
                          ? "+"
                          : ""}
                        {teamInfo.standing.points_for - teamInfo.standing.points_against}{" "}
                        point differential
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Team Upcoming Games */}
            {teamUpcoming.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Upcoming Games</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {teamUpcoming.map(({ weekStart, games: weekGames }, idx) => (
                    <div key={weekStart.toISOString()}>
                      <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                        Week {idx + 1} — {format(weekStart, "MMM d")}
                      </div>
                      <div className="space-y-2">
                        {weekGames.map((game) => {
                          const isHome = game.home_team_id === selectedTeam.id;
                          const opponent = isHome
                            ? teamsMap.get(game.away_team_id)
                            : teamsMap.get(game.home_team_id);
                          return (
                            <div
                              key={game.id}
                              className="flex items-center justify-between text-sm border-l-2 border-primary pl-3 py-1"
                            >
                              <div>
                                <span className="font-medium">
                                  vs {opponent?.name}
                                </span>
                              </div>
                              <div className="text-right text-xs text-muted-foreground">
                                <div>
                                  {format(new Date(game.scheduled_at), "EEE h:mm a")}
                                </div>
                                {game.venue && <div>{game.venue}</div>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Full League View (when no team selected) */}
        {!selectedTeam && (
          <>
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

            {/* Compact Schedule */}
            {scheduleByWeek.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Upcoming Schedule</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {scheduleByWeek.map(({ weekStart, games: weekGames }) => (
                    <div key={weekStart.toISOString()}>
                      <div className="text-xs font-semibold text-muted-foreground uppercase mb-2 pb-1 border-b">
                        {format(weekStart, "MMM d")} — Week{" "}
                        {weekGames[0]?.week_number || ""}
                      </div>
                      <div className="space-y-1">
                        {weekGames.map((game) => (
                          <div
                            key={game.id}
                            className="flex items-center justify-between text-sm py-1"
                          >
                            <div className="flex-1 min-w-0">
                              <span className="font-medium">
                                {teamsMap.get(game.home_team_id)?.name}
                              </span>
                              <span className="text-muted-foreground mx-1">vs</span>
                              <span className="font-medium">
                                {teamsMap.get(game.away_team_id)?.name}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground text-right whitespace-nowrap ml-2">
                              {format(new Date(game.scheduled_at), "EEE h:mm a")}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Recent Results */}
            {completed.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Recent Results</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    {completed
                      .slice(-8)
                      .reverse()
                      .map((game) => (
                        <div
                          key={game.id}
                          className="flex items-center justify-between text-sm py-1.5 border-b last:border-0"
                        >
                          <div>
                            <span>{teamsMap.get(game.home_team_id)?.name}</span>
                            <span className="font-bold mx-2">
                              {game.home_score} - {game.away_score}
                            </span>
                            <span>{teamsMap.get(game.away_team_id)?.name}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(game.scheduled_at), "MMM d")}
                          </span>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        <p className="text-center text-xs text-muted-foreground pb-8">
          Powered by LeagueNight
        </p>
      </div>
    </div>
  );
}
