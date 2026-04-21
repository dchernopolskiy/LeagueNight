import { localToUTCISO } from "@/lib/scheduling/date-utils";
import type { LocationAssignedGame, LocationCourtSlot } from "@/lib/scheduling/location-assignment";
import type { WeekFillScheduledGame } from "@/lib/scheduling/week-fill";

export type SchedulerEngine = "greedy" | "solver";

export type ScheduleGameInsert = {
  league_id: string;
  home_team_id: string;
  away_team_id: string;
  scheduled_at: string;
  venue: string | null;
  court: string | null;
  week_number: number;
  status: "scheduled";
  location_id: string | null;
  preference_applied: unknown;
  scheduling_notes: string | null;
};

export function validateGenerateRequest(input: {
  leagueId: unknown;
  patternId: unknown;
  gamesPerTeam: unknown;
  gamesPerSession: unknown;
  matchupFrequency: unknown;
  engine?: unknown;
}): string | null {
  if (typeof input.leagueId !== "string" || input.leagueId.length === 0) {
    return "leagueId is required";
  }
  if (typeof input.patternId !== "string" || input.patternId.length === 0) {
    return "patternId is required";
  }
  if (!isPositiveInteger(input.gamesPerTeam)) {
    return "gamesPerTeam must be a positive integer";
  }
  if (!isPositiveInteger(input.gamesPerSession)) {
    return "gamesPerSession must be a positive integer";
  }
  if (!isPositiveInteger(input.matchupFrequency)) {
    return "matchupFrequency must be a positive integer";
  }
  if (
    input.engine !== undefined &&
    input.engine !== "greedy" &&
    input.engine !== "solver"
  ) {
    return "engine must be either greedy or solver";
  }
  return null;
}

export function formatLocationSplitWarning(splitCount: number): string {
  return `${splitCount} team-night${splitCount === 1 ? "" : "s"} had to be split across locations because no single venue had enough available courts.`;
}

export function buildCourtSlots(
  locationIds: string[],
  locationsMap: Map<string, { id: string; name: string; court_count: number }>
): LocationCourtSlot[] {
  const courtSlots: LocationCourtSlot[] = [];
  for (const locId of locationIds) {
    const loc = locationsMap.get(locId);
    if (!loc) continue;
    for (let c = 1; c <= loc.court_count; c++) {
      courtSlots.push({
        locationId: locId,
        courtNum: c,
        locationName: loc.name,
        totalCourts: loc.court_count,
      });
    }
  }
  return courtSlots;
}

export function toAssignedGamesInsertRows(input: {
  leagueId: string;
  timezone: string;
  games: LocationAssignedGame[];
}): ScheduleGameInsert[] {
  return input.games.map((g) => ({
    league_id: input.leagueId,
    home_team_id: g.home,
    away_team_id: g.away,
    scheduled_at: localToUTCISO(g.scheduledAt, input.timezone),
    venue: g.locationName,
    court: g.totalCourts > 1 ? `Court ${g.courtNum}` : null,
    week_number: g.weekNumber,
    status: "scheduled",
    location_id: g.locationId,
    preference_applied: g.preferenceApplied || null,
    scheduling_notes: g.schedulingNotes || null,
  }));
}

export function toScheduledGamesInsertRows(input: {
  leagueId: string;
  timezone: string;
  games: WeekFillScheduledGame[];
  defaultLocationId: string | null;
}): ScheduleGameInsert[] {
  return input.games.map((g) => ({
    league_id: input.leagueId,
    home_team_id: g.home,
    away_team_id: g.away,
    scheduled_at: localToUTCISO(g.scheduledAt, input.timezone),
    venue: g.venue,
    court: g.court,
    week_number: g.weekNumber,
    status: "scheduled",
    location_id: g.locationId ?? input.defaultLocationId,
    preference_applied: g.preferenceApplied || null,
    scheduling_notes: g.schedulingNotes || null,
  }));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
