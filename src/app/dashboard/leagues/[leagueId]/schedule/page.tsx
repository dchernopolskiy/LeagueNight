"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter, useSearchParams } from "next/navigation";
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
} from "lucide-react";
import { format } from "date-fns";
import { generateSchedulePdf } from "@/lib/export/schedule-pdf";
import type { Game, Team, GameDayPattern, League, Player, Location, LocationUnavailability } from "@/lib/types";
import { useLeagueRole } from "@/lib/league-role-context";
import { GameDaySetupPanel } from "@/components/dashboard/game-day-setup";
import { useLeagueData, useLocations } from "@/lib/hooks";
import { PreferenceIndicator } from "@/components/dashboard/preference-indicator";


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
  const router = useRouter();

  // Fetch locations separately (organizer-scoped, not league-scoped)
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationUnavail, setLocationUnavail] = useState<LocationUnavailability[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);

  useEffect(() => {
    loadLocations();
    // Re-fetch when the tab regains focus so stale unavailability data
    // (added on the Locations page) gets picked up.
    function onFocus() {
      refetchLeague();
      loadLocations();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [leagueId]);

  async function loadLocations() {
    const supabase = createClient();
    const { data: locationsRes } = await supabase
      .from("locations")
      .select("*")
      .order("name");

    const locs = (locationsRes || []) as Location[];
    setLocations(locs);

    if (locs.length > 0) {
      const { data: unavailData } = await supabase
        .from("location_unavailability")
        .select("*")
        .in("location_id", locs.map((l) => l.id))
        .order("unavailable_date");
      setLocationUnavail((unavailData || []) as LocationUnavailability[]);
    }
    setLocationsLoading(false);
  }

  const loading = leagueLoading || locationsLoading;

  // Inline game editing
  const [editingGameId, setEditingGameId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editGameVenue, setEditGameVenue] = useState("");
  const [editHome, setEditHome] = useState("");
  const [editAway, setEditAway] = useState("");

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
    }
  ) {
    setGenerating(true);
    const res = await fetch("/api/schedule/generate", {
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
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.warnings && data.warnings.length > 0) {
        setSchedulingWarnings(data.warnings);
      } else {
        setSchedulingWarnings([]);
      }
      await refetchLeague();
    } else {
      setSchedulingWarnings([]);
    }
    setGenerating(false);
  }

  function exportSchedulePdfFn() {
    if (!league) return;
    const doc = generateSchedulePdf({ league, teams, players, games });
    doc.save(`${league.name} - Schedule.pdf`);
  }

  async function cancelGame(gameId: string) {
    const supabase = createClient();
    await supabase.from("games").update({ status: "cancelled" }).eq("id", gameId);
    await refetchLeague();
  }

  function startEditGame(game: Game) {
    const dt = new Date(game.scheduled_at);
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
    const gameDate = format(new Date(game.scheduled_at), "yyyy-MM-dd");
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
              <Button variant="outline" size="sm" onClick={exportSchedulePdfFn}>
                <Download className="h-4 w-4 mr-1" />
                Export PDF
              </Button>
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
                      <div className="flex flex-wrap items-center gap-1.5 mb-2">
                        <span className="text-xs text-muted-foreground">BYE:</span>
                        {byeTeams.map((t) => (
                          <Badge key={t.id} variant="outline" className="text-xs text-muted-foreground">
                            {t.name}
                          </Badge>
                        ))}
                      </div>
                    );
                  })()}
                  <div className="space-y-2">
                    {weekGames.map((game) => {
                      const isEditing = editingGameId === game.id;

                      if (isEditing) {
                        return (
                          <div key={game.id} className="border rounded-lg p-3 space-y-3 bg-muted/30">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <Label className="text-xs">Home</Label>
                                <Select value={editHome} onValueChange={(v) => v && setEditHome(v)}>
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue placeholder="Select team" />
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
                                    <SelectValue placeholder="Select team" />
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
                              {game.location_id && locationsMap.get(game.location_id)?.name
                                ? ` — ${locationsMap.get(game.location_id)!.name}`
                                : game.venue
                                  ? ` — ${game.venue}`
                                  : ""}
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
                            ) : game.status === "completed" ? (
                              <Badge>
                                {game.home_score} - {game.away_score}
                              </Badge>
                            ) : canManage ? (
                              <>
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
