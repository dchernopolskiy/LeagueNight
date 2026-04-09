"use client";

import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  format,
  isAfter,
  isBefore,
  startOfDay,
  addDays,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  isSameMonth,
  isSameDay,
  addWeeks,
} from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List as ListIcon,
  X,
} from "lucide-react";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import type { Game, League, Team, Location, LocationUnavailability, OpenGymSession } from "@/lib/types";

interface CalendarFiltersProps {
  games: Game[];
  leagues: League[];
  teams: Team[];
  locations?: Location[];
  locationUnavailability?: LocationUnavailability[];
  openGymSessions?: OpenGymSession[];
}

type DateRange = "week" | "2weeks" | "month" | "all";
type ViewMode = "calendar" | "list";

/** Short sport prefix for calendar cell labels */
const SPORT_ABBREV: Record<string, string> = {
  Volleyball: "VB",
  Basketball: "BB",
  Pickleball: "PB",
  Soccer: "SC",
  Tennis: "TN",
  Baseball: "BA",
  Football: "FB",
};

function sportAbbrev(sport: string | null): string {
  if (!sport) return "";
  return SPORT_ABBREV[sport] || sport.slice(0, 2).toUpperCase();
}

/** Shorten team name for game lines: "Slam Dunkers" → "SD" */
function teamInitials(name: string | undefined): string {
  if (!name) return "?";
  return name.split(/\s+/).map((w) => w[0]).join("").toUpperCase();
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Group games by league, returning league-level event blocks for a single day */
interface LeagueBlock {
  league: League;
  location: Location | null;
  games: Game[];
  hasConflict: boolean;
}

export function CalendarView({ games, leagues, teams, locations = [], locationUnavailability = [], openGymSessions = [] }: CalendarFiltersProps) {
  const [sportFilter, setSportFilter] = useState<string>("all");
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const leaguesMap = useMemo(
    () => new Map(leagues.map((l) => [l.id, l])),
    [leagues]
  );
  const teamsMap = useMemo(
    () => new Map(teams.map((t) => [t.id, t])),
    [teams]
  );
  const locationsMap = useMemo(
    () => new Map(locations.map((l) => [l.id, l])),
    [locations]
  );

  const sports = useMemo(() => {
    const set = new Set<string>();
    for (const l of leagues) {
      if (l.sport) set.add(l.sport);
    }
    return [...set].sort();
  }, [leagues]);

  // Games filtered by sport/league only (no date range filtering for calendar view)
  const baseFilteredGames = useMemo(() => {
    return games.filter((g) => {
      if (sportFilter !== "all") {
        const league = leaguesMap.get(g.league_id);
        if (league?.sport !== sportFilter) return false;
      }
      if (leagueFilter !== "all" && g.league_id !== leagueFilter) return false;
      return true;
    });
  }, [games, sportFilter, leagueFilter, leaguesMap]);

  // Games filtered with date range (for list view)
  const filteredGames = useMemo(() => {
    const today = startOfDay(new Date());
    let rangeEnd: Date | null = null;
    if (dateRange === "week") rangeEnd = addDays(today, 7);
    else if (dateRange === "2weeks") rangeEnd = addDays(today, 14);
    else if (dateRange === "month") rangeEnd = addMonths(today, 1);

    return baseFilteredGames.filter((g) => {
      const gameDate = new Date(g.scheduled_at);
      if (isBefore(gameDate, today)) return false;
      if (rangeEnd && isAfter(gameDate, rangeEnd)) return false;
      return true;
    });
  }, [baseFilteredGames, dateRange]);

  // Group by date (list view)
  const groupedByDate = useMemo(() => {
    const map = new Map<string, Game[]>();
    for (const g of filteredGames) {
      const key = format(new Date(g.scheduled_at), "yyyy-MM-dd");
      const arr = map.get(key) || [];
      arr.push(g);
      map.set(key, arr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredGames]);

  // Calendar grid days
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const calStart = startOfWeek(monthStart);
    const calEnd = endOfWeek(monthEnd);

    const days: Date[] = [];
    let day = calStart;
    while (isBefore(day, addDays(calEnd, 1))) {
      days.push(day);
      day = addDays(day, 1);
    }
    return days;
  }, [currentMonth]);

  // Map date strings to games for the calendar
  const gamesByDate = useMemo(() => {
    const map = new Map<string, Game[]>();
    for (const g of baseFilteredGames) {
      const key = format(new Date(g.scheduled_at), "yyyy-MM-dd");
      const arr = map.get(key) || [];
      arr.push(g);
      map.set(key, arr);
    }
    return map;
  }, [baseFilteredGames]);

  // Expand open gym sessions into concrete dates
  const openGymByDate = useMemo(() => {
    const map = new Map<string, OpenGymSession[]>();
    const now = new Date();
    for (const session of openGymSessions) {
      if (session.specific_date) {
        const key = session.specific_date;
        const arr = map.get(key) || [];
        arr.push(session);
        map.set(key, arr);
        continue;
      }

      if (session.day_of_week === null || session.day_of_week === undefined) continue;

      const start = session.recurring_start
        ? new Date(session.recurring_start + "T12:00:00")
        : now;
      const end = session.recurring_end
        ? new Date(session.recurring_end + "T12:00:00")
        : addWeeks(now, 26);

      // Walk through the visible calendar range (expand generously: 6 months)
      let current = new Date(start);
      const dayDiff = (session.day_of_week - current.getDay() + 7) % 7;
      current = addDays(current, dayDiff === 0 ? 0 : dayDiff);

      while (!isAfter(current, end)) {
        const key = format(current, "yyyy-MM-dd");
        const arr = map.get(key) || [];
        arr.push(session);
        map.set(key, arr);
        current = addDays(current, 7);
      }
    }
    return map;
  }, [openGymSessions]);

  const unavailSet = useMemo(() => {
    const set = new Set<string>();
    for (const u of locationUnavailability) {
      set.add(`${u.location_id}:${u.unavailable_date}`);
    }
    return set;
  }, [locationUnavailability]);

  function isGameConflict(game: Game): boolean {
    if (!game.location_id || game.status !== "scheduled") return false;
    const gameDate = format(new Date(game.scheduled_at), "yyyy-MM-dd");
    return unavailSet.has(`${game.location_id}:${gameDate}`);
  }

  /** Group a day's games into league-level blocks */
  function getLeagueBlocks(dayGames: Game[]): LeagueBlock[] {
    const blockMap = new Map<string, { games: Game[]; league: League }>();
    for (const g of dayGames) {
      const league = leaguesMap.get(g.league_id);
      if (!league) continue;
      const existing = blockMap.get(g.league_id);
      if (existing) {
        existing.games.push(g);
      } else {
        blockMap.set(g.league_id, { league, games: [g] });
      }
    }

    const blocks: LeagueBlock[] = [];
    for (const { league, games: blockGames } of blockMap.values()) {
      // Pick the primary location (most common among these games)
      const locCounts = new Map<string, number>();
      for (const g of blockGames) {
        if (g.location_id) {
          locCounts.set(g.location_id, (locCounts.get(g.location_id) || 0) + 1);
        }
      }
      let primaryLocId: string | null = null;
      let maxCount = 0;
      for (const [locId, count] of locCounts) {
        if (count > maxCount) { primaryLocId = locId; maxCount = count; }
      }
      const location = primaryLocId ? locationsMap.get(primaryLocId) || null : null;

      const hasConflict = blockGames.some((g) => isGameConflict(g));

      blocks.push({ league, location, games: blockGames, hasConflict });
    }

    // Sort by sport then league name
    blocks.sort((a, b) => {
      const sa = a.league.sport || "";
      const sb = b.league.sport || "";
      if (sa !== sb) return sa.localeCompare(sb);
      return a.league.name.localeCompare(b.league.name);
    });

    return blocks;
  }

  /** Selected day — games grouped by sport → league */
  const selectedDayBlocks = useMemo(() => {
    if (!selectedDay) return [];
    const key = format(selectedDay, "yyyy-MM-dd");
    const dayGames = (gamesByDate.get(key) || []).sort(
      (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
    );
    return getLeagueBlocks(dayGames);
  }, [selectedDay, gamesByDate]);

  const today = startOfDay(new Date());

  /** Color palette for league event blocks in calendar cells */
  const SPORT_COLORS: Record<string, string> = {
    Volleyball: "bg-blue-100 text-blue-900 border-blue-200",
    Basketball: "bg-orange-100 text-orange-900 border-orange-200",
    Pickleball: "bg-emerald-100 text-emerald-900 border-emerald-200",
    Soccer: "bg-green-100 text-green-900 border-green-200",
    Tennis: "bg-yellow-100 text-yellow-900 border-yellow-200",
    Baseball: "bg-red-100 text-red-900 border-red-200",
    Football: "bg-purple-100 text-purple-900 border-purple-200",
  };

  function blockColor(sport: string | null): string {
    if (!sport) return "bg-muted text-foreground";
    return SPORT_COLORS[sport] || "bg-muted text-foreground";
  }

  function renderGameCard(game: Game) {
    const league = leaguesMap.get(game.league_id);
    const home = teamsMap.get(game.home_team_id);
    const away = teamsMap.get(game.away_team_id);
    const conflict = isGameConflict(game);
    return (
      <Card key={game.id} className={conflict ? "border-amber-300 bg-amber-50/50" : undefined}>
        <CardContent className="flex items-center justify-between py-3 px-4">
          <div className="flex items-center gap-3">
            {conflict && (
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            )}
            {league && (
              <Badge variant="secondary" className="text-xs shrink-0">
                {league.name}
              </Badge>
            )}
            <span className={`text-sm font-medium ${conflict ? "text-amber-800" : ""}`}>
              {home?.name ?? "TBD"} vs {away?.name ?? "TBD"}
            </span>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p>{format(new Date(game.scheduled_at), "h:mm a")}</p>
            {game.location_id && locationsMap.get(game.location_id) ? (
              <p className={conflict ? "text-amber-600 line-through" : ""}>
                {locationsMap.get(game.location_id)!.name}
              </p>
            ) : game.venue ? (
              <p>{game.venue}</p>
            ) : null}
            {game.court && <p>{game.court}</p>}
            {conflict && (
              <p className="text-amber-600 font-medium text-[10px]">Location unavailable</p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  /** Short location label for calendar cells */
  function shortLocName(name: string): string {
    // "Reeves Middle School" → "Reeves", "South Sound YMCA" → "SS YMCA"
    const parts = name.split(/\s+/);
    if (parts.length <= 2) return name;
    // Return first word only if it's a proper noun-ish name
    return parts[0];
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {sports.length > 0 && (
          <Select value={sportFilter} onValueChange={(v) => v && setSportFilter(v)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All Sports" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sports</SelectItem>
              {sports.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select value={leagueFilter} onValueChange={(v) => v && setLeagueFilter(v)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Leagues" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Leagues</SelectItem>
            {leagues.map((l) => (
              <SelectItem key={l.id} value={l.id} label={l.name}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {viewMode === "list" && (
          <Select value={dateRange} onValueChange={(v) => v && setDateRange(v as DateRange)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="2weeks">Next 2 Weeks</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="all">All Upcoming</SelectItem>
            </SelectContent>
          </Select>
        )}

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant={viewMode === "calendar" ? "default" : "ghost"}
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setViewMode("calendar")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "default" : "ghost"}
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setViewMode("list")}
          >
            <ListIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {viewMode === "calendar" ? (
        <div className="space-y-4">
          {/* Month navigation */}
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h2 className="text-lg font-semibold">
              {format(currentMonth, "MMMM yyyy")}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
            {/* Day headers */}
            {DAY_LABELS.map((label) => (
              <div
                key={label}
                className="bg-muted px-2 py-1.5 text-center text-xs font-medium text-muted-foreground"
              >
                {label}
              </div>
            ))}

            {/* Day cells */}
            {calendarDays.map((day) => {
              const dateKey = format(day, "yyyy-MM-dd");
              const dayGames = (gamesByDate.get(dateKey) || []).sort(
                (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
              );
              const isCurrentMonth = isSameMonth(day, currentMonth);
              const isToday = isSameDay(day, today);
              const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;

              // Group into league blocks for the cell
              const blocks = getLeagueBlocks(dayGames);
              const MAX_BLOCK_LINES = 4; // Show up to 4 league event blocks
              const visibleBlocks = blocks.slice(0, MAX_BLOCK_LINES);
              // After the league blocks, show a few individual game lines
              const MAX_GAME_LINES = 2;
              const allVisibleGames = visibleBlocks.flatMap((b) => b.games);
              const gameLines = allVisibleGames.slice(0, MAX_GAME_LINES);

              // Open gym sessions for this day
              const dayOpenGym = openGymByDate.get(dateKey) || [];

              return (
                <div
                  key={dateKey}
                  className={`bg-background min-h-[110px] p-1.5 text-left transition-colors align-top ${
                    !isCurrentMonth ? "opacity-40" : ""
                  } ${isSelected ? "ring-2 ring-primary ring-inset" : ""}`}
                >
                  {/* Date number — clickable to expand day panel */}
                  <button
                    type="button"
                    className="hover:bg-accent rounded-full transition-colors"
                    onClick={() => {
                      if (dayGames.length > 0 || dayOpenGym.length > 0) {
                        setSelectedDay(isSelected ? null : day);
                      }
                    }}
                  >
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                        isToday
                          ? "bg-primary text-primary-foreground font-bold"
                          : "font-medium"
                      }`}
                    >
                      {format(day, "d")}
                    </span>
                  </button>

                  {/* League event blocks */}
                  {visibleBlocks.length > 0 && (
                    <div className="mt-0.5 space-y-0.5">
                      {visibleBlocks.map((block) => {
                        const color = block.hasConflict
                          ? "bg-amber-100 text-amber-800 border-amber-300"
                          : blockColor(block.league.sport);
                        const locLabel = block.location
                          ? shortLocName(block.location.name)
                          : null;
                        return (
                          <Link
                            key={block.league.id}
                            href={`/dashboard/leagues/${block.league.id}/schedule`}
                            className={`block rounded border px-1 py-0.5 text-[10px] leading-tight truncate font-medium hover:opacity-80 transition-opacity ${color}`}
                            onClick={(e) => e.stopPropagation()}
                            title={`${block.league.sport || ""} ${block.league.name}${locLabel ? ` at ${block.location!.name}` : ""} — ${block.games.length} game${block.games.length !== 1 ? "s" : ""}`}
                          >
                            {sportAbbrev(block.league.sport)} {block.league.name}
                            {locLabel && <span className="font-normal">, {locLabel}</span>}
                          </Link>
                        );
                      })}

                      {/* Individual game lines under the blocks */}
                      {gameLines.map((g) => {
                        const home = teamsMap.get(g.home_team_id);
                        const away = teamsMap.get(g.away_team_id);
                        return (
                          <div
                            key={g.id}
                            className="text-[10px] leading-tight text-muted-foreground truncate pl-0.5"
                          >
                            <span className="text-foreground font-medium">
                              {format(new Date(g.scheduled_at), "h:mm")}
                            </span>{" "}
                            {teamInitials(home?.name)} v {teamInitials(away?.name)}
                          </div>
                        );
                      })}

                    </div>
                  )}

                  {/* Open gym session blocks */}
                  {dayOpenGym.length > 0 && (
                    <div className={visibleBlocks.length > 0 ? "space-y-0.5" : "mt-0.5 space-y-0.5"}>
                      {dayOpenGym.map((session) => (
                        <Link
                          key={session.id}
                          href="/dashboard/open-gym"
                          className="block rounded border px-1 py-0.5 text-[10px] leading-tight truncate font-medium hover:opacity-80 transition-opacity bg-indigo-100 text-indigo-900 border-indigo-200"
                          onClick={(e) => e.stopPropagation()}
                          title={`${session.title} · ${session.start_time.slice(0, 5)}–${session.end_time.slice(0, 5)}`}
                        >
                          {session.title}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Expanded day panel — full schedule grouped by sport/league */}
          {selectedDay && (
            <Card>
              <CardContent className="py-4 px-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-semibold">
                    {format(selectedDay, "EEEE, MMMM d, yyyy")}
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => setSelectedDay(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                {selectedDayBlocks.length === 0 && (() => {
                  const key = format(selectedDay, "yyyy-MM-dd");
                  return (openGymByDate.get(key) || []).length === 0;
                })() ? (
                  <p className="text-sm text-muted-foreground">No events on this day</p>
                ) : (
                  <div className="space-y-5">
                    {/* Group blocks by sport */}
                    {(() => {
                      const sportGroups = new Map<string, LeagueBlock[]>();
                      for (const block of selectedDayBlocks) {
                        const sport = block.league.sport || "Other";
                        const arr = sportGroups.get(sport) || [];
                        arr.push(block);
                        sportGroups.set(sport, arr);
                      }
                      return [...sportGroups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([sport, sportBlocks]) => (
                        <div key={sport}>
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                            {sport}
                          </h4>
                          <div className="space-y-4">
                            {sportBlocks.map((block) => (
                              <div key={block.league.id}>
                                <div className="flex items-center gap-2 mb-1.5">
                                  <Link
                                    href={`/dashboard/leagues/${block.league.id}/schedule`}
                                    className="text-sm font-semibold hover:underline"
                                  >
                                    {block.league.name}
                                  </Link>
                                  {block.location && (
                                    <span className="text-xs text-muted-foreground">
                                      at {block.location.name}
                                    </span>
                                  )}
                                  <Badge variant="outline" className="text-[10px] ml-auto">
                                    {block.games.length} game{block.games.length !== 1 ? "s" : ""}
                                  </Badge>
                                </div>
                                <div className="space-y-1 pl-2 border-l-2 border-muted">
                                  {block.games
                                    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
                                    .map((game) => {
                                      const home = teamsMap.get(game.home_team_id);
                                      const away = teamsMap.get(game.away_team_id);
                                      const conflict = isGameConflict(game);
                                      const loc = game.location_id ? locationsMap.get(game.location_id) : null;
                                      return (
                                        <div
                                          key={game.id}
                                          className={`flex items-center justify-between py-1 px-2 rounded text-sm ${
                                            conflict ? "bg-amber-50" : "hover:bg-muted/50"
                                          }`}
                                        >
                                          <div className="flex items-center gap-2">
                                            {conflict && (
                                              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                                            )}
                                            <span className="text-xs text-muted-foreground w-14 shrink-0">
                                              {format(new Date(game.scheduled_at), "h:mm a")}
                                            </span>
                                            <span className="font-medium">
                                              {home?.name ?? "TBD"}
                                            </span>
                                            <span className="text-muted-foreground">vs</span>
                                            <span className="font-medium">
                                              {away?.name ?? "TBD"}
                                            </span>
                                          </div>
                                          <div className="text-right text-xs text-muted-foreground">
                                            {loc && (
                                              <span className={conflict ? "text-amber-600 line-through" : ""}>
                                                {loc.name}
                                              </span>
                                            )}
                                            {game.court && <span className="ml-1">({game.court})</span>}
                                            {game.status === "cancelled" && (
                                              <Badge variant="destructive" className="ml-1 text-[10px]">Cancelled</Badge>
                                            )}
                                            {game.status === "completed" && (
                                              <Badge className="ml-1 text-[10px]">
                                                {game.home_score}-{game.away_score}
                                              </Badge>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ));
                    })()}

                    {/* Open gym sessions */}
                    {(() => {
                      const key = format(selectedDay, "yyyy-MM-dd");
                      const daySessions = openGymByDate.get(key) || [];
                      if (daySessions.length === 0) return null;
                      return (
                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                            Open Gym
                          </h4>
                          <div className="space-y-1 pl-2 border-l-2 border-indigo-200">
                            {daySessions.map((session) => {
                              const loc = session.location_id ? locationsMap.get(session.location_id) : null;
                              return (
                                <Link
                                  key={session.id}
                                  href="/dashboard/open-gym"
                                  className="flex items-center justify-between py-1 px-2 rounded text-sm hover:bg-muted/50"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground w-14 shrink-0">
                                      {session.start_time.slice(0, 5)}
                                    </span>
                                    <span className="font-medium text-indigo-900">
                                      {session.title}
                                    </span>
                                    {session.sport && (
                                      <Badge variant="outline" className="text-[10px]">
                                        {session.sport}
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="text-right text-xs text-muted-foreground">
                                    {loc && <span>{loc.name}</span>}
                                  </div>
                                </Link>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        /* List view */
        <>
          {groupedByDate.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">
              No upcoming games across your leagues
            </p>
          ) : (
            groupedByDate.map(([dateKey, dateGames]) => (
              <div key={dateKey}>
                <h2 className="text-sm font-semibold text-muted-foreground mb-2">
                  {format(new Date(dateKey + "T12:00:00"), "EEEE, MMMM d")}
                </h2>
                <div className="space-y-2">
                  {dateGames.map((game) => renderGameCard(game))}
                </div>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
