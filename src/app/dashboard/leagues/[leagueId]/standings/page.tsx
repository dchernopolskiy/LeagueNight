"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { Download, Pencil } from "lucide-react";
import { generateStandingsPdf } from "@/lib/export/standings-pdf";
import type { Game, Team, Standing, League, LeagueSettings } from "@/lib/types";

export default function StandingsPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const searchParams = useSearchParams();
  const activeDivisionId = searchParams.get("division");
  const [games, setGames] = useState<Game[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [league, setLeague] = useState<League | null>(null);
  const [loading, setLoading] = useState(true);

  // Score entry state
  const [editingGame, setEditingGame] = useState<string | null>(null);
  const [homeScore, setHomeScore] = useState("");
  const [awayScore, setAwayScore] = useState("");

  // Sets scoring state
  const [setScores, setSetScores] = useState<{ home: string; away: string }[]>([]);

  useEffect(() => {
    loadData();
  }, [leagueId]);

  async function loadData() {
    const supabase = createClient();
    const [gamesRes, teamsRes, standingsRes, leagueRes] = await Promise.all([
      supabase
        .from("games")
        .select("*")
        .eq("league_id", leagueId)
        .in("status", ["scheduled", "completed"])
        .order("scheduled_at"),
      supabase.from("teams").select("*").eq("league_id", leagueId),
      supabase
        .from("standings")
        .select("*")
        .eq("league_id", leagueId)
        .order("rank"),
      supabase.from("leagues").select("*").eq("id", leagueId).single(),
    ]);
    setGames((gamesRes.data || []) as Game[]);
    setTeams((teamsRes.data || []) as Team[]);
    setStandings((standingsRes.data || []) as Standing[]);
    if (leagueRes.data) setLeague(leagueRes.data as League);
    setLoading(false);
  }

  const settings = (league?.settings || {}) as LeagueSettings;
  const scoringMode = settings.scoring_mode || "game";
  const setsToWin = settings.sets_to_win || 2;
  const maxSets = setsToWin * 2 - 1;
  const scoreLabel = scoringMode === "sets" ? "Sets" : "Score";

  function startEditing(game: Game) {
    setEditingGame(game.id);
    if (scoringMode === "sets") {
      // Initialize set scores - pre-fill empty
      setSetScores(
        Array.from({ length: maxSets }, () => ({ home: "", away: "" }))
      );
      // Load existing scores if available
      setHomeScore(game.home_score?.toString() || "");
      setAwayScore(game.away_score?.toString() || "");
    } else {
      setHomeScore(game.home_score?.toString() || "");
      setAwayScore(game.away_score?.toString() || "");
    }
  }

  function startEditingCompleted(game: Game) {
    setEditingGame(game.id);
    if (scoringMode === "sets") {
      // For completed games in sets mode, we only have the final sets-won totals.
      // Initialize empty set scores so the organizer can re-enter.
      setSetScores(
        Array.from({ length: maxSets }, () => ({ home: "", away: "" }))
      );
      setHomeScore(game.home_score?.toString() || "");
      setAwayScore(game.away_score?.toString() || "");
    } else {
      setHomeScore(game.home_score?.toString() || "");
      setAwayScore(game.away_score?.toString() || "");
    }
  }

  async function submitScore(gameId: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("games")
      .update({
        home_score: parseInt(homeScore),
        away_score: parseInt(awayScore),
        status: "completed",
      })
      .eq("id", gameId);

    if (!error) {
      await supabase.rpc("recalculate_standings", {
        p_league_id: leagueId,
      });
      setEditingGame(null);
      setHomeScore("");
      setAwayScore("");
      setSetScores([]);
      await loadData();
    }
  }

  function submitSetsScore(gameId: string) {
    let homeWins = 0;
    let awayWins = 0;
    for (const set of setScores) {
      if (!set.home || !set.away) continue;
      const h = parseInt(set.home);
      const a = parseInt(set.away);
      if (h > a) homeWins++;
      else if (a > h) awayWins++;
    }

    // Validate that someone has won enough sets
    if (homeWins < setsToWin && awayWins < setsToWin) {
      alert(
        `Not enough sets completed. A team needs ${setsToWin} set wins to win the match.`
      );
      return;
    }

    setHomeScore(homeWins.toString());
    setAwayScore(awayWins.toString());

    // Directly save using the computed values
    (async () => {
      const supabase = createClient();
      const { error } = await supabase
        .from("games")
        .update({
          home_score: homeWins,
          away_score: awayWins,
          status: "completed",
        })
        .eq("id", gameId);

      if (!error) {
        await supabase.rpc("recalculate_standings", {
          p_league_id: leagueId,
        });
        setEditingGame(null);
        setHomeScore("");
        setAwayScore("");
        setSetScores([]);
        await loadData();
      }
    })();
  }

  function exportStandingsPdf() {
    if (!league) return;
    const doc = generateStandingsPdf({
      leagueName: league.name,
      seasonName: league.season_name ?? undefined,
      standings,
      teams,
    });
    doc.save(`${league.name} - Standings.pdf`);
  }

  const teamsMap = new Map(teams.map((t) => [t.id, t]));

  const divisionTeamIds = activeDivisionId
    ? new Set(teams.filter((t) => t.division_id === activeDivisionId).map((t) => t.id))
    : null;

  const filteredStandings = divisionTeamIds
    ? standings.filter((s) => divisionTeamIds.has(s.team_id))
    : standings;

  const filteredGames = divisionTeamIds
    ? games.filter(
        (g) => divisionTeamIds.has(g.home_team_id) || divisionTeamIds.has(g.away_team_id)
      )
    : games;

  const scheduledGames = filteredGames.filter((g) => g.status === "scheduled");
  const completedGames = filteredGames.filter((g) => g.status === "completed");

  if (loading) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  return (
    <div className="space-y-6">
      {/* Standings table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Standings</CardTitle>
            {filteredStandings.length > 0 && (
              <Button variant="outline" size="sm" onClick={exportStandingsPdf}>
                <Download className="h-4 w-4 mr-1" />
                Export PDF
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {filteredStandings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No results yet. Enter scores below to see standings.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-center">W</TableHead>
                  <TableHead className="text-center">L</TableHead>
                  <TableHead className="text-center">T</TableHead>
                  <TableHead className="text-center">PF</TableHead>
                  <TableHead className="text-center">PA</TableHead>
                  <TableHead className="text-center">PD</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStandings.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.rank}</TableCell>
                    <TableCell>{teamsMap.get(s.team_id)?.name}</TableCell>
                    <TableCell className="text-center">{s.wins}</TableCell>
                    <TableCell className="text-center">{s.losses}</TableCell>
                    <TableCell className="text-center">{s.ties}</TableCell>
                    <TableCell className="text-center">{s.points_for}</TableCell>
                    <TableCell className="text-center">
                      {s.points_against}
                    </TableCell>
                    <TableCell className="text-center">
                      {s.points_for - s.points_against > 0 ? "+" : ""}
                      {s.points_for - s.points_against}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Enter scores */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Enter {scoreLabel}s</CardTitle>
            {scoringMode === "sets" && (
              <Badge variant="secondary">
                Best of {maxSets}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {scheduledGames.length === 0 && completedGames.length === 0 ? (
            <p className="text-sm text-muted-foreground">No games to score.</p>
          ) : (
            <div className="space-y-3">
              {[...scheduledGames, ...completedGames.slice(-5).reverse()].map(
                (game) => {
                  const home = teamsMap.get(game.home_team_id);
                  const away = teamsMap.get(game.away_team_id);
                  const isEditing = editingGame === game.id;

                  return (
                    <div
                      key={game.id}
                      className="border rounded-lg p-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <p className="text-sm font-medium">
                            {home?.name} vs {away?.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(
                              new Date(game.scheduled_at),
                              "EEE, MMM d"
                            )}{" "}
                            &middot; Week {game.week_number}
                          </p>
                        </div>

                        {game.status === "completed" && !isEditing ? (
                          <div className="flex items-center gap-1.5">
                            <Badge>
                              {game.home_score} - {game.away_score}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-muted-foreground"
                              onClick={() => startEditingCompleted(game)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : isEditing && scoringMode !== "sets" ? (
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={0}
                              value={homeScore}
                              onChange={(e) => setHomeScore(e.target.value)}
                              className="w-16 text-center"
                              placeholder="H"
                            />
                            <span className="text-muted-foreground">-</span>
                            <Input
                              type="number"
                              min={0}
                              value={awayScore}
                              onChange={(e) => setAwayScore(e.target.value)}
                              className="w-16 text-center"
                              placeholder="A"
                            />
                            <Button
                              size="sm"
                              onClick={() => submitScore(game.id)}
                              disabled={!homeScore || !awayScore}
                            >
                              Save
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingGame(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : !isEditing ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => startEditing(game)}
                          >
                            Score
                          </Button>
                        ) : null}
                      </div>

                      {/* Sets scoring UI */}
                      {isEditing && scoringMode === "sets" && (
                        <div className="mt-3 space-y-2">
                          <div className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-2 gap-y-1.5 items-center">
                            <span className="text-xs font-medium" />
                            <span className="text-xs font-medium text-center">
                              {home?.name}
                            </span>
                            <span />
                            <span className="text-xs font-medium text-center">
                              {away?.name}
                            </span>
                            {setScores.map((set, i) => (
                              <>
                                <span key={`label-${i}`} className="text-xs w-12">
                                  Set {i + 1}
                                </span>
                                <Input
                                  key={`home-${i}`}
                                  type="number"
                                  min={0}
                                  value={set.home}
                                  onChange={(e) => {
                                    const updated = [...setScores];
                                    updated[i] = {
                                      ...updated[i],
                                      home: e.target.value,
                                    };
                                    setSetScores(updated);
                                  }}
                                  className="w-14 text-center"
                                />
                                <span key={`sep-${i}`} className="text-center text-muted-foreground">
                                  -
                                </span>
                                <Input
                                  key={`away-${i}`}
                                  type="number"
                                  min={0}
                                  value={set.away}
                                  onChange={(e) => {
                                    const updated = [...setScores];
                                    updated[i] = {
                                      ...updated[i],
                                      away: e.target.value,
                                    };
                                    setSetScores(updated);
                                  }}
                                  className="w-14 text-center"
                                />
                              </>
                            ))}
                          </div>
                          <div className="flex justify-end gap-2 pt-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingGame(null);
                                setSetScores([]);
                              }}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => submitSetsScore(game.id)}
                            >
                              Submit
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
