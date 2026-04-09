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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Calendar,
  Zap,
  X,
  Download,
  Pencil,
  Check,
  AlertTriangle,
  Trash2,
  MapPin,
  CalendarX2,
  ArrowRight,
} from "lucide-react";
import { format } from "date-fns";
import { generateSchedulePdf } from "@/lib/export/schedule-pdf";
import type { Game, Team, GameDayPattern, League, Player, Location, LocationUnavailability } from "@/lib/types";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const DURATION_OPTIONS = [30, 45, 60, 75, 90, 120];

/**
 * Returns common US holiday dates that fall within a given date range.
 */
function getUSHolidays(startDate: string, endDate: string): string[] {
  const start = new Date(startDate + "T00:00:00");
  const end = endDate ? new Date(endDate + "T00:00:00") : new Date(start.getFullYear() + 1, 0, 1);
  const holidays: string[] = [];
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();

  for (let year = startYear; year <= endYear; year++) {
    const candidates: Date[] = [];
    candidates.push(new Date(year, 0, 1));
    candidates.push(nthWeekday(year, 0, 1, 3));
    candidates.push(nthWeekday(year, 1, 1, 3));
    candidates.push(lastWeekday(year, 4, 1));
    candidates.push(new Date(year, 6, 4));
    candidates.push(nthWeekday(year, 8, 1, 1));
    candidates.push(nthWeekday(year, 10, 4, 4));
    candidates.push(new Date(year, 11, 25));

    for (const d of candidates) {
      if (d >= start && d <= end) {
        holidays.push(formatYMD(d));
      }
    }
  }
  return holidays;
}

function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  const diff = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + diff + (n - 1) * 7);
}

function lastWeekday(year: number, month: number, weekday: number): Date {
  const last = new Date(year, month + 1, 0);
  const diff = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month, last.getDate() - diff);
}

function formatYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function SchedulePage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const searchParams = useSearchParams();
  const activeDivisionId = searchParams.get("division");
  const [games, setGames] = useState<Game[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [patterns, setPatterns] = useState<GameDayPattern[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [league, setLeague] = useState<League | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationUnavail, setLocationUnavail] = useState<LocationUnavailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const router = useRouter();

  // Pattern form
  const [dayOfWeek, setDayOfWeek] = useState("4");
  const [startTime, setStartTime] = useState("19:00");
  const [venue, setVenue] = useState("");
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [gamesPerTeam, setGamesPerTeam] = useState("1");
  const [matchupFrequency, setMatchupFrequency] = useState("1");
  const [mixDivisions, setMixDivisions] = useState(false);
  const [addingPattern, setAddingPattern] = useState(false);

  // Skip dates
  const [skipDates, setSkipDates] = useState<string[]>([]);
  const [newSkipDate, setNewSkipDate] = useState("");

  // Regenerate from date
  const [regenerateFrom, setRegenerateFrom] = useState("");

  // Confirm regeneration
  const [confirmGenerate, setConfirmGenerate] = useState<string | null>(null);

  // Confirm delete pattern
  const [confirmDeletePattern, setConfirmDeletePattern] = useState<string | null>(null);

  // Edit pattern dialog
  const [editingPattern, setEditingPattern] = useState<GameDayPattern | null>(null);
  const [editDayOfWeek, setEditDayOfWeek] = useState("4");
  const [editStartTime, setEditStartTime] = useState("19:00");
  const [editVenue, setEditVenue] = useState("");
  const [editSelectedLocationIds, setEditSelectedLocationIds] = useState<string[]>([]);
  const [editDurationMinutes, setEditDurationMinutes] = useState("60");
  const [editStartsOn, setEditStartsOn] = useState("");
  const [editEndsOn, setEditEndsOn] = useState("");

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

  const computedCourtCount = useMemo(() => {
    return selectedLocationIds.reduce((sum, id) => {
      const loc = locations.find((l) => l.id === id);
      return sum + (loc?.court_count || 0);
    }, 0);
  }, [selectedLocationIds, locations]);

  const editComputedCourtCount = useMemo(() => {
    return editSelectedLocationIds.reduce((sum, id) => {
      const loc = locations.find((l) => l.id === id);
      return sum + (loc?.court_count || 0);
    }, 0);
  }, [editSelectedLocationIds, locations]);

  useEffect(() => {
    loadData();
  }, [leagueId]);

  async function loadData() {
    const supabase = createClient();
    const [gamesRes, teamsRes, patternsRes, playersRes, leagueRes, locationsRes] =
      await Promise.all([
        supabase.from("games").select("*").eq("league_id", leagueId).order("scheduled_at"),
        supabase.from("teams").select("*").eq("league_id", leagueId),
        supabase.from("game_day_patterns").select("*").eq("league_id", leagueId),
        supabase.from("players").select("*").eq("league_id", leagueId).order("name"),
        supabase.from("leagues").select("*").eq("id", leagueId).single(),
        supabase.from("locations").select("*").order("name"),
      ]);
    setGames((gamesRes.data || []) as Game[]);
    setTeams((teamsRes.data || []) as Team[]);
    setPatterns((patternsRes.data || []) as GameDayPattern[]);
    setPlayers((playersRes.data || []) as Player[]);
    if (leagueRes.data) setLeague(leagueRes.data as League);
    const locs = (locationsRes.data || []) as Location[];
    setLocations(locs);

    if (locs.length > 0) {
      const { data: unavailData } = await supabase
        .from("location_unavailability")
        .select("*")
        .in("location_id", locs.map((l) => l.id))
        .order("unavailable_date");
      setLocationUnavail((unavailData || []) as LocationUnavailability[]);
    }
    setLoading(false);
  }

  function toggleLocationId(locId: string) {
    setSelectedLocationIds((prev) =>
      prev.includes(locId) ? prev.filter((id) => id !== locId) : [...prev, locId]
    );
  }

  function toggleEditLocationId(locId: string) {
    setEditSelectedLocationIds((prev) =>
      prev.includes(locId) ? prev.filter((id) => id !== locId) : [...prev, locId]
    );
  }

  async function addPattern() {
    if (!startsOn) return;
    setAddingPattern(true);
    const supabase = createClient();
    const primaryLocationId = selectedLocationIds[0] || null;
    const courtCount = computedCourtCount || 1;
    const { data, error } = await supabase
      .from("game_day_patterns")
      .insert({
        league_id: leagueId,
        day_of_week: parseInt(dayOfWeek),
        start_time: startTime,
        venue: venue || null,
        court_count: courtCount,
        starts_on: startsOn,
        ends_on: endsOn || null,
        duration_minutes: parseInt(durationMinutes),
        location_id: primaryLocationId,
      })
      .select()
      .single();

    if (!error && data) {
      setPatterns([...patterns, data as GameDayPattern]);
    }
    setAddingPattern(false);
  }

  async function deletePattern(patternId: string) {
    const supabase = createClient();
    const { error } = await supabase.from("game_day_patterns").delete().eq("id", patternId);
    if (!error) {
      setPatterns(patterns.filter((p) => p.id !== patternId));
    }
    setConfirmDeletePattern(null);
  }

  function openEditPattern(p: GameDayPattern) {
    setEditingPattern(p);
    setEditDayOfWeek(p.day_of_week.toString());
    setEditStartTime(p.start_time);
    setEditVenue(p.venue || "");
    setEditDurationMinutes((p.duration_minutes || 60).toString());
    setEditSelectedLocationIds(p.location_id ? [p.location_id] : []);
    setEditStartsOn(p.starts_on);
    setEditEndsOn(p.ends_on || "");
  }

  async function saveEditPattern() {
    if (!editingPattern) return;
    const supabase = createClient();
    const primaryLocationId = editSelectedLocationIds[0] || null;
    const courtCount = editComputedCourtCount || 1;
    const { error } = await supabase
      .from("game_day_patterns")
      .update({
        day_of_week: parseInt(editDayOfWeek),
        start_time: editStartTime,
        venue: editVenue || null,
        court_count: courtCount,
        duration_minutes: parseInt(editDurationMinutes),
        location_id: primaryLocationId,
        starts_on: editStartsOn,
        ends_on: editEndsOn || null,
      })
      .eq("id", editingPattern.id);

    if (!error) {
      setPatterns(
        patterns.map((p) =>
          p.id === editingPattern.id
            ? {
                ...p,
                day_of_week: parseInt(editDayOfWeek),
                start_time: editStartTime,
                venue: editVenue || null,
                court_count: courtCount,
                duration_minutes: parseInt(editDurationMinutes),
                location_id: primaryLocationId,
                starts_on: editStartsOn,
                ends_on: editEndsOn || null,
              }
            : p
        )
      );
      setEditingPattern(null);
    }
  }

  function addSkipDate() {
    if (newSkipDate && !skipDates.includes(newSkipDate)) {
      setSkipDates([...skipDates, newSkipDate].sort());
      setNewSkipDate("");
    }
  }

  function removeSkipDate(date: string) {
    setSkipDates(skipDates.filter((d) => d !== date));
  }

  function addCommonHolidays() {
    const allStartsOn = patterns.map((p) => p.starts_on).filter((x): x is string => !!x);
    const allEndsOn = patterns.map((p) => p.ends_on).filter((x): x is string => !!x);
    const rangeStart = allStartsOn.length > 0 ? allStartsOn.sort()[0] : startsOn || formatYMD(new Date());
    const rangeEnd: string =
      allEndsOn.length > 0 ? allEndsOn.sort().reverse()[0] : `${new Date().getFullYear() + 1}-12-31`;
    const holidays = getUSHolidays(rangeStart, rangeEnd);
    const merged = Array.from(new Set([...skipDates, ...holidays])).sort();
    setSkipDates(merged);
  }

  function handleGenerateClick(patternId: string) {
    const hasScheduledGames = games.some((g) => g.status === "scheduled");
    if (hasScheduledGames) {
      setConfirmGenerate(patternId);
    } else {
      generateSchedule(patternId);
    }
  }

  function getLocationIdsForPattern(p: GameDayPattern): string[] {
    return p.location_id ? [p.location_id] : [];
  }

  async function generateSchedule(patternId: string) {
    setGenerating(true);
    setConfirmGenerate(null);
    const pattern = patterns.find((p) => p.id === patternId);
    // Use selectedLocationIds from form state if available, otherwise fall back to pattern's location
    const locationIds = selectedLocationIds.length > 0
      ? selectedLocationIds
      : pattern ? getLocationIdsForPattern(pattern) : [];

    const res = await fetch("/api/schedule/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leagueId,
        patternId,
        gamesPerTeam: parseInt(gamesPerTeam),
        matchupFrequency: parseInt(matchupFrequency),
        mixDivisions,
        skipDates,
        regenerateFrom: regenerateFrom || undefined,
        locationIds,
      }),
    });

    if (res.ok) {
      await loadData();
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
    setGames(games.map((g) => (g.id === gameId ? { ...g, status: "cancelled" as const } : g)));
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
      setGames(
        games.map((g) =>
          g.id === editingGameId
            ? { ...g, scheduled_at: scheduledAt.toISOString(), venue: editGameVenue || null, home_team_id: editHome, away_team_id: editAway }
            : g
        )
      );
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
      setGames(
        games.map((g) =>
          g.id === gameId ? { ...g, location_id: locationId, venue: loc.name } : g
        )
      );
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
      setGames(
        games.map((g) =>
          g.id === gameId ? { ...g, scheduled_at: newScheduledAt.toISOString() } : g
        )
      );
    }
  }

  async function cancelConflictedGame(gameId: string) {
    const supabase = createClient();
    const { error } = await supabase.from("games").update({ status: "cancelled" }).eq("id", gameId);
    if (!error) {
      setGames(games.map((g) => (g.id === gameId ? { ...g, status: "cancelled" as const } : g)));
    }
  }

  async function applyAllSuggestions() {
    setApplyingAll(true);
    const supabase = createClient();
    const updates: Game[] = [];
    for (const game of conflictedGames) {
      const suggested = getSuggestedLocation(game);
      if (suggested) {
        const { error } = await supabase
          .from("games")
          .update({ location_id: suggested.id, venue: suggested.name })
          .eq("id", game.id);
        if (!error) {
          updates.push({ ...game, location_id: suggested.id, venue: suggested.name });
        }
      }
    }
    if (updates.length > 0) {
      const updatedIds = new Set(updates.map((u) => u.id));
      setGames(
        games.map((g) => {
          const updated = updates.find((u) => u.id === g.id);
          return updated || g;
        })
      );
    }
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

  function renderLocationCheckboxes(selected: string[], toggle: (id: string) => void) {
    if (locations.length === 0) return null;
    return (
      <div className="space-y-2">
        <Label>Locations</Label>
        <div className="border rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto">
          {locations.map((loc) => (
            <label key={loc.id} className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(loc.id)}
                onChange={() => toggle(loc.id)}
                className="h-4 w-4 rounded border-input"
              />
              <span className="text-sm flex-1">{loc.name}</span>
              <span className="text-xs text-muted-foreground">
                {loc.court_count} {loc.court_count === 1 ? "court" : "courts"}
              </span>
            </label>
          ))}
        </div>
        {selected.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Total courts:{" "}
            {selected.reduce((sum, id) => {
              const loc = locations.find((l) => l.id === id);
              return sum + (loc?.court_count || 0);
            }, 0)}
          </p>
        )}
      </div>
    );
  }

  function renderDurationSelect(value: string, onChange: (v: string) => void) {
    return (
      <div className="space-y-2">
        <Label>Game duration</Label>
        <Select value={value} onValueChange={(v) => v && onChange(v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DURATION_OPTIONS.map((mins) => (
              <SelectItem key={mins} value={mins.toString()}>
                {mins} min
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
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
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 border rounded-lg p-3 bg-muted/30">
            <div className="space-y-1">
              <Label className="text-xs">Games per team per day</Label>
              <Select value={gamesPerTeam} onValueChange={(v) => v && setGamesPerTeam(v)}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((n) => (
                    <SelectItem key={n} value={n.toString()}>
                      {n} {n === 1 ? "game" : "games"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Play each team X times</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={matchupFrequency}
                onChange={(e) => setMatchupFrequency(e.target.value)}
                className="h-8"
              />
              <p className="text-[10px] text-muted-foreground leading-tight">
                If teams exceed available slots, some matchups may repeat.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Mix divisions</Label>
              <label className="flex items-center gap-2 h-8 cursor-pointer">
                <input
                  type="checkbox"
                  checked={mixDivisions}
                  onChange={(e) => setMixDivisions(e.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                <span className="text-xs text-muted-foreground">Cross-division play</span>
              </label>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Regenerate from</Label>
              <Input
                type="date"
                value={regenerateFrom}
                onChange={(e) => setRegenerateFrom(e.target.value)}
                className="h-8"
              />
            </div>
          </div>

          <div className="border rounded-lg p-3 space-y-3">
            <Label className="text-xs font-medium">Skip Dates (holidays / off weeks)</Label>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={newSkipDate}
                onChange={(e) => setNewSkipDate(e.target.value)}
                className="h-8 w-48"
              />
              <Button variant="outline" size="sm" onClick={addSkipDate} disabled={!newSkipDate}>
                Add
              </Button>
              <Button variant="outline" size="sm" onClick={addCommonHolidays}>
                Add common holidays
              </Button>
            </div>
            {skipDates.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {skipDates.map((date) => (
                  <Badge key={date} variant="secondary" className="gap-1">
                    {date}
                    <button onClick={() => removeSkipDate(date)} className="ml-0.5 hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {patterns.map((p) => {
            const patternLoc = p.location_id ? locationsMap.get(p.location_id) : null;
            const venueName = patternLoc ? patternLoc.name : p.venue || "No venue set";
            const upcomingUnavail = p.location_id
              ? locationUnavail.filter(
                  (u) =>
                    u.location_id === p.location_id &&
                    u.unavailable_date >= p.starts_on &&
                    (!p.ends_on || u.unavailable_date <= p.ends_on)
                )
              : [];

            return (
              <div key={p.id} className="flex items-center justify-between border rounded-lg p-3">
                <div>
                  <p className="font-medium">
                    {DAYS[p.day_of_week]}s at {p.start_time}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {venueName} &middot;{" "}
                    {p.court_count > 1 ? `${p.court_count} courts` : "1 court"} &middot;{" "}
                    {p.duration_minutes || 60} min games
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Starting {p.starts_on}
                    {p.ends_on && ` through ${p.ends_on}`}
                  </p>
                  {upcomingUnavail.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {upcomingUnavail.map((u) => (
                        <Badge
                          key={u.id}
                          variant="secondary"
                          className="text-xs text-amber-600 bg-amber-50 border-amber-200"
                        >
                          <AlertTriangle className="h-3 w-3 mr-0.5" />
                          Location unavailable: {u.unavailable_date}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground"
                    onClick={() => openEditPattern(p)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmDeletePattern(p.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    onClick={() => handleGenerateClick(p.id)}
                    disabled={generating || teams.length < 2}
                    size="sm"
                  >
                    <Zap className="h-4 w-4 mr-1" />
                    {generating ? "Generating..." : "Generate"}
                  </Button>
                </div>
              </div>
            );
          })}

          <Dialog>
            <DialogTrigger>
              <Button variant="outline" size="sm">
                Add Game Day
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Set Up Game Day</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Day of week</Label>
                    <Select value={dayOfWeek} onValueChange={(v) => v && setDayOfWeek(v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DAYS.map((day, i) => (
                          <SelectItem key={i} value={i.toString()}>
                            {day}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Start time</Label>
                    <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                  </div>
                </div>
                {renderLocationCheckboxes(selectedLocationIds, toggleLocationId)}
                <div className="space-y-2">
                  <Label>Venue override</Label>
                  <Input
                    value={venue}
                    onChange={(e) => setVenue(e.target.value)}
                    placeholder={selectedLocationIds.length > 0 ? "Override location name" : "South Sound YMCA"}
                  />
                </div>
                {renderDurationSelect(durationMinutes, setDurationMinutes)}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>First game date</Label>
                    <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Last game date (optional)</Label>
                    <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
                  </div>
                </div>
                <Button onClick={addPattern} disabled={addingPattern || !startsOn} className="w-full">
                  {addingPattern ? "Saving..." : "Save Game Day"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      <Dialog open={!!confirmGenerate} onOpenChange={(open) => !open && setConfirmGenerate(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Regenerate Schedule?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {regenerateFrom
              ? `This will replace all scheduled (unplayed) games from ${regenerateFrom} onward. Completed game results will be kept. This cannot be undone.`
              : "This will replace all currently scheduled (unplayed) games. Completed game results will be kept. This cannot be undone."}
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmGenerate(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => confirmGenerate && generateSchedule(confirmGenerate)}>
              Replace Schedule
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDeletePattern} onOpenChange={(open) => !open && setConfirmDeletePattern(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Delete Game Day Pattern?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will remove this game day pattern. Previously generated games will not be affected. This cannot be
            undone.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmDeletePattern(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => confirmDeletePattern && deletePattern(confirmDeletePattern)}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingPattern} onOpenChange={(open) => !open && setEditingPattern(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Game Day</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Day of week</Label>
                <Select value={editDayOfWeek} onValueChange={(v) => v && setEditDayOfWeek(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS.map((day, i) => (
                      <SelectItem key={i} value={i.toString()}>
                        {day}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Start time</Label>
                <Input type="time" value={editStartTime} onChange={(e) => setEditStartTime(e.target.value)} />
              </div>
            </div>
            {renderLocationCheckboxes(editSelectedLocationIds, toggleEditLocationId)}
            <div className="space-y-2">
              <Label>Venue override</Label>
              <Input
                value={editVenue}
                onChange={(e) => setEditVenue(e.target.value)}
                placeholder="South Sound YMCA"
              />
            </div>
            {renderDurationSelect(editDurationMinutes, setEditDurationMinutes)}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>First game date</Label>
                <Input type="date" value={editStartsOn} onChange={(e) => setEditStartsOn(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Last game date (optional)</Label>
                <Input type="date" value={editEndsOn} onChange={(e) => setEditEndsOn(e.target.value)} />
              </div>
            </div>
            <Button onClick={saveEditPattern} disabled={!editStartsOn} className="w-full">
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
                                      <SelectItem key={t.id} value={t.id} label={t.name}>
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
                                      <SelectItem key={t.id} value={t.id} label={t.name}>
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
                          <div>
                            <span className="text-sm font-medium">
                              {teamsMap.get(game.home_team_id)?.name} vs {teamsMap.get(game.away_team_id)?.name}
                            </span>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(game.scheduled_at), "EEE, MMM d 'at' h:mm a")}
                              {game.location_id && locationsMap.get(game.location_id)?.name
                                ? ` — ${locationsMap.get(game.location_id)!.name}`
                                : game.venue
                                  ? ` — ${game.venue}`
                                  : ""}
                              {game.court && ` (${game.court})`}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            {game.status === "cancelled" ? (
                              <Badge variant="destructive">Cancelled</Badge>
                            ) : game.status === "completed" ? (
                              <Badge>
                                {game.home_score} - {game.away_score}
                              </Badge>
                            ) : (
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
                            )}
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
                            <SelectItem key={loc.id} value={loc.id} label={loc.name}>
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
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
