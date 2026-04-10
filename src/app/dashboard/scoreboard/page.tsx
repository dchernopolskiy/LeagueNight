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
  Minus,
  Monitor,
  Maximize,
  Minimize,
  X,
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

function useIsTouchDevice() {
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    setIsTouch("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }, []);
  return isTouch;
}

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
  const [isFullscreen, setIsFullscreen] = useState(false);

  const isTouch = useIsTouchDevice();
  const liveContainerRef = useRef<HTMLDivElement>(null);

  // Swipe tracking for live mode
  const homeTouchStart = useRef<{ y: number; time: number } | null>(null);
  const awayTouchStart = useRef<{ y: number; time: number } | null>(null);
  // Track if touch just handled the event (prevent onClick double-fire)
  const touchHandled = useRef(false);

  useEffect(() => {
    loadGames();
  }, []);

  // Listen for fullscreen changes
  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
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
      setTimeout(() => {
        setView("list");
        setActiveGame(null);
        setSaved(false);
        // Exit fullscreen if active
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
      }, 1200);
    }
    setSaving(false);
  }

  function toggleFullscreen() {
    if (!liveContainerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      liveContainerRef.current.requestFullscreen().catch(() => {});
    }
  }

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
          if (isSwipe && dy > 0) setter((p) => Math.max(0, p - 1));
          else if (!isSwipe) setter((p) => p + 1);
        } else {
          const next = [...setScores];
          const cur = next[currentSet];
          if (side === "home") {
            next[currentSet] = {
              ...cur,
              home: isSwipe && dy > 0 ? Math.max(0, cur.home - 1) : isSwipe ? cur.home : cur.home + 1,
            };
          } else {
            next[currentSet] = {
              ...cur,
              away: isSwipe && dy > 0 ? Math.max(0, cur.away - 1) : isSwipe ? cur.away : cur.away + 1,
            };
          }
          setSetScores(next);
        }
        ref.current = null;
        // Mark that touch handled this interaction
        touchHandled.current = true;
        setTimeout(() => { touchHandled.current = false; }, 300);
      };

      const handleClick = (side: "home" | "away") => {
        // Skip if touch already handled (prevents double-fire on mobile)
        if (touchHandled.current) return;

        if (isGameMode) {
          const setter = side === "home" ? setHomeScore : setAwayScore;
          setter((p) => p + 1);
        } else {
          const next = [...setScores];
          next[currentSet] = {
            ...next[currentSet],
            [side]: next[currentSet][side] + 1,
          };
          setSetScores(next);
        }
      };

      const handleMinus = (side: "home" | "away", e: React.MouseEvent) => {
        e.stopPropagation();
        if (isGameMode) {
          const setter = side === "home" ? setHomeScore : setAwayScore;
          setter((p) => Math.max(0, p - 1));
        } else {
          const next = [...setScores];
          next[currentSet] = {
            ...next[currentSet],
            [side]: Math.max(0, next[currentSet][side] - 1),
          };
          setSetScores(next);
        }
      };

      return (
        <div
          ref={liveContainerRef}
          className="fixed inset-0 z-50 bg-black flex flex-col select-none"
          style={{ touchAction: "none" }}
        >
          {/* Minimal top bar */}
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-2 py-1 bg-black/40">
            <Button
              variant="ghost"
              size="sm"
              className="text-white/60 hover:text-white hover:bg-white/10 h-8"
              onClick={() => {
                setScoringMode("input");
                if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
              }}
            >
              <X className="h-4 w-4 mr-1" /> Exit
            </Button>
            <span className="text-white/40 text-xs">
              {activeGame.league.name}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="text-white/60 hover:text-white hover:bg-white/10 h-8 w-8 p-0"
                onClick={() => {
                  if (isGameMode) { setHomeScore(0); setAwayScore(0); }
                  else { setSetScores((prev) => prev.map(() => ({ home: 0, away: 0 }))); setCurrentSet(0); }
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-white/60 hover:text-white hover:bg-white/10 h-8 w-8 p-0"
                onClick={toggleFullscreen}
              >
                {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          {/* Two-panel scoreboard */}
          <div className="flex-1 flex">
            {/* Home side — BLUE */}
            <div
              className="flex-1 bg-blue-600 flex flex-col items-center justify-center relative cursor-pointer active:bg-blue-700 transition-colors"
              onTouchStart={(e) => {
                homeTouchStart.current = { y: e.touches[0].clientY, time: Date.now() };
              }}
              onTouchEnd={(e) => handleLiveTouchEnd("home", e)}
              onClick={() => handleClick("home")}
              onContextMenu={(e) => { e.preventDefault(); handleMinus("home", e as any); }}
            >
              <span
                className="text-white font-bold leading-none tabular-nums"
                style={{ fontSize: "min(35vw, 35vh)" }}
              >
                {liveHome}
              </span>

              {/* Desktop minus button */}
              {!isTouch && (
                <button
                  className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-blue-800/60 hover:bg-blue-800 text-white/70 hover:text-white rounded-full h-10 w-10 flex items-center justify-center transition-colors"
                  onClick={(e) => handleMinus("home", e)}
                >
                  <Minus className="h-5 w-5" />
                </button>
              )}

              <div className="absolute bottom-4 left-0 right-0 text-center">
                <span className="bg-blue-800/80 text-white px-4 py-1.5 rounded text-sm font-medium inline-block max-w-[90%] truncate">
                  {activeGame.homeTeam.name}
                </span>
              </div>
            </div>

            {/* Away side — RED */}
            <div
              className="flex-1 bg-red-600 flex flex-col items-center justify-center relative cursor-pointer active:bg-red-700 transition-colors"
              onTouchStart={(e) => {
                awayTouchStart.current = { y: e.touches[0].clientY, time: Date.now() };
              }}
              onTouchEnd={(e) => handleLiveTouchEnd("away", e)}
              onClick={() => handleClick("away")}
              onContextMenu={(e) => { e.preventDefault(); handleMinus("away", e as any); }}
            >
              <span
                className="text-white font-bold leading-none tabular-nums"
                style={{ fontSize: "min(35vw, 35vh)" }}
              >
                {liveAway}
              </span>

              {/* Desktop minus button */}
              {!isTouch && (
                <button
                  className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-red-800/60 hover:bg-red-800 text-white/70 hover:text-white rounded-full h-10 w-10 flex items-center justify-center transition-colors"
                  onClick={(e) => handleMinus("away", e)}
                >
                  <Minus className="h-5 w-5" />
                </button>
              )}

              <div className="absolute bottom-4 left-0 right-0 text-center">
                <span className="bg-red-800/80 text-white px-4 py-1.5 rounded text-sm font-medium inline-block max-w-[90%] truncate">
                  {activeGame.awayTeam.name}
                </span>
              </div>
            </div>
          </div>

          {/* Swipe hint on mobile */}
          {isTouch && (
            <div className="bg-black text-white/30 text-center text-[10px] py-0.5">
              tap +1 · swipe down −1
            </div>
          )}

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
          <div className="bg-black px-4 py-3 safe-area-pb">
            <Button
              className="w-full bg-green-600 hover:bg-green-700 text-white h-12 text-base font-semibold"
              onClick={submitScore}
              disabled={saving || saved}
            >
              {saved ? (
                <><Check className="h-5 w-5 mr-2" /> Saved!</>
              ) : saving ? (
                "Saving..."
              ) : (
                <><Check className="h-5 w-5 mr-2" /> Submit Final</>
              )}
            </Button>
          </div>
        </div>
      );
    }

    // ==========================================
    // INPUT MODE — polished score entry
    // ==========================================
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b bg-card">
          <Button variant="ghost" size="sm" onClick={() => { setView("list"); setActiveGame(null); }}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div className="text-center">
            <p className="text-sm font-medium">{activeGame.league.name}</p>
            <p className="text-[11px] text-muted-foreground">
              {format(new Date(activeGame.scheduled_at), "h:mm a")}
              {activeGame.venue && ` · ${activeGame.venue}`}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5"
            onClick={() => setScoringMode("live")}
            title="Live Scoreboard"
          >
            <Monitor className="h-3.5 w-3.5" /> Live
          </Button>
        </div>

        {/* Main input area */}
        <div className="flex-1 overflow-auto">
          {/* Game mode: direct number input */}
          {isGameMode && (
            <div className="flex flex-col items-center justify-center min-h-full px-6 py-8">
              {/* Matchup header */}
              <p className="text-sm text-muted-foreground mb-8">Final Score</p>

              <div className="w-full max-w-sm space-y-2">
                {/* Home team row */}
                <div className="bg-blue-50 dark:bg-blue-950/30 rounded-xl p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-base truncate">{activeGame.homeTeam.name}</p>
                    <p className="text-xs text-muted-foreground">Home</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="h-10 w-10 rounded-lg border bg-card flex items-center justify-center hover:bg-muted active:scale-95 transition-all"
                      onClick={() => setHomeScore((p) => Math.max(0, p - 1))}
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <Input
                      type="number"
                      min={0}
                      value={homeScore}
                      onChange={(e) => setHomeScore(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-20 text-center text-3xl font-bold h-14 tabular-nums border-2 rounded-xl"
                    />
                    <button
                      className="h-10 w-10 rounded-lg border bg-card flex items-center justify-center hover:bg-muted active:scale-95 transition-all"
                      onClick={() => setHomeScore((p) => p + 1)}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* VS divider */}
                <div className="flex items-center justify-center py-1">
                  <div className="h-px flex-1 bg-border" />
                  <span className="px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">vs</span>
                  <div className="h-px flex-1 bg-border" />
                </div>

                {/* Away team row */}
                <div className="bg-red-50 dark:bg-red-950/30 rounded-xl p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-base truncate">{activeGame.awayTeam.name}</p>
                    <p className="text-xs text-muted-foreground">Away</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="h-10 w-10 rounded-lg border bg-card flex items-center justify-center hover:bg-muted active:scale-95 transition-all"
                      onClick={() => setAwayScore((p) => Math.max(0, p - 1))}
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <Input
                      type="number"
                      min={0}
                      value={awayScore}
                      onChange={(e) => setAwayScore(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-20 text-center text-3xl font-bold h-14 tabular-nums border-2 rounded-xl"
                    />
                    <button
                      className="h-10 w-10 rounded-lg border bg-card flex items-center justify-center hover:bg-muted active:scale-95 transition-all"
                      onClick={() => setAwayScore((p) => p + 1)}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Quick winner indicator */}
              {(homeScore > 0 || awayScore > 0) && homeScore !== awayScore && (
                <div className="mt-6 flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-medium">
                    {homeScore > awayScore ? activeGame.homeTeam.name : activeGame.awayTeam.name} wins
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Sets mode: improved layout */}
          {!isGameMode && (
            <div className="flex flex-col items-center px-6 py-6">
              {/* Matchup header */}
              <div className="text-center mb-6">
                <div className="flex items-center justify-center gap-3 mb-2">
                  <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                    {activeGame.homeTeam.name}
                  </span>
                  <span className="text-xs text-muted-foreground">vs</span>
                  <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                    {activeGame.awayTeam.name}
                  </span>
                </div>
                <div className="flex items-center justify-center gap-4">
                  <div className={`text-4xl font-bold tabular-nums ${homeSetWins > awaySetWins ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"}`}>
                    {homeSetWins}
                  </div>
                  <span className="text-lg text-muted-foreground">-</span>
                  <div className={`text-4xl font-bold tabular-nums ${awaySetWins > homeSetWins ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                    {awaySetWins}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Sets Won</p>
              </div>

              {/* Set scores grid */}
              <div className="w-full max-w-sm space-y-3">
                {/* Header row */}
                <div className="grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-2 px-1">
                  <div className="w-14" />
                  <div className="text-center text-xs font-medium text-blue-600 dark:text-blue-400 truncate">
                    {activeGame.homeTeam.name}
                  </div>
                  <div />
                  <div className="text-center text-xs font-medium text-red-600 dark:text-red-400 truncate">
                    {activeGame.awayTeam.name}
                  </div>
                  <div className="w-14" />
                </div>

                {setScores.map((s, i) => {
                  const setPlayed = s.home > 0 || s.away > 0;
                  const homeWon = s.home > s.away;
                  const awayWon = s.away > s.home;
                  return (
                    <div
                      key={i}
                      className={`grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-2 rounded-xl p-3 transition-colors ${
                        setPlayed
                          ? "bg-muted/50"
                          : "bg-card border border-dashed border-muted-foreground/20"
                      }`}
                    >
                      <span className="text-sm font-medium text-muted-foreground w-14">
                        Set {i + 1}
                      </span>
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
                        className={`text-center text-xl font-bold h-12 tabular-nums rounded-lg ${
                          homeWon ? "border-blue-400 bg-blue-50 dark:bg-blue-950/30" : ""
                        }`}
                      />
                      <span className="text-muted-foreground text-center w-4">-</span>
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
                        className={`text-center text-xl font-bold h-12 tabular-nums rounded-lg ${
                          awayWon ? "border-red-400 bg-red-50 dark:bg-red-950/30" : ""
                        }`}
                      />
                      <div className="w-14 flex justify-center">
                        {setPlayed && (
                          <Badge
                            className={`text-[10px] ${
                              homeWon
                                ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                                : awayWon
                                ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {homeWon ? "H" : awayWon ? "A" : "Tie"}
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Winner indicator */}
              {(homeSetWins > 0 || awaySetWins > 0) && homeSetWins !== awaySetWins && (
                <div className="mt-6 flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-medium">
                    {homeSetWins > awaySetWins ? activeGame.homeTeam.name : activeGame.awayTeam.name} leads
                    {(homeSetWins >= setsToWin || awaySetWins >= setsToWin) ? " — Match!" : ""}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom action bar */}
        <div className="p-4 border-t bg-card safe-area-pb">
          <Button
            className="w-full h-12 text-base font-semibold"
            onClick={submitScore}
            disabled={saving || saved}
          >
            {saved ? (
              <><Check className="h-5 w-5 mr-2" /> Saved!</>
            ) : saving ? (
              "Saving..."
            ) : (
              <><Check className="h-5 w-5 mr-2" /> Submit Score</>
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
