"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Calendar,
  Zap,
  X,
  Download,
  Pencil,
  Check,
  AlertTriangle,
  MapPin,
  CalendarX2,
  ArrowRight,
  Trophy,
} from "lucide-react";
import { format } from "date-fns";
import { generateSchedulePdf } from "@/lib/export/schedule-pdf";
import { exportLeagueScheduleXlsx } from "@/lib/export/data-export";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Game, LeagueSettings, Location, LocationUnavailability } from "@/lib/types";
import { useLeagueRole } from "@/lib/league-role-context";
import { GameDaySetupPanel } from "@/components/dashboard/game-day-setup";
import { useLeagueData } from "@/lib/hooks";
import { PreferenceIndicator } from "@/components/dashboard/preference-indicator";


function Stat({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-emerald-900/60">{label}</div>
      <div className={`text-base font-semibold ${warn ? "text-amber-700" : "text-emerald-900"}`}>
        {value}
      </div>
    </div>
  );
}

export default function SchedulePage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { canManage } = useLeagueRole();
  const searchParams = useSearchParams();
  const activeDivisionId = searchParams.get("division");

  // Use custom hooks for data fetching
  const {
    league,
    teams,
    games: allGames,
    patterns,
    players,
    loading: leagueLoading,
    refetch: refetchLeague,
  } = useLeagueData(leagueId);

  // Filter to non-playoff games only
  const games = useMemo(
    () => allGames.filter((g) => !g.is_playoff),
    [allGames]
  );

  const [generating, setGenerating] = useState(false);
  const [schedulingWarnings, setSchedulingWarnings] = useState<string[]>([]);
  const [preflightPrompt, setPreflightPrompt] = useState<{
    message: string;
    preflight: {
      biggestDivisionName: string | null;
      biggestDivisionSize: number;
      minWeeksNeeded: number;
      availableWeeks: number;
      droppedPairCount: number;
    };
    retry: () => Promise<void>;
  } | null>(null);
  const [reseedBlock, setReseedBlock] = useState<{
    unplayedCount: number;
    regenerateFrom: string;
    message: string;
  } | null>(null);
  const [generationStats, setGenerationStats] = useState<{
    count: number;
    targetWeeks: number;
    byes: Array<{ teamId: string; weekNumber: number; backToBack: boolean }>;
    droppedPairs: Array<{ teamA: string; teamB: string; reason: string }>;
    preflight: {
      biggestDivisionName: string | null;
      biggestDivisionSize: number;
      minWeeksNeeded: number;
      availableWeeks: number;
      matchupFrequency: number;
    };
  } | null>(null);

  // Fetch locations separately (organizer-scoped, not league-scoped)
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationUnavail, setLocationUnavail] = useState<LocationUnavailability[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);

  const fetchLocationsData = useCallback(async () => {
    const supabase = createClient();
    const { data: locationsRes } = await supabase
      .from("locations")
      .select("*")
      .order("name");

    const locs = (locationsRes || []) as Location[];
    let unavail = [] as LocationUnavailability[];

    if (locs.length > 0) {
      const { data: unavailData } = await supabase
        .from("location_unavailability")
        .select("*")
        .in("location_id", locs.map((l) => l.id))
        .order("unavailable_date");
      unavail = (unavailData || []) as LocationUnavailability[];
    }

    return { locs, unavail };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function syncLocations() {
      setLocationsLoading(true);
      const { locs, unavail } = await fetchLocationsData();
      if (cancelled) return;
      setLocations(locs);
      setLocationUnavail(unavail);
      setLocationsLoading(false);
    }

    void syncLocations();

    return () => {
      cancelled = true;
    };
  }, [leagueId, fetchLocationsData]);

  const loadLocations = useCallback(async () => {
    setLocationsLoading(true);
    const { locs, unavail } = await fetchLocationsData();
    setLocations(locs);
    setLocationUnavail(unavail);
    setLocationsLoading(false);
  }, [fetchLocationsData]);

  const loading = leagueLoading || locationsLoading;

  // Inline game editing
  const [editingGameId, setEditingGameId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editGameVenue, setEditGameVenue] = useState("");
  const [editHome, setEditHome] = useState("");
  const [editAway, setEditAway] = useState("");
  const [scoringGameId, setScoringGameId] = useState<string | null>(null);
  const [homeScore, setHomeScore] = useState("");
  const [awayScore, setAwayScore] = useState("");
  const [setScores, setSetScores] = useState<{ home: string; away: string }[]>([]);

  // Conflict resolution
  const [conflictMoveTargets, setConflictMoveTargets] = useState<Record<string, string>>({});
  const [conflictRescheduleDates, setConflictRescheduleDates] = useState<Record<string, string>>({});
  const [applyingAll, setApplyingAll] = useState(false);

  async function generateSchedule(
    patternId: string,
    opts: {
      gamesPerTeam: number;
      gamesPerSession: number;
      matchupFrequency: number;
      mixDivisions: boolean;
      skipDates: string[];
      regenerateFrom?: string;
      locationIds: string[];
      reseedMode?: "by_skill" | "within_division";
    },
    acceptTruncation = false
  ) {
    setGenerating(true);
    setReseedBlock(null);
    const res = await fetch("/api/schedule/generate-v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leagueId,
        patternId,
        gamesPerTeam: opts.gamesPerTeam,
        gamesPerSession: opts.gamesPerSession,
        matchupFrequency: opts.matchupFrequency,
        mixDivisions: opts.mixDivisions,
        skipDates: opts.skipDates,
        regenerateFrom: opts.regenerateFrom,
        locationIds: opts.locationIds,
        acceptTruncation,
        reseedMode: opts.reseedMode,
      }),
    });

    if (res.status === 409) {
      const data = await res.json();
      if (data.error === "truncation_required") {
        setPreflightPrompt({
          message: data.message,
          preflight: data.preflight,
          retry: () => generateSchedule(patternId, opts, true),
        });
        setGenerating(false);
        return;
      }
      if (data.error === "reseed_blocked_unplayed_games") {
        setReseedBlock({
          unplayedCount: data.unplayedCount,
          regenerateFrom: data.regenerateFrom,
          message: data.message,
        });
        setGenerating(false);
        return;
      }
    }

    if (res.ok) {
      const data = await res.json();
      if (data.warnings && data.warnings.length > 0) {
        setSchedulingWarnings(data.warnings);
      } else {
        setSchedulingWarnings([]);
      }
      setGenerationStats({
        count: data.count ?? 0,
        targetWeeks: data.targetWeeks ?? 0,
        byes: data.byes ?? [],
        droppedPairs: data.droppedPairs ?? [],
        preflight: data.preflight,
      });
      await refetchLeague();
    } else {
      setSchedulingWarnings([]);
    }
    setPreflightPrompt(null);
    setGenerating(false);
  }

  // Half-season cutoff: most recent pattern.last_regenerated_at, falling back
  // to the midpoint week across existing games.
  const halfSeasonCutoff = useMemo(() => {
    const stamps = (patterns || [])
      .map((p) => p.last_regenerated_at)
      .filter((s): s is string => !!s)
      .sort();
    if (stamps.length > 0) return new Date(stamps[stamps.length - 1]);
    const weeks = Array.from(new Set(games.map((g) => g.week_number || 0))).sort(
      (a, b) => a - b
    );
    if (weeks.length < 2) return null;
    const midWeek = weeks[Math.floor(weeks.length / 2)];
    // Use the earliest scheduled_at at or after midWeek as the cutoff.
    const midGame = games
      .filter((g) => (g.week_number || 0) >= midWeek)
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0];
    return midGame ? new Date(midGame.scheduled_at) : null;
  }, [patterns, games]);

  function gamesBeforeCutoff(): Game[] {
    if (!halfSeasonCutoff) return games;
    return games.filter((g) => new Date(g.scheduled_at) < halfSeasonCutoff);
  }
  function gamesAfterCutoff(): Game[] {
    if (!halfSeasonCutoff) return [];
    return games.filter((g) => new Date(g.scheduled_at) >= halfSeasonCutoff);
  }

  function exportPdf(filtered: Game[], suffix: string) {
    if (!league) return;
    const doc = generateSchedulePdf({ league, teams, players, games: filtered });
    doc.save(`${league.name}${suffix}.pdf`);
  }

  function exportXlsx(filtered: Game[], suffix: string) {
    if (!league) return;
    exportLeagueScheduleXlsx({
      league,
      teams,
      games: filtered,
      filename: `${league.name}${suffix}.xlsx`,
    });
  }

  async function cancelGame(gameId: string) {
    const supabase = createClient();
    await supabase.from("games").update({ status: "cancelled" }).eq("id", gameId);
    await refetchLeague();
  }

  function startEditGame(game: Game) {
    const dt = new Date(game.scheduled_at);
    resetScoreEditor();
    setEditingGameId(game.id);
    setEditDate(format(dt, "yyyy-MM-dd"));
    setEditTime(format(dt, "HH:mm"));
    setEditGameVenue(game.venue || "");
    setEditHome(game.home_team_id);
    setEditAway(game.away_team_id);
  }

  async function saveEditGame() {
    if (!editingGameId) return;
    const scheduledAt = new Date(`${editDate}T${editTime}`);
    const supabase = createClient();
    const { error } = await supabase
      .from("games")
      .update({
        scheduled_at: scheduledAt.toISOString(),
        venue: editGameVenue || null,
        home_team_id: editHome,
        away_team_id: editAway,
      })
      .eq("id", editingGameId);

    if (!error) {
      await refetchLeague();
      setEditingGameId(null);
    }
  }

  const leagueSettings = (league?.settings || {}) as LeagueSettings;
  const scoringMode = leagueSettings.scoring_mode || "game";
  const setsToWin = leagueSettings.sets_to_win || 2;
  const maxSets = setsToWin * 2 - 1;

  function startScoreGame(game: Game) {
    setEditingGameId(null);
    setScoringGameId(game.id);
    setHomeScore(game.home_score?.toString() || "");
    setAwayScore(game.away_score?.toString() || "");
    setSetScores(Array.from({ length: maxSets }, () => ({ home: "", away: "" })));
  }

  function resetScoreEditor() {
    setScoringGameId(null);
    setHomeScore("");
    setAwayScore("");
    setSetScores([]);
  }

  async function saveScoreGame(gameId: string) {
    let nextHomeScore: number;
    let nextAwayScore: number;

    if (scoringMode === "sets") {
      let homeWins = 0;
      let awayWins = 0;

      for (const set of setScores) {
        if (!set.home || !set.away) continue;
        const home = parseInt(set.home, 10);
        const away = parseInt(set.away, 10);
        if (Number.isNaN(home) || Number.isNaN(away)) continue;
        if (home > away) homeWins++;
        else if (away > home) awayWins++;
      }

      if (homeWins < setsToWin && awayWins < setsToWin) {
        alert(`A team needs ${setsToWin} set wins to complete this game.`);
        return;
      }

      nextHomeScore = homeWins;
      nextAwayScore = awayWins;
    } else {
      nextHomeScore = parseInt(homeScore, 10);
      nextAwayScore = parseInt(awayScore, 10);

      if (Number.isNaN(nextHomeScore) || Number.isNaN(nextAwayScore)) {
        return;
      }
    }

    const supabase = createClient();
    const { error } = await supabase
      .from("games")
      .update({
        home_score: nextHomeScore,
        away_score: nextAwayScore,
        status: "completed",
      })
      .eq("id", gameId);

    if (!error) {
      await supabase.rpc("recalculate_standings", { p_league_id: leagueId });
      await refetchLeague();
      resetScoreEditor();
    }
  }

  async function resetGameScore(gameId: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("games")
      .update({
        home_score: null,
        away_score: null,
        status: "scheduled",
      })
      .eq("id", gameId);

    if (!error) {
      await supabase.rpc("recalculate_standings", { p_league_id: leagueId });
      await refetchLeague();
      resetScoreEditor();
    }
  }

  const teamsMap = new Map(teams.map((t) => [t.id, t]));
  const locationsMap = new Map(locations.map((l) => [l.id, l]));

  const conflictedGames = useMemo(() => {
    return games.filter((g) => {
      if (!g.location_id || g.status !== "scheduled") return false;
      const gameDate = format(new Date(g.scheduled_at), "yyyy-MM-dd");
      return locationUnavail.some(
        (u) => u.location_id === g.location_id && u.unavailable_date === gameDate
      );
    });
  }, [games, locationUnavail]);

  function getAvailableLocationsForGame(game: Game): Location[] {
    const gameDate = format(new Date(game.scheduled_at), "yyyy-MM-dd");
    return locations.filter((loc) => {
      if (loc.id === game.location_id) return false;
      const isUnavailable = locationUnavail.some(
        (u) => u.location_id === loc.id && u.unavailable_date === gameDate
      );
      return !isUnavailable;
    });
  }

  function getSuggestedLocation(game: Game): Location | null {
    const currentLoc = game.location_id ? locationsMap.get(game.location_id) : null;
    const currentTags = currentLoc?.tags || [];
    const available = getAvailableLocationsForGame(game);
    // Prefer a location with matching tags
    const withMatchingTags = available.filter((loc) =>
      currentTags.some((tag) => loc.tags.includes(tag))
    );
    return withMatchingTags[0] || available[0] || null;
  }

  async function moveGameToLocation(gameId: string, locationId: string) {
    const loc = locationsMap.get(locationId);
    if (!loc) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("games")
      .update({ location_id: locationId, venue: loc.name })
      .eq("id", gameId);
    if (!error) {
      await refetchLeague();
    }
  }

  async function rescheduleGame(gameId: string, newDate: string) {
    const game = games.find((g) => g.id === gameId);
    if (!game || !newDate) return;
    const oldDt = new Date(game.scheduled_at);
    const timePart = format(oldDt, "HH:mm");
    const newScheduledAt = new Date(`${newDate}T${timePart}`);
    const supabase = createClient();
    const { error } = await supabase
      .from("games")
      .update({ scheduled_at: newScheduledAt.toISOString() })
      .eq("id", gameId);
    if (!error) {
      await refetchLeague();
    }
  }

  async function cancelConflictedGame(gameId: string) {
    const supabase = createClient();
    const { error } = await supabase.from("games").update({ status: "cancelled" }).eq("id", gameId);
    if (!error) {
      await refetchLeague();
    }
  }

  async function applyAllSuggestions() {
    setApplyingAll(true);
    const supabase = createClient();
    for (const game of conflictedGames) {
      const suggested = getSuggestedLocation(game);
      if (suggested) {
        await supabase
          .from("games")
          .update({ location_id: suggested.id, venue: suggested.name })
          .eq("id", game.id);
      }
    }
    await refetchLeague();
    setApplyingAll(false);
  }

  const divisionTeamIds = activeDivisionId
    ? new Set(teams.filter((t) => t.division_id === activeDivisionId).map((t) => t.id))
    : null;

  const displayedGames = divisionTeamIds
    ? games.filter(
        (g) => divisionTeamIds.has(g.home_team_id) || divisionTeamIds.has(g.away_team_id)
      )
    : games;

  const gamesByWeek = new Map<number, Game[]>();
  for (const game of displayedGames) {
    const week = game.week_number || 0;
    const arr = gamesByWeek.get(week) || [];
    arr.push(game);
    gamesByWeek.set(week, arr);
  }

  if (loading) {
    return <p className="text-muted-foreground">Loading schedule...</p>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Game Day Setup
          </CardTitle>
        </CardHeader>
        <CardContent>
          <GameDaySetupPanel
            leagueId={leagueId}
            organizerId={league?.organizer_id || ""}
            patterns={patterns}
            locations={locations}
            locationUnavail={locationUnavail}
            teamCount={teams.length}
            canManage={canManage}
            generating={generating}
            onPatternsChange={async () => {
              await refetchLeague();
              await loadLocations();
            }}
            onLocationsChange={async () => {
              await loadLocations();
            }}
            onGenerate={generateSchedule}
          />
        </CardContent>
      </Card>

      {/* Preflight truncation prompt */}
      {preflightPrompt && (
        <Card className="border-orange-300 bg-orange-50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-orange-800">
              <AlertTriangle className="h-4 w-4" />
              Season won&rsquo;t fit full round-robin
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-orange-900">{preflightPrompt.message}</p>
            <div className="text-xs text-orange-900/80 space-y-0.5">
              <div>
                Biggest division: <strong>{preflightPrompt.preflight.biggestDivisionName ?? "(unnamed)"}</strong>{" "}
                ({preflightPrompt.preflight.biggestDivisionSize} teams)
              </div>
              <div>
                Needs <strong>{preflightPrompt.preflight.minWeeksNeeded}</strong> weeks; only{" "}
                <strong>{preflightPrompt.preflight.availableWeeks}</strong> available
              </div>
              <div>
                <strong>{preflightPrompt.preflight.droppedPairCount}</strong> pairing
                {preflightPrompt.preflight.droppedPairCount === 1 ? "" : "s"} will be dropped
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => void preflightPrompt.retry()}
                disabled={generating}
              >
                Proceed anyway
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPreflightPrompt(null)}
                disabled={generating}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Generation summary */}
      {generationStats && (
        (() => {
          const gs = generationStats;
          const totalByes = gs.byes.length;
          const backToBackByes = gs.byes.filter((b) => b.backToBack).length;
          // Games per team from the freshly generated set.
          const gamesPerTeam = new Map<string, number>();
          for (const t of teams) gamesPerTeam.set(t.id, 0);
          for (const g of games) {
            if (g.is_playoff) continue;
            gamesPerTeam.set(g.home_team_id, (gamesPerTeam.get(g.home_team_id) || 0) + 1);
            gamesPerTeam.set(g.away_team_id, (gamesPerTeam.get(g.away_team_id) || 0) + 1);
          }
          const counts = Array.from(gamesPerTeam.values());
          const minGames = counts.length ? Math.min(...counts) : 0;
          const maxGames = counts.length ? Math.max(...counts) : 0;
          const avgGames = counts.length
            ? Math.round((counts.reduce((a, b) => a + b, 0) / counts.length) * 10) / 10
            : 0;
          // BYEs per team
          const byesPerTeam = new Map<string, number>();
          for (const b of gs.byes) {
            byesPerTeam.set(b.teamId, (byesPerTeam.get(b.teamId) || 0) + 1);
          }
          const maxByes = byesPerTeam.size
            ? Math.max(...Array.from(byesPerTeam.values()))
            : 0;
          return (
            <Card className="border-emerald-200 bg-emerald-50/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base text-emerald-800">
                    Generation summary
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-emerald-700"
                    onClick={() => setGenerationStats(null)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Stat label="Games scheduled" value={gs.count} />
                  <Stat label="Weeks" value={gs.targetWeeks} />
                  <Stat
                    label="Games / team"
                    value={
                      minGames === maxGames
                        ? `${minGames}`
                        : `${minGames}–${maxGames} (avg ${avgGames})`
                    }
                  />
                  <Stat
                    label="Biggest division"
                    value={`${gs.preflight.biggestDivisionName ?? "—"} (${gs.preflight.biggestDivisionSize})`}
                  />
                  <Stat label="BYE weeks" value={totalByes} />
                  <Stat
                    label="Back-to-back BYEs"
                    value={backToBackByes}
                    warn={backToBackByes > 0}
                  />
                  <Stat label="Max BYEs / team" value={maxByes} />
                  <Stat
                    label="Dropped pairs"
                    value={gs.droppedPairs.length}
                    warn={gs.droppedPairs.length > 0}
                  />
                </div>
                <p className="text-xs text-emerald-900/70">
                  Season length = {gs.preflight.minWeeksNeeded} weeks needed for full
                  round-robin × {gs.preflight.matchupFrequency}, {gs.preflight.availableWeeks}{" "}
                  available.
                </p>
                {gs.droppedPairs.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-emerald-900/80 hover:text-emerald-900">
                      Show dropped pairs ({gs.droppedPairs.length})
                    </summary>
                    <ul className="mt-1 space-y-0.5 pl-4 list-disc">
                      {gs.droppedPairs.slice(0, 20).map((p, i) => (
                        <li key={i}>
                          {teamsMap.get(p.teamA)?.name ?? p.teamA} vs{" "}
                          {teamsMap.get(p.teamB)?.name ?? p.teamB} — {p.reason}
                        </li>
                      ))}
                      {gs.droppedPairs.length > 20 && (
                        <li>…and {gs.droppedPairs.length - 20} more</li>
                      )}
                    </ul>
                  </details>
                )}
              </CardContent>
            </Card>
          );
        })()
      )}

      {/* Re-seed hard block: unplayed games before regen date */}
      {reseedBlock && (
        <Card className="border-red-300 bg-red-50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-red-800">
              <AlertTriangle className="h-4 w-4" />
              Cannot re-seed yet
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-red-900">{reseedBlock.message}</p>
            <p className="text-xs text-red-900/80">
              Go to the schedule below, mark those games complete (or reschedule them past{" "}
              <strong>{reseedBlock.regenerateFrom}</strong>), then try again.
            </p>
            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={() => setReseedBlock(null)}>
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Scheduling Warnings */}
      {schedulingWarnings.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-4 w-4" />
              Scheduling Capacity Warning
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {schedulingWarnings.map((warning, idx) => (
              <p key={idx} className="text-sm text-amber-700">
                {warning}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {games.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Schedule</CardTitle>
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <Button variant="outline" size="sm">
                    <Download className="h-4 w-4 mr-1" />
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel className="text-xs">Full season</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => exportPdf(games, " - Schedule")}>
                    PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportXlsx(games, " - Schedule")}>
                    XLSX
                  </DropdownMenuItem>
                  {halfSeasonCutoff && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-xs">
                        First half (before {format(halfSeasonCutoff, "MMM d")})
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() => exportPdf(gamesBeforeCutoff(), " - First Half")}
                      >
                        PDF
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => exportXlsx(gamesBeforeCutoff(), " - First Half")}
                      >
                        XLSX
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-xs">
                        Second half (on/after {format(halfSeasonCutoff, "MMM d")})
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() => exportPdf(gamesAfterCutoff(), " - Second Half")}
                      >
                        PDF
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => exportXlsx(gamesAfterCutoff(), " - Second Half")}
                      >
                        XLSX
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardHeader>
          <CardContent>
            {[...gamesByWeek.entries()]
              .sort(([a], [b]) => a - b)
              .map(([week, weekGames]) => (
                <div key={week} className="mb-6 last:mb-0">
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">Week {week}</h3>
                  {(() => {
                    const teamsPlaying = new Set<string>();
                    for (const g of weekGames) {
                      if (g.status !== "cancelled") {
                        teamsPlaying.add(g.home_team_id);
                        teamsPlaying.add(g.away_team_id);
                      }
                    }
                    const relevantTeams = divisionTeamIds
                      ? teams.filter((t) => divisionTeamIds.has(t.id))
                      : teams;
                    const byeTeams = relevantTeams.filter((t) => !teamsPlaying.has(t.id));
                    if (byeTeams.length === 0) return null;
                    return (
                      <div className="flex flex-wrap items-start gap-1.5 mb-2">
                        <span className="text-xs text-muted-foreground shrink-0">BYE:</span>
                        {byeTeams.map((t) => (
                          <Badge
                            key={t.id}
                            variant="outline"
                            className="max-w-full whitespace-normal break-words text-xs text-muted-foreground"
                          >
                            {t.name}
                          </Badge>
                        ))}
                      </div>
                    );
                  })()}
                  {(() => {
                    const venueGroups = new Map<string, { label: string; games: Game[] }>();
                    for (const game of weekGames) {
                      const locationName = game.location_id
                        ? locationsMap.get(game.location_id)?.name
                        : null;
                      const label = locationName || game.venue || "Unassigned venue";
                      const groupKey = game.location_id || game.venue || "unassigned";
                      const existing = venueGroups.get(groupKey);
                      if (existing) {
                        existing.games.push(game);
                      } else {
                        venueGroups.set(groupKey, { label, games: [game] });
                      }
                    }

                    return (
                      <div className="space-y-4">
                        {[...venueGroups.values()].map((group) => (
                          <div key={group.label} className="rounded-lg border bg-muted/10">
                            <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
                              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                {group.label}
                              </h4>
                            </div>
                            <div className="px-3 py-1">
                              {group.games.map((game) => {
                                const isEditing = editingGameId === game.id;
                                const isScoring = scoringGameId === game.id;

                                if (isEditing) {
                                  return (
                                    <div key={game.id} className="border rounded-lg p-3 my-2 space-y-3 bg-muted/30">
                                      <div className="grid grid-cols-2 gap-2">
                                        <div>
                                          <Label className="text-xs">Home</Label>
                                          <Select value={editHome} onValueChange={(v) => v && setEditHome(v)}>
                                            <SelectTrigger className="h-8 text-xs">
                                              <SelectValue placeholder="Select team">
                                                {teamsMap.get(editHome)?.name || "Select team"}
                                              </SelectValue>
                                            </SelectTrigger>
                                            <SelectContent>
                                              {teams.map((t) => (
                                                <SelectItem key={t.id} value={t.id}>
                                                  {t.name}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </div>
                                        <div>
                                          <Label className="text-xs">Away</Label>
                                          <Select value={editAway} onValueChange={(v) => v && setEditAway(v)}>
                                            <SelectTrigger className="h-8 text-xs">
                                              <SelectValue placeholder="Select team">
                                                {teamsMap.get(editAway)?.name || "Select team"}
                                              </SelectValue>
                                            </SelectTrigger>
                                            <SelectContent>
                                              {teams.map((t) => (
                                                <SelectItem key={t.id} value={t.id}>
                                                  {t.name}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </div>
                                      </div>
                                      <div className="grid grid-cols-3 gap-2">
                                        <div>
                                          <Label className="text-xs">Date</Label>
                                          <Input
                                            type="date"
                                            value={editDate}
                                            onChange={(e) => setEditDate(e.target.value)}
                                            className="h-8 text-xs"
                                          />
                                        </div>
                                        <div>
                                          <Label className="text-xs">Time</Label>
                                          <Input
                                            type="time"
                                            value={editTime}
                                            onChange={(e) => setEditTime(e.target.value)}
                                            className="h-8 text-xs"
                                          />
                                        </div>
                                        <div>
                                          <Label className="text-xs">Venue</Label>
                                          <Input
                                            value={editGameVenue}
                                            onChange={(e) => setEditGameVenue(e.target.value)}
                                            className="h-8 text-xs"
                                            placeholder="Venue"
                                          />
                                        </div>
                                      </div>
                                      <div className="flex justify-end gap-2">
                                        <Button variant="ghost" size="sm" onClick={() => setEditingGameId(null)}>
                                          Cancel
                                        </Button>
                                        <Button size="sm" onClick={saveEditGame}>
                                          <Check className="h-3 w-3 mr-1" />
                                          Save
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                }

                                if (isScoring) {
                                  return (
                                    <div key={game.id} className="border rounded-lg p-3 my-2 space-y-3 bg-muted/30">
                                      <div>
                                        <p className="text-sm font-medium">
                                          {teamsMap.get(game.home_team_id)?.name} vs {teamsMap.get(game.away_team_id)?.name}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                          {format(new Date(game.scheduled_at), "EEE, MMM d 'at' h:mm a")}
                                          {game.court && ` (${game.court})`}
                                        </p>
                                      </div>
                                      {scoringMode === "sets" ? (
                                        <div className="grid gap-2">
                                          {setScores.map((setScore, index) => (
                                            <div key={`${game.id}-set-${index}`} className="grid grid-cols-3 gap-2 items-end">
                                              <div>
                                                <Label className="text-xs">Set {index + 1} Home</Label>
                                                <Input
                                                  type="number"
                                                  min="0"
                                                  value={setScore.home}
                                                  onChange={(e) =>
                                                    setSetScores((prev) =>
                                                      prev.map((entry, entryIndex) =>
                                                        entryIndex === index
                                                          ? { ...entry, home: e.target.value }
                                                          : entry
                                                      )
                                                    )
                                                  }
                                                  className="h-8 text-xs"
                                                />
                                              </div>
                                              <div>
                                                <Label className="text-xs">Set {index + 1} Away</Label>
                                                <Input
                                                  type="number"
                                                  min="0"
                                                  value={setScore.away}
                                                  onChange={(e) =>
                                                    setSetScores((prev) =>
                                                      prev.map((entry, entryIndex) =>
                                                        entryIndex === index
                                                          ? { ...entry, away: e.target.value }
                                                          : entry
                                                      )
                                                    )
                                                  }
                                                  className="h-8 text-xs"
                                                />
                                              </div>
                                              <div className="text-[11px] text-muted-foreground pb-2">
                                                First to {setsToWin} sets
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="grid grid-cols-2 gap-2">
                                          <div>
                                            <Label className="text-xs">Home score</Label>
                                            <Input
                                              type="number"
                                              min="0"
                                              value={homeScore}
                                              onChange={(e) => setHomeScore(e.target.value)}
                                              className="h-8 text-xs"
                                            />
                                          </div>
                                          <div>
                                            <Label className="text-xs">Away score</Label>
                                            <Input
                                              type="number"
                                              min="0"
                                              value={awayScore}
                                              onChange={(e) => setAwayScore(e.target.value)}
                                              className="h-8 text-xs"
                                            />
                                          </div>
                                        </div>
                                      )}
                                      <div className="flex justify-end gap-2">
                                        {game.status === "completed" && (
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="text-destructive hover:bg-destructive/10 border-destructive/30"
                                            onClick={() => resetGameScore(game.id)}
                                          >
                                            Reset Scores
                                          </Button>
                                        )}
                                        <Button variant="ghost" size="sm" onClick={resetScoreEditor}>
                                          Cancel
                                        </Button>
                                        <Button size="sm" onClick={() => saveScoreGame(game.id)}>
                                          <Check className="h-3 w-3 mr-1" />
                                          Save Score
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                }

                                return (
                                  <div key={game.id} className="flex items-center justify-between py-2 border-b last:border-0">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium">
                                          {teamsMap.get(game.home_team_id)?.name} vs {teamsMap.get(game.away_team_id)?.name}
                                        </span>
                                        <PreferenceIndicator
                                          preferenceApplied={game.preference_applied}
                                          homeTeamName={teamsMap.get(game.home_team_id)?.name}
                                          awayTeamName={teamsMap.get(game.away_team_id)?.name}
                                          variant="badge"
                                        />
                                      </div>
                                      <p className="text-xs text-muted-foreground">
                                        {format(new Date(game.scheduled_at), "EEE, MMM d 'at' h:mm a")}
                                        {game.court && ` (${game.court})`}
                                      </p>
                                      {game.scheduling_notes && (
                                        <p className="text-xs text-blue-600 italic mt-1">
                                          {game.scheduling_notes}
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      {game.status === "cancelled" ? (
                                        <Badge variant="destructive">Cancelled</Badge>
                                      ) : canManage ? (
                                        <>
                                          {game.status === "completed" && (
                                            <Badge>
                                              {game.home_score} - {game.away_score}
                                            </Badge>
                                          )}
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 w-6 p-0 text-muted-foreground"
                                            onClick={() => startEditGame(game)}
                                          >
                                            <Pencil className="h-3 w-3" />
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 w-6 p-0 text-muted-foreground"
                                            onClick={() => startScoreGame(game)}
                                          >
                                            <Trophy className="h-3 w-3" />
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 w-6 p-0 text-muted-foreground"
                                            onClick={() => cancelGame(game.id)}
                                          >
                                            <X className="h-3 w-3" />
                                          </Button>
                                        </>
                                      ) : null}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      {conflictedGames.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2 text-amber-700">
                <AlertTriangle className="h-4 w-4" />
                Location Conflicts ({conflictedGames.length})
              </CardTitle>
              {canManage && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={applyAllSuggestions}
                  disabled={applyingAll}
                  className="border-amber-300 text-amber-700 hover:bg-amber-100"
                >
                  <Zap className="h-3.5 w-3.5 mr-1" />
                  {applyingAll ? "Applying..." : "Apply All Suggestions"}
                </Button>
              )}
            </div>
            <p className="text-xs text-amber-600 mt-1">
              These games are scheduled at locations that are unavailable on their game dates.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {conflictedGames.map((game) => {
              const homeTeam = teamsMap.get(game.home_team_id);
              const awayTeam = teamsMap.get(game.away_team_id);
              const currentLoc = game.location_id ? locationsMap.get(game.location_id) : null;
              const gameDate = format(new Date(game.scheduled_at), "yyyy-MM-dd");
              const unavailEntry = locationUnavail.find(
                (u) => u.location_id === game.location_id && u.unavailable_date === gameDate
              );
              const availableLocations = getAvailableLocationsForGame(game);
              const suggested = getSuggestedLocation(game);

              return (
                <div key={game.id} className="border border-amber-200 rounded-lg p-3 bg-white space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {homeTeam?.name ?? "TBD"} vs {awayTeam?.name ?? "TBD"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(game.scheduled_at), "EEE, MMM d 'at' h:mm a")}
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-xs text-amber-600 bg-amber-50 border-amber-200">
                      <MapPin className="h-3 w-3 mr-0.5" />
                      {currentLoc?.name ?? "Unknown"} unavailable
                    </Badge>
                  </div>

                  {unavailEntry?.reason && (
                    <p className="text-xs text-amber-600 italic">Reason: {unavailEntry.reason}</p>
                  )}

                  {suggested && (
                    <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                      <ArrowRight className="h-3 w-3" />
                      Suggested: move to <span className="font-medium">{suggested.name}</span>
                    </div>
                  )}

                  {canManage && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <Select
                          value={conflictMoveTargets[game.id] || ""}
                          onValueChange={(v) =>
                            v && setConflictMoveTargets((prev) => ({ ...prev, [game.id]: v }))
                          }
                        >
                          <SelectTrigger className="h-7 text-xs w-40">
                            <SelectValue placeholder="Pick location" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableLocations.map((loc) => (
                              <SelectItem key={loc.id} value={loc.id}>
                                {loc.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={!conflictMoveTargets[game.id]}
                          onClick={() => moveGameToLocation(game.id, conflictMoveTargets[game.id])}
                        >
                          <MapPin className="h-3 w-3 mr-1" />
                          Move
                        </Button>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Input
                          type="date"
                          className="h-7 text-xs w-36"
                          value={conflictRescheduleDates[game.id] || ""}
                          onChange={(e) =>
                            setConflictRescheduleDates((prev) => ({
                              ...prev,
                              [game.id]: e.target.value,
                            }))
                          }
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={!conflictRescheduleDates[game.id]}
                          onClick={() => rescheduleGame(game.id, conflictRescheduleDates[game.id])}
                        >
                          <CalendarX2 className="h-3 w-3 mr-1" />
                          Reschedule
                        </Button>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs text-destructive hover:bg-destructive/10 border-destructive/30"
                        onClick={() => cancelConflictedGame(game.id)}
                      >
                        <X className="h-3 w-3 mr-1" />
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
