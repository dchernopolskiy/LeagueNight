"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Trophy,
  Clock,
  MapPin,
  Zap,
  Plus,
  Monitor,
  Keyboard,
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
type ScoringMode = "input" | "live";

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
  const [scoringMode, setScoringMode] = useState<ScoringMode>("input");

  // Swipe tracking for live mode
  const homeTouchStart = useRef<{ y: number; time: number } | null>(null);
  const awayTouchStart = useRef<{ y: number; time: number } | null>(null);

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

    if (leagueIds.length === 0) { setLoading(false); return; }

    const windowStart = subDays(new Date(), 3);
    const windowEnd = addDays(new Date(), 7);

    const { data: games } = await supabase
      .from("games").select("*")
      .in("league_id", leagueIds)
      .gte("scheduled_at", windowStart.toISOString())
      .lte("scheduled_at", windowEnd.toISOString())
      .in("status", ["scheduled", "completed"])
      .order("scheduled_at");

    const { data: teams } = await supabase
      .from("teams").select("*").in("league_id", leagueIds);

    const teamMap = new Map((teams || []).map((t: Team) => [t.id, t]));

    const enriched: GameWithMeta[] = [];
    for (const game of (games || []) as Game[]) {
      const homeTeam = teamMap.get(game.home_team_id);
      const awayTeam = teamMap.get(game.away_team_id);
      const league = leagueMap.get(game.league_id);
      if (!homeTeam || !awayTeam || !league) continue;
      enriched.push({
        ...game, homeTeam, awayTeam, league,
        settings: (league.settings || {}) as LeagueSettings,
      });
    }

    setAllGames(enriched);
    setLoading(false);
  }

  const dayGames = useMemo(() => {
    const dateStr = format(selectedDate, "yyyy-MM-dd");
    return allGames.filter((g) => format(new Date(g.scheduled_at), "yyyy-MM-dd") === dateStr);
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
    setScoringMode("input");
    setView("scoring");
  }

  async function submitScore() {
    if (!activeGame) return;
    setSaving(true);

    const supabase = createClient();
    const gameMode = activeGame.settings.scoring_mode || "game";

    let finalHome = homeScore;
    let finalAway = awayScore;

    if (gameMode === "sets") {
      let hWins = 0, aWins = 0;
      for (const s of setScores) {
        if (s.home === 0 && s.away === 0) continue;
        if (s.home > s.away) hWins++;
        else if (s.away > s.home) aWins++;
      }
      finalHome = hWins;
      finalAway = aWins;
    }

    const { error } = await supabase.from("games").update({
      home_score: finalHome, away_score: finalAway, status: "completed",
    }).eq("id", activeGame.id);

    if (!error) {
      await supabase.rpc("recalculate_standings", { p_league_id: activeGame.league_id });
      setAllGames((prev) =>
        prev.map((g) =>
          g.id === activeGame.id
            ? { ...g, home_score: finalHome, away_score: finalAway, status: "completed" as const }
            : g
        )
      );
      setSaved(true);
      setTimeout(() => { setView("list"); setActiveGame(null); setSaved(false); }, 1200);
    }
    setSaving(false);
  }

  // Touch handlers for live scoreboard
  const handleTouchStart = useCallback((side: "home" | "away", e: React.TouchEvent) => {
    const ref = side === "home" ? homeTouchStart : awayTouchStart;
    ref.current = { y: e.touches[0].clientY, time: Date.now() };
  }, []);

  const handleTouchEnd = useCallback((side: "home" | "away", e: React.TouchEvent) => {
    const ref = side === "home" ? homeTouchStart : awayTouchStart;
    const setter = side === "home" ? setHomeScore : setAwayScore;
    if (!ref.current) return;

    const dy = e.changedTouches[0].clientY - ref.current.y;
    const dt = Date.now() - ref.current.time;

    if (Math.abs(dy) > 30 && dt < 500) {
      // Swipe down = -1
      if (dy > 0) setter((p) => Math.max(0, p - 1));
      // Swipe up = also -1 (any swipe = subtract)
      else setter((p) => Math.max(0, p - 1));
    } else {
      // Tap = +1
      setter((p) => p + 1);
    }
    ref.current = null;
  }, []);

  // --- SCORING VIEW ---
  if (view === "scoring" && activeGame) {
    const gameMode = activeGame.settings.scoring_mode || "game";
    const setsToWin = activeGame.settings.sets_to_win || 2;
    const isGameMode = gameMode === "game";

    let homeSetWins = 0, awaySetWins = 0;
    if (!isGameMode) {
      for (const s of setScores) {
        if (s.home > s.away) homeSetWins++;
        else if (s.away > s.home) awaySetWins++;
      }
    }

    // ==========================================
    // LIVE SCOREBOARD — full-screen tap/swipe
    // ==========================================
    if (scoringMode === "live") {
      // For sets mode in live, we track the current set's points
      const liveHome = isGameMode ? homeScore : (setScores[currentSet]?.home || 0);
      const liveAway = isGameMode ? awayScore : (setScores[currentSet]?.away || 0);

      const handleLiveTouchEnd = (side: "home" | "away", e: React.TouchEvent) => {
        const ref = side === "home" ? homeTouchStart : awayTouchStart;
        if (!ref.current) return;

        const dy = e.changedTouches[0].clientY - ref.current.y;
        const dt = Date.now() - ref.current.time;
        const isSwipe = Math.abs(dy) > 30 && dt < 500;

        if (isGameMode) {
          const setter = side === "home" ? setHomeScore : setAwayScore;
          if (isSwipe) setter((p) => Math.max(0, p - 1));
          else setter((p) => p + 1);
        } else {
          // Sets mode — modify current set
          const next = [...setScores];
          const cur = next[currentSet];
          if (side === "home") {
            next[currentSet] = { ...cur, home: isSwipe ? Math.max(0, cur.home - 1) : cur.home + 1 };
          } else {
            next[currentSet] = { ...cur, away: isSwipe ? Math.max(0, cur.away - 1) : cur.away + 1 };
          }
          setSetScores(next);
        }
        ref.current = null;
      };

      return (
        <div className="fixed inset-0 z-50 bg-black flex flex-col select-none" style={{ touchAction: "none" }}>
          {/* Minimal top bar */}
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-2 py-1">
            <Button
              variant="ghost"
              size="sm"
              className="text-white/60 hover:text-white hover:bg-white/10 h-8"
              onClick={() => setScoringMode("input")}
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> Exit
            </Button>
            <span className="text-white/40 text-[10px]">
              {activeGame.league.name}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-white/60 hover:text-white hover:bg-white/10 h-8"
              onClick={() => {
                if (isGameMode) { setHomeScore(0); setAwayScore(0); }
                else { setSetScores((prev) => prev.map(() => ({ home: 0, away: 0 }))); setCurrentSet(0); }
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Two-panel scoreboard */}
          <div className="flex-1 flex">
            {/* Home side — BLUE */}
            <div
              className="flex-1 bg-blue-600 flex flex-col items-center justify-center relative cursor-pointer"
              onTouchStart={(e) => { homeTouchStart.current = { y: e.touches[0].clientY, time: Date.now() }; }}
              onTouchEnd={(e) => handleLiveTouchEnd("home", e)}
              onClick={() => {
                // Desktop fallback: click = +1
                if (isGameMode) setHomeScore((p) => p + 1);
                else {
                  const next = [...setScores];
                  next[currentSet] = { ...next[currentSet], home: next[currentSet].home + 1 };
                  setSetScores(next);
                }
              }}
              onContextMenu={(e) => {
                // Right-click = -1 on desktop
                e.preventDefault();
                if (isGameMode) setHomeScore((p) => Math.max(0, p - 1));
                else {
                  const next = [...setScores];
                  next[currentSet] = { ...next[currentSet], home: Math.max(0, next[currentSet].home - 1) };
                  setSetScores(next);
                }
              }}
            >
              <span className="text-white font-bold leading-none" style={{ fontSize: "min(35vw, 35vh)" }}>
                {liveHome}
              </span>
              <div className="absolute bottom-4 left-0 right-0 text-center">
                <span className="bg-blue-800/80 text-white px-4 py-1.5 rounded text-sm font-medium inline-block max-w-[90%] truncate">
                  {activeGame.homeTeam.name}
                </span>
              </div>
            </div>

            {/* Away side — RED */}
            <div
              className="flex-1 bg-red-600 flex flex-col items-center justify-center relative cursor-pointer"
              onTouchStart={(e) => { awayTouchStart.current = { y: e.touches[0].clientY, time: Date.now() }; }}
              onTouchEnd={(e) => handleLiveTouchEnd("away", e)}
              onClick={() => {
                if (isGameMode) setAwayScore((p) => p + 1);
                else {
                  const next = [...setScores];
                  next[currentSet] = { ...next[currentSet], away: next[currentSet].away + 1 };
                  setSetScores(next);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (isGameMode) setAwayScore((p) => Math.max(0, p - 1));
                else {
                  const next = [...setScores];
                  next[currentSet] = { ...next[currentSet], away: Math.max(0, next[currentSet].away - 1) };
                  setSetScores(next);
                }
              }}
            >
              <span className="text-white font-bold leading-none" style={{ fontSize: "min(35vw, 35vh)" }}>
                {liveAway}
              </span>
              <div className="absolute bottom-4 left-0 right-0 text-center">
                <span className="bg-red-800/80 text-white px-4 py-1.5 rounded text-sm font-medium inline-block max-w-[90%] truncate">
                  {activeGame.awayTeam.name}
                </span>
              </div>
            </div>
          </div>

          {/* Sets bar (volleyball/sets mode only) */}
          {!isGameMode && (
            <div className="bg-black flex items-center justify-center gap-2 py-2">
              {setScores.map((s, i) => (
                <button
                  key={i}
                  onClick={(e) => { e.stopPropagation(); setCurrentSet(i); }}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    i === currentSet
                      ? "bg-white text-black"
                      : "bg-white/20 text-white/70 hover:bg-white/30"
                  }`}
                >
                  S{i + 1}{s.home > 0 || s.away > 0 ? `: ${s.home}-${s.away}` : ""}
                </button>
              ))}
              <span className="text-white/50 text-xs ml-2">
                Sets: {homeSetWins}-{awaySetWins}
              </span>
            </div>
          )}

          {/* Bottom submit bar */}
          <div className="bg-black px-4 py-2 flex gap-2">
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              onClick={submitScore}
              disabled={saving || saved}
            >
              {saved ? <><Check className="h-4 w-4 mr-2" /> Saved!</> : saving ? "Saving..." : <><Check className="h-4 w-4 mr-2" /> Submit Final</>}
            </Button>
          </div>
        </div>
      );
    }

    // ==========================================
    // INPUT MODE — default, type final scores
    // ==========================================
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
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1"
            onClick={() => setScoringMode("live")}
            title="Live Scoreboard"
          >
            <Monitor className="h-3.5 w-3.5" /> Live
          </Button>
        </div>

        {/* Main input area */}
        <div className="flex-1 flex flex-col justify-center px-6 gap-8">
          {/* Game mode: direct number input */}
          {isGameMode && (
            <div className="space-y-6">
              {/* Home team */}
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{activeGame.homeTeam.name}</p>
                  <p className="text-[10px] text-muted-foreground">Home</p>
                </div>
                <Input
                  type="number"
                  min={0}
                  value={homeScore}
                  onChange={(e) => setHomeScore(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-24 text-center text-3xl font-bold h-16 tabular-nums"
                />
              </div>

              <div className="text-center text-muted-foreground text-sm">vs</div>

              {/* Away team */}
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{activeGame.awayTeam.name}</p>
                  <p className="text-[10px] text-muted-foreground">Away</p>
                </div>
                <Input
                  type="number"
                  min={0}
                  value={awayScore}
                  onChange={(e) => setAwayScore(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-24 text-center text-3xl font-bold h-16 tabular-nums"
                />
              </div>
            </div>
          )}

          {/* Sets mode: input per set */}
          {!isGameMode && (
            <div className="space-y-6">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  {activeGame.homeTeam.name} vs {activeGame.awayTeam.name}
                </p>
                <p className="text-2xl font-bold mt-1">
                  Sets: {homeSetWins} - {awaySetWins}
                </p>
              </div>

              <div className="space-y-3">
                {setScores.map((s, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-sm font-medium w-12 text-muted-foreground">Set {i + 1}</span>
                    <Input
                      type="number"
                      min={0}
                      value={s.home || ""}
                      placeholder="0"
                      onChange={(e) => {
                        const next = [...setScores];
                        next[i] = { ...next[i], home: Math.max(0, parseInt(e.target.value) || 0) };
                        setSetScores(next);
                      }}
                      className="w-20 text-center text-lg font-bold h-12 tabular-nums"
                    />
                    <span className="text-muted-foreground">-</span>
                    <Input
                      type="number"
                      min={0}
                      value={s.away || ""}
                      placeholder="0"
                      onChange={(e) => {
                        const next = [...setScores];
                        next[i] = { ...next[i], away: Math.max(0, parseInt(e.target.value) || 0) };
                        setSetScores(next);
                      }}
                      className="w-20 text-center text-lg font-bold h-12 tabular-nums"
                    />
                    {s.home > 0 || s.away > 0 ? (
                      <Badge variant={s.home > s.away ? "default" : "secondary"} className="text-[10px] w-12 justify-center">
                        {s.home > s.away ? "H" : s.away > s.home ? "A" : "Tie"}
                      </Badge>
                    ) : (
                      <div className="w-12" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bottom action bar */}
        <div className="p-4 border-t bg-card">
          <Button
            className="w-full h-12"
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
        Tap a game to enter scores.
      </p>

      {/* Date navigator */}
      <div className="flex items-center justify-between bg-card rounded-lg border p-2">
        <Button variant="ghost" size="sm" className="h-9 w-9 p-0"
          onClick={() => setSelectedDate((d) => subDays(d, 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center">
          <p className="font-medium text-sm">{dateLabel(selectedDate)}</p>
          <p className="text-xs text-muted-foreground">{format(selectedDate, "EEEE, MMMM d")}</p>
        </div>
        <Button variant="ghost" size="sm" className="h-9 w-9 p-0"
          onClick={() => setSelectedDate((d) => addDays(d, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {!isToday(selectedDate) && (
        <Button variant="outline" size="sm" className="w-full"
          onClick={() => setSelectedDate(new Date())}>
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
            <button key={game.id} onClick={() => openScoring(game)} className="w-full text-left">
              <Card className="hover:ring-2 hover:ring-primary/50 transition-all active:scale-[0.98]">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-[10px] shrink-0">{game.league.sport}</Badge>
                        <span className="text-xs text-muted-foreground truncate">{game.league.name}</span>
                      </div>
                      <p className="font-medium text-sm">
                        {game.homeTeam.name}
                        <span className="text-muted-foreground mx-1.5">vs</span>
                        {game.awayTeam.name}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />{format(new Date(game.scheduled_at), "h:mm a")}
                        </span>
                        {game.venue && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />{game.venue}
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
            <button key={game.id} onClick={() => openScoring(game)} className="w-full text-left">
              <Card className="opacity-80 hover:opacity-100 transition-all active:scale-[0.98]">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="secondary" className="text-[10px] shrink-0">{game.league.sport}</Badge>
                        <span className="text-xs text-muted-foreground truncate">{game.league.name}</span>
                      </div>
                      <p className="text-sm">
                        <span className={game.home_score! > game.away_score! ? "font-bold" : ""}>{game.homeTeam.name}</span>
                        <span className="mx-1.5 font-bold tabular-nums">{game.home_score} - {game.away_score}</span>
                        <span className={game.away_score! > game.home_score! ? "font-bold" : ""}>{game.awayTeam.name}</span>
                      </p>
                    </div>
                    <div className="ml-3 shrink-0 text-xs text-muted-foreground">tap to edit</div>
                  </div>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}

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
