"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  RotateCcw,
  Trophy,
  Clock,
  MapPin,
  Zap,
} from "lucide-react";
import { format, isToday, isTomorrow, isYesterday, addDays, subDays } from "date-fns";
import type { Game, Team, League, LeagueSettings } from "@/lib/types";

interface GameWithMeta extends Game {
  homeTeam: Team;
  awayTeam: Team;
  league: League;
  settings: LeagueSettings;
}

type ViewState = "list" | "scoring";

export default function ScoreboardPage() {
  const [allGames, setAllGames] = useState<GameWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [profileId, setProfileId] = useState<string | null>(null);

  // Scoring state
  const [view, setView] = useState<ViewState>("list");
  const [activeGame, setActiveGame] = useState<GameWithMeta | null>(null);
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [setScores, setSetScores] = useState<{ home: number; away: number }[]>([]);
  const [currentSet, setCurrentSet] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadGames();
  }, []);

  async function loadGames() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("auth_id", user.id)
      .single();
    if (!profile) return;
    setProfileId(profile.id);

    // Get leagues this user organizes or co-organizes
    const [ownedRes, staffRes] = await Promise.all([
      supabase.from("leagues").select("*").eq("organizer_id", profile.id),
      supabase.from("league_staff").select("*, leagues(*)").eq("profile_id", profile.id),
    ]);

    const leagues: League[] = [
      ...((ownedRes.data || []) as League[]),
      ...((staffRes.data || []).map((s: any) => s.leagues).filter(Boolean) as League[]),
    ];
    const leagueMap = new Map(leagues.map((l) => [l.id, l]));
    const leagueIds = [...leagueMap.keys()];

    if (leagueIds.length === 0) {
      setLoading(false);
      return;
    }

    // Get games for a wide window (past 3 days to future 7 days)
    const windowStart = subDays(new Date(), 3);
    const windowEnd = addDays(new Date(), 7);

    const { data: games } = await supabase
      .from("games")
      .select("*")
      .in("league_id", leagueIds)
      .gte("scheduled_at", windowStart.toISOString())
      .lte("scheduled_at", windowEnd.toISOString())
      .in("status", ["scheduled", "completed"])
      .order("scheduled_at");

    // Get all teams for these leagues
    const { data: teams } = await supabase
      .from("teams")
      .select("*")
      .in("league_id", leagueIds);

    const teamMap = new Map((teams || []).map((t: Team) => [t.id, t]));

    const enriched: GameWithMeta[] = [];
    for (const game of (games || []) as Game[]) {
      const homeTeam = teamMap.get(game.home_team_id);
      const awayTeam = teamMap.get(game.away_team_id);
      const league = leagueMap.get(game.league_id);
      if (!homeTeam || !awayTeam || !league) continue;
      enriched.push({
        ...game,
        homeTeam,
        awayTeam,
        league,
        settings: (league.settings || {}) as LeagueSettings,
      });
    }

    setAllGames(enriched);
    setLoading(false);
  }

  // Filter games for selected date
  const dayGames = useMemo(() => {
    const dateStr = format(selectedDate, "yyyy-MM-dd");
    return allGames.filter((g) => {
      const gameDate = format(new Date(g.scheduled_at), "yyyy-MM-dd");
      return gameDate === dateStr;
    });
  }, [allGames, selectedDate]);

  const scheduledGames = dayGames.filter((g) => g.status === "scheduled");
  const completedGames = dayGames.filter((g) => g.status === "completed");

  function dateLabel(date: Date) {
    if (isToday(date)) return "Today";
    if (isTomorrow(date)) return "Tomorrow";
    if (isYesterday(date)) return "Yesterday";
    return format(date, "EEE, MMM d");
  }

  function openScoring(game: GameWithMeta) {
    setActiveGame(game);
    const mode = game.settings.scoring_mode || "game";

    if (mode === "sets") {
      const setsToWin = game.settings.sets_to_win || 2;
      const maxSets = setsToWin * 2 - 1;
      setSetScores(Array.from({ length: maxSets }, () => ({ home: 0, away: 0 })));
      setCurrentSet(0);
    }

    if (game.status === "completed") {
      setHomeScore(game.home_score || 0);
      setAwayScore(game.away_score || 0);
    } else {
      setHomeScore(0);
      setAwayScore(0);
    }

    setSaved(false);
    setView("scoring");
  }

  async function submitScore() {
    if (!activeGame) return;
    setSaving(true);

    const supabase = createClient();
    const mode = activeGame.settings.scoring_mode || "game";

    let finalHome = homeScore;
    let finalAway = awayScore;

    if (mode === "sets") {
      // Count set wins
      let hWins = 0;
      let aWins = 0;
      for (const s of setScores) {
        if (s.home === 0 && s.away === 0) continue;
        if (s.home > s.away) hWins++;
        else if (s.away > s.home) aWins++;
      }
      finalHome = hWins;
      finalAway = aWins;
    }

    const { error } = await supabase
      .from("games")
      .update({
        home_score: finalHome,
        away_score: finalAway,
        status: "completed",
      })
      .eq("id", activeGame.id);

    if (!error) {
      await supabase.rpc("recalculate_standings", {
        p_league_id: activeGame.league_id,
      });

      // Update local state
      setAllGames((prev) =>
        prev.map((g) =>
          g.id === activeGame.id
            ? { ...g, home_score: finalHome, away_score: finalAway, status: "completed" as const }
            : g
        )
      );
      setSaved(true);
      setTimeout(() => {
        setView("list");
        setActiveGame(null);
        setSaved(false);
      }, 1200);
    }

    setSaving(false);
  }

  // --- SCORING VIEW (full-screen mobile-optimized) ---
  if (view === "scoring" && activeGame) {
    const mode = activeGame.settings.scoring_mode || "game";
    const setsToWin = activeGame.settings.sets_to_win || 2;
    const isGameMode = mode === "game";

    // For sets mode, check if match is decided
    let homeSetWins = 0;
    let awaySetWins = 0;
    if (!isGameMode) {
      for (const s of setScores) {
        if (s.home > s.away) homeSetWins++;
        else if (s.away > s.home) awaySetWins++;
      }
    }

    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between p-3 border-b bg-card">
          <Button variant="ghost" size="sm" onClick={() => { setView("list"); setActiveGame(null); }}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">{activeGame.league.name}</p>
            <p className="text-[10px] text-muted-foreground">
              {format(new Date(activeGame.scheduled_at), "h:mm a")}
              {activeGame.venue && ` \u00B7 ${activeGame.venue}`}
            </p>
          </div>
          <div className="w-16" />
        </div>

        {/* Main scoring area */}
        <div className="flex-1 flex flex-col justify-center px-4 gap-6">

          {/* Game mode: simple +/- counters */}
          {isGameMode && (
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
              {/* Home team */}
              <div className="text-center">
                <p className="text-sm font-medium truncate mb-3">{activeGame.homeTeam.name}</p>
                <div className="flex flex-col items-center gap-2">
                  <Button
                    variant="outline"
                    className="h-14 w-14 rounded-full text-2xl"
                    onClick={() => setHomeScore((p) => p + 1)}
                  >
                    <Plus className="h-6 w-6" />
                  </Button>
                  <span className="text-6xl font-bold tabular-nums leading-none py-3">{homeScore}</span>
                  <Button
                    variant="outline"
                    className="h-14 w-14 rounded-full text-2xl"
                    onClick={() => setHomeScore((p) => Math.max(0, p - 1))}
                  >
                    <Minus className="h-6 w-6" />
                  </Button>
                </div>
              </div>

              {/* Divider */}
              <div className="flex flex-col items-center gap-2">
                <span className="text-2xl font-light text-muted-foreground">vs</span>
              </div>

              {/* Away team */}
              <div className="text-center">
                <p className="text-sm font-medium truncate mb-3">{activeGame.awayTeam.name}</p>
                <div className="flex flex-col items-center gap-2">
                  <Button
                    variant="outline"
                    className="h-14 w-14 rounded-full text-2xl"
                    onClick={() => setAwayScore((p) => p + 1)}
                  >
                    <Plus className="h-6 w-6" />
                  </Button>
                  <span className="text-6xl font-bold tabular-nums leading-none py-3">{awayScore}</span>
                  <Button
                    variant="outline"
                    className="h-14 w-14 rounded-full text-2xl"
                    onClick={() => setAwayScore((p) => Math.max(0, p - 1))}
                  >
                    <Minus className="h-6 w-6" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Sets mode: set-by-set entry */}
          {!isGameMode && (
            <div className="space-y-4">
              {/* Set wins summary */}
              <div className="grid grid-cols-[1fr_auto_1fr] items-center text-center gap-4">
                <div>
                  <p className="text-sm font-medium truncate">{activeGame.homeTeam.name}</p>
                  <p className="text-4xl font-bold mt-1">{homeSetWins}</p>
                </div>
                <span className="text-lg text-muted-foreground">sets</span>
                <div>
                  <p className="text-sm font-medium truncate">{activeGame.awayTeam.name}</p>
                  <p className="text-4xl font-bold mt-1">{awaySetWins}</p>
                </div>
              </div>

              {/* Set tabs */}
              <div className="flex justify-center gap-2">
                {setScores.map((_, i) => (
                  <Button
                    key={i}
                    variant={currentSet === i ? "default" : "outline"}
                    size="sm"
                    className="min-w-[3rem]"
                    onClick={() => setCurrentSet(i)}
                  >
                    Set {i + 1}
                  </Button>
                ))}
              </div>

              {/* Current set scoring */}
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                <div className="flex flex-col items-center gap-2">
                  <Button
                    variant="outline"
                    className="h-12 w-12 rounded-full"
                    onClick={() => {
                      const next = [...setScores];
                      next[currentSet] = { ...next[currentSet], home: next[currentSet].home + 1 };
                      setSetScores(next);
                    }}
                  >
                    <Plus className="h-5 w-5" />
                  </Button>
                  <span className="text-5xl font-bold tabular-nums py-2">
                    {setScores[currentSet]?.home || 0}
                  </span>
                  <Button
                    variant="outline"
                    className="h-12 w-12 rounded-full"
                    onClick={() => {
                      const next = [...setScores];
                      next[currentSet] = { ...next[currentSet], home: Math.max(0, next[currentSet].home - 1) };
                      setSetScores(next);
                    }}
                  >
                    <Minus className="h-5 w-5" />
                  </Button>
                </div>

                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Set {currentSet + 1}</p>
                </div>

                <div className="flex flex-col items-center gap-2">
                  <Button
                    variant="outline"
                    className="h-12 w-12 rounded-full"
                    onClick={() => {
                      const next = [...setScores];
                      next[currentSet] = { ...next[currentSet], away: next[currentSet].away + 1 };
                      setSetScores(next);
                    }}
                  >
                    <Plus className="h-5 w-5" />
                  </Button>
                  <span className="text-5xl font-bold tabular-nums py-2">
                    {setScores[currentSet]?.away || 0}
                  </span>
                  <Button
                    variant="outline"
                    className="h-12 w-12 rounded-full"
                    onClick={() => {
                      const next = [...setScores];
                      next[currentSet] = { ...next[currentSet], away: Math.max(0, next[currentSet].away - 1) };
                      setSetScores(next);
                    }}
                  >
                    <Minus className="h-5 w-5" />
                  </Button>
                </div>
              </div>

              {/* Set scores summary */}
              <div className="flex justify-center gap-3 text-xs text-muted-foreground">
                {setScores.map((s, i) => (
                  <span key={i} className={`${i === currentSet ? "text-foreground font-medium" : ""}`}>
                    S{i + 1}: {s.home}-{s.away}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Quick score buttons for common volleyball/pickleball scores */}
          {isGameMode && activeGame.league.sport === "Pickleball" && (
            <div className="text-center space-y-2">
              <p className="text-xs text-muted-foreground">Quick set</p>
              <div className="flex justify-center gap-2 flex-wrap">
                {[11, 15, 21].map((score) => (
                  <Button
                    key={score}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      setHomeScore(score);
                      setAwayScore(0);
                    }}
                  >
                    {score}-0 Home
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bottom action bar */}
        <div className="p-4 border-t bg-card space-y-2">
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setHomeScore(0);
                setAwayScore(0);
                setSetScores((prev) => prev.map(() => ({ home: 0, away: 0 })));
                setCurrentSet(0);
              }}
            >
              <RotateCcw className="h-4 w-4 mr-2" /> Reset
            </Button>
            <Button
              className="flex-[2]"
              onClick={submitScore}
              disabled={saving || saved}
            >
              {saved ? (
                <><Check className="h-4 w-4 mr-2" /> Saved!</>
              ) : saving ? (
                "Saving..."
              ) : (
                <><Check className="h-4 w-4 mr-2" /> Submit Score</>
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // --- LIST VIEW ---
  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Zap className="h-5 w-5" /> Scoreboard
        </h1>
        <p className="text-muted-foreground">Loading games...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <h1 className="text-xl font-bold flex items-center gap-2">
        <Zap className="h-5 w-5" /> Scoreboard
      </h1>
      <p className="text-sm text-muted-foreground">
        Tap a game to enter scores. Optimized for courtside use.
      </p>

      {/* Date navigator */}
      <div className="flex items-center justify-between bg-card rounded-lg border p-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 p-0"
          onClick={() => setSelectedDate((d) => subDays(d, 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center">
          <p className="font-medium text-sm">{dateLabel(selectedDate)}</p>
          <p className="text-xs text-muted-foreground">
            {format(selectedDate, "EEEE, MMMM d")}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 p-0"
          onClick={() => setSelectedDate((d) => addDays(d, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Today button */}
      {!isToday(selectedDate) && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setSelectedDate(new Date())}
        >
          Jump to Today
        </Button>
      )}

      {/* Games needing scores */}
      {scheduledGames.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> Needs Score ({scheduledGames.length})
          </h2>
          {scheduledGames.map((game) => (
            <button
              key={game.id}
              onClick={() => openScoring(game)}
              className="w-full text-left"
            >
              <Card className="hover:ring-2 hover:ring-primary/50 transition-all active:scale-[0.98]">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {game.league.sport}
                        </Badge>
                        <span className="text-xs text-muted-foreground truncate">
                          {game.league.name}
                        </span>
                      </div>
                      <p className="font-medium text-sm">
                        {game.homeTeam.name}
                        <span className="text-muted-foreground mx-1.5">vs</span>
                        {game.awayTeam.name}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(new Date(game.scheduled_at), "h:mm a")}
                        </span>
                        {game.venue && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {game.venue}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="ml-3 shrink-0">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <Plus className="h-5 w-5 text-primary" />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}

      {/* Completed games */}
      {completedGames.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold flex items-center gap-1.5 text-muted-foreground">
            <Trophy className="h-3.5 w-3.5" /> Completed ({completedGames.length})
          </h2>
          {completedGames.map((game) => (
            <button
              key={game.id}
              onClick={() => openScoring(game)}
              className="w-full text-left"
            >
              <Card className="opacity-80 hover:opacity-100 transition-all active:scale-[0.98]">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          {game.league.sport}
                        </Badge>
                        <span className="text-xs text-muted-foreground truncate">
                          {game.league.name}
                        </span>
                      </div>
                      <p className="text-sm">
                        <span className={game.home_score! > game.away_score! ? "font-bold" : ""}>
                          {game.homeTeam.name}
                        </span>
                        <span className="mx-1.5 font-bold tabular-nums">
                          {game.home_score} - {game.away_score}
                        </span>
                        <span className={game.away_score! > game.home_score! ? "font-bold" : ""}>
                          {game.awayTeam.name}
                        </span>
                      </p>
                    </div>
                    <div className="ml-3 shrink-0 text-xs text-muted-foreground">
                      tap to edit
                    </div>
                  </div>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {dayGames.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No games on {dateLabel(selectedDate).toLowerCase()}.</p>
            <p className="text-xs text-muted-foreground mt-1">Swipe through dates to find games.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
