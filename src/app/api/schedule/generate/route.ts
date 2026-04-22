import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/supabase/helpers";
import { fillScheduleByWeek, schedulePreflight } from "@/lib/scheduling/week-fill";
import { solveSchedule } from "@/lib/scheduling/solver";
import { localToUTCISO, parseLocalDate } from "@/lib/scheduling/date-utils";
import { computeReseedPools, type ReseedMode } from "@/lib/scheduling/reseed";
import {
  assignGamesToLocationCourtSlots,
  findSameNightLocationSplits,
} from "@/lib/scheduling/location-assignment";
import {
  buildCourtSlots,
  formatLocationSplitWarning,
  type SchedulerEngine,
  toAssignedGamesInsertRows,
  toScheduledGamesInsertRows,
  validateGenerateRequest,
} from "../_shared";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type LocalSchedulerResult = Awaited<ReturnType<typeof fillScheduleByWeek>>;
type SolverSchedulerResult = Awaited<ReturnType<typeof solveSchedule>>;
type RouteSchedulerResult = LocalSchedulerResult | SolverSchedulerResult;

type SchedulerServicePreferences = {
  home_team?: string[];
  away_team?: string[];
};

type SchedulerServiceResponse = {
  status: "ok" | "partial" | "infeasible";
  games: Array<{
    home_team_id: string;
    away_team_id: string;
    scheduled_at: string;
    venue_id: string | null;
    court_number: number;
    week_number: number;
    preferences_honored?: SchedulerServicePreferences | null;
    scheduling_notes?: string | null;
  }>;
  byes: Array<{
    team_id: string;
    date: string;
    week_number: number;
    back_to_back: boolean;
  }>;
  dropped_pairs: Array<{
    team_a_id: string;
    team_b_id: string;
    missed_count: number;
    reason: string;
  }>;
  diagnostics: {
    target_weeks: number;
    available_weeks: number;
    solver_wall_time_ms: number;
    objective: number;
    notes: string[];
  };
};

export async function POST(request: NextRequest) {
  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    leagueId,
    patternId,
    gamesPerTeam = 1,
    gamesPerSession = 1,
    matchupFrequency = 1,
    mixDivisions = false,
    skipDates = [],
    regenerateFrom,
    locationIds = [],
    acceptTruncation = false,
    reseedMode,
    engine = "service",
  }: {
    leagueId: string;
    patternId: string;
    gamesPerTeam?: number;
    gamesPerSession?: number;
    matchupFrequency?: number;
    mixDivisions?: boolean;
    skipDates?: string[];
    regenerateFrom?: string;
    locationIds?: string[];
    acceptTruncation?: boolean;
    reseedMode?: ReseedMode;
    engine?: SchedulerEngine;
  } = body;

  const validationError = validateGenerateRequest({
    leagueId,
    patternId,
    gamesPerTeam,
    gamesPerSession,
    matchupFrequency,
    engine,
  });
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const supabase = createAdminClient();
  const pairKeyFn = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  // Authorization
  const { data: league } = await supabase
    .from("leagues")
    .select("id")
    .eq("id", leagueId)
    .eq("organizer_id", profile.id)
    .single();
  if (!league) {
    const { data: staffEntry } = await supabase
      .from("league_staff")
      .select("id")
      .eq("league_id", leagueId)
      .eq("profile_id", profile.id)
      .single();
    if (!staffEntry) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }
  }

  const { data: leagueInfo } = await supabase
    .from("leagues")
    .select("timezone, organizer_id")
    .eq("id", leagueId)
    .single();
  const timezone = leagueInfo?.timezone || "America/New_York";

  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, division_id, preferences")
    .eq("league_id", leagueId);
  if (!teams || teams.length < 2) {
    return NextResponse.json({ error: "Need at least 2 teams" }, { status: 400 });
  }

  const { data: divisions } = await supabase
    .from("divisions")
    .select("id, name")
    .eq("league_id", leagueId);

  const { data: crossPlayRules } = await supabase
    .from("division_cross_play")
    .select("*")
    .eq("league_id", leagueId);

  const { data: pattern } = await supabase
    .from("game_day_patterns")
    .select("*")
    .eq("id", patternId)
    .eq("league_id", leagueId)
    .single();
  if (!pattern) {
    return NextResponse.json({ error: "Game day pattern not found" }, { status: 404 });
  }

  const effectiveLocationIds: string[] =
    locationIds.length > 0 ? locationIds : pattern.location_ids || [];

  let locationsData: { id: string; name: string; court_count: number }[] = [];
  if (effectiveLocationIds.length > 0) {
    const { data: locsData } = await supabase
      .from("locations")
      .select("id, name, court_count")
      .eq("organizer_id", leagueInfo?.organizer_id)
      .in("id", effectiveLocationIds);
    locationsData = locsData || [];
    if (locationsData.length !== effectiveLocationIds.length) {
      return NextResponse.json(
        { error: "One or more selected locations are invalid for this league" },
        { status: 400 }
      );
    }
  }
  const locationsMap = new Map(locationsData.map((l) => [l.id, l]));

  const unavailByDate = new Map<string, Set<string>>();
  if (effectiveLocationIds.length > 0) {
    const { data: unavailData } = await supabase
      .from("location_unavailability")
      .select("location_id, unavailable_date")
      .in("location_id", effectiveLocationIds);
    for (const u of unavailData || []) {
      const s = unavailByDate.get(u.unavailable_date) || new Set<string>();
      s.add(u.location_id);
      unavailByDate.set(u.unavailable_date, s);
    }
  }
  const fullyUnavailDates: string[] = [];
  for (const [date, locs] of unavailByDate) {
    if (effectiveLocationIds.every((id) => locs.has(id))) {
      fullyUnavailDates.push(date);
    }
  }
  const mergedSkipDates = Array.from(new Set([...skipDates, ...fullyUnavailDates]));

  // Existing matchups (for regeneration)
  const existingMatchupCounts = new Map<string, number>();
  let regenerateFromDate: Date | null = null;
  let unplayedBeforeRegenCount = 0;
  if (regenerateFrom) {
    regenerateFromDate = parseLocalDate(regenerateFrom);
    const regenerationIso = localToUTCISO(regenerateFromDate, timezone);
    const { data: existingGames } = await supabase
      .from("games")
      .select("home_team_id, away_team_id, status")
      .eq("league_id", leagueId)
      .eq("is_playoff", false)
      .lt("scheduled_at", regenerationIso);
    if (existingGames) {
      for (const g of existingGames) {
        const k = pairKeyFn(g.home_team_id, g.away_team_id);
        existingMatchupCounts.set(k, (existingMatchupCounts.get(k) || 0) + 1);
        if (g.status === "scheduled") unplayedBeforeRegenCount++;
      }
    }
  }

  // Hard block: re-seed requires all games before regen date to be completed.
  if (reseedMode && regenerateFrom && unplayedBeforeRegenCount > 0) {
    return NextResponse.json(
      {
        error: "reseed_blocked_unplayed_games",
        unplayedCount: unplayedBeforeRegenCount,
        regenerateFrom,
        message: `Cannot re-seed — ${unplayedBeforeRegenCount} scheduled game${unplayedBeforeRegenCount === 1 ? "" : "s"} before ${regenerateFrom} ${unplayedBeforeRegenCount === 1 ? "is" : "are"} not yet completed. Standings reflect only completed games, so re-seeding now would produce inaccurate pools. Complete those games (or reschedule them past the re-seed date), then try again.`,
      },
      { status: 409 }
    );
  }

  // Re-seed: remap teams into new pools based on standings.
  let reseedTeamDivisionOverride: Map<string, string> | null = null;
  let reseedCrossPlayOverride: Array<{ division_a_id: string; division_b_id: string }> | null = null;
  let reseedTeamWeights: Map<string, number> | null = null;
  if (reseedMode && regenerateFrom) {
    const { data: standings } = await supabase
      .from("standings")
      .select("*")
      .eq("league_id", leagueId);
    const { data: leagueFull } = await supabase
      .from("leagues")
      .select("settings")
      .eq("id", leagueId)
      .single();

    const reseed = computeReseedPools(
      teams,
      standings || [],
      divisions || [],
      leagueFull?.settings || {},
      reseedMode
    );

    reseedTeamDivisionOverride = reseed.teamPool;
    // No cross-play in re-seed mode: each team only plays others in same pool.
    reseedCrossPlayOverride = [];
    // Pass raw weights to the fill algorithm for skill-alignment scoring.
    reseedTeamWeights = new Map();
    for (const [tid, w] of reseed.teamWeights) {
      reseedTeamWeights.set(tid, w.weight);
    }
  }

  const totalCourts = effectiveLocationIds.length > 0
    ? locationsData.reduce((s, l) => s + l.court_count, 0)
    : (pattern.court_count || 1);

  // Build teamsMap for preference scoring
  const teamsMap = new Map(
    teams.map((t) => [t.id, { id: t.id, name: t.name, preferences: t.preferences }])
  );

  const startsOn = regenerateFromDate ?? parseLocalDate(pattern.starts_on);
  const endsOn = pattern.ends_on ? parseLocalDate(pattern.ends_on) : null;

  const patternObj = {
    dayOfWeek: pattern.day_of_week,
    startTime: pattern.start_time.slice(0, 5),
    endTime: pattern.end_time ? pattern.end_time.slice(0, 5) : null,
    venue: null,
    courtCount: totalCourts,
    startsOn,
    endsOn,
    durationMinutes: pattern.duration_minutes || 60,
    skipDates: mergedSkipDates,
  };

  const weekFillTeams = teams.map((t) => ({
    id: t.id,
    name: t.name,
    division_id: reseedTeamDivisionOverride?.get(t.id) ?? t.division_id,
    preferences: t.preferences,
  }));

  const effectiveCrossPlayRules = reseedCrossPlayOverride ?? crossPlayRules ?? [];
  const effectiveMixDivisions = reseedMode ? false : mixDivisions;

  // Preflight check: if truncation needed but not accepted, return 409 with details.
  const preflight = schedulePreflight(
    weekFillTeams,
    patternObj,
    { matchupFrequency, gamesPerSession, gamesPerTeam },
    divisions || []
  );

  if (!preflight.fits && !acceptTruncation) {
    const divLabel = preflight.biggestDivisionName ?? "biggest";
    const parts: string[] = [
      `Division ${divLabel} needs ${preflight.minWeeksNeeded} weeks but only ${preflight.availableWeeks} weeks are available.`,
    ];
    if (preflight.droppedPairCount > 0) {
      parts.push(
        `${preflight.droppedPairCount} round-robin pairing${preflight.droppedPairCount === 1 ? "" : "s"} will be dropped.`
      );
    }
    if (preflight.gamesPerTeamShortfall > 0) {
      parts.push(
        `Each team will play up to ${preflight.gamesPerTeamShortfall} fewer game${preflight.gamesPerTeamShortfall === 1 ? "" : "s"} than the goal of ${gamesPerTeam}.`
      );
    }
    return NextResponse.json(
      {
        error: "truncation_required",
        preflight,
        message: parts.join(" "),
      },
      { status: 409 }
    );
  }

  // Run the fill. `engine=solver` routes through the ILP path (Phase 1 + 2
  // via HiGHS); default `greedy` is the legacy pass. Solver ignores reseed
  // existingMatchupCounts and reseed team weights are passed into Phase 1 so
  // regeneration avoids already-played matchups and keeps skill-aligned pools.
  const fillParams = {
    teams: weekFillTeams,
    pattern: patternObj,
    opts: {
      matchupFrequency,
      gamesPerSession,
      allowCrossPlay: effectiveMixDivisions,
      crossPlayRules: effectiveCrossPlayRules,
      acceptTruncation,
      gamesPerTeam,
    },
    teamsMap,
    regenerateFromDate,
    existingMatchupCounts,
    teamWeights: reseedTeamWeights || undefined,
  };
  const requestedEngine: SchedulerEngine =
    engine === "service" ? "service" : engine === "solver" ? "solver" : "greedy";
  let engineUsed: SchedulerEngine = requestedEngine;
  const schedulerWarnings: string[] = [];
  let result: RouteSchedulerResult;
  const courtSlots = buildCourtSlots(effectiveLocationIds, locationsMap);
  if (requestedEngine === "service") {
    try {
      const serviceResult = await callSchedulerService({
        timezone,
        gamesPerTeam,
        gamesPerSession,
        matchupFrequency,
        mergedSkipDates,
        effectiveMixDivisions,
        effectiveCrossPlayRules,
        regenerateFrom,
        existingMatchupCounts,
        pattern,
        weekFillTeams,
        reseedTeamWeights,
        locationsData,
        unavailByDate,
      });
      if (serviceResult.status === "infeasible") {
        engineUsed = "greedy";
        schedulerWarnings.push(
          "CP-SAT service returned infeasible; used greedy scheduler instead."
        );
        result = fillScheduleByWeek(fillParams);
      } else {
        result = normalizeServiceResult(serviceResult, locationsMap);
      }
    } catch (err) {
      engineUsed = "greedy";
      schedulerWarnings.push(
        `CP-SAT service failed before persistence (${formatSchedulerError(err)}); used greedy scheduler instead.`
      );
      result = fillScheduleByWeek(fillParams);
    }
  } else if (requestedEngine === "solver") {
    try {
      result = await solveSchedule(fillParams, {
        courtSlots,
        unavailByDate,
        teamDivisionIds: new Map(
          weekFillTeams.map((team) => [team.id, team.division_id])
        ),
      });
    } catch (err) {
      engineUsed = "greedy";
      schedulerWarnings.push(
        `Solver failed before persistence (${formatSchedulerError(err)}); used greedy scheduler instead.`
      );
      result = fillScheduleByWeek(fillParams);
    }
  } else {
    result = fillScheduleByWeek(fillParams);
  }

  // Persist scheduling settings back to the pattern
  const patternUpdate: Record<string, unknown> = {
    games_per_team: gamesPerTeam,
    games_per_session: gamesPerSession,
    matchup_frequency: matchupFrequency,
    mix_divisions: mixDivisions,
    skip_dates: skipDates,
    location_ids: effectiveLocationIds.length > 0 ? effectiveLocationIds : pattern.location_ids,
  };
  if (reseedMode && regenerateFrom) {
    patternUpdate.last_regenerated_at = localToUTCISO(parseLocalDate(regenerateFrom), timezone);
  }
  await supabase.from("game_day_patterns").update(patternUpdate).eq("id", patternId);

  // Delete existing scheduled games in the range we're regenerating.
  if (regenerateFrom) {
    await supabase
      .from("games")
      .delete()
      .eq("league_id", leagueId)
      .eq("status", "scheduled")
      .eq("is_playoff", false)
      .gte("scheduled_at", localToUTCISO(parseLocalDate(regenerateFrom), timezone));
  } else {
    await supabase
      .from("games")
      .delete()
      .eq("league_id", leagueId)
      .eq("status", "scheduled")
      .eq("is_playoff", false);
  }

  const gamesToInsert = [];
  let locationAssignmentDroppedCount = 0;

  if (engineUsed === "service") {
    gamesToInsert.push(
      ...toScheduledGamesInsertRows({
        leagueId,
        timezone,
        games: result.games,
        defaultLocationId: pattern.location_ids?.[0] || null,
      })
    );
  } else if (engineUsed === "solver" && "locationSplitCount" in result) {
    locationAssignmentDroppedCount = result.locationAssignmentDroppedCount || 0;
    if ((result.locationSplitCount || 0) > 0) {
      schedulerWarnings.push(
        formatLocationSplitWarning(result.locationSplitCount || 0)
      );
    }
    gamesToInsert.push(
      ...toScheduledGamesInsertRows({
        leagueId,
        timezone,
        games: result.games,
        defaultLocationId: pattern.location_ids?.[0] || null,
      })
    );
  } else if (courtSlots.length > 0) {
    const teamDivisionIds = new Map(weekFillTeams.map((team) => [team.id, team.division_id]));
    const assignedGames = assignGamesToLocationCourtSlots(
      result.games,
      courtSlots,
      unavailByDate,
      teamDivisionIds
    );
    locationAssignmentDroppedCount = result.games.length - assignedGames.length;
    const locationSplits = findSameNightLocationSplits(assignedGames);
    if (locationSplits.length > 0) {
      schedulerWarnings.push(formatLocationSplitWarning(locationSplits.length));
    }
    gamesToInsert.push(
      ...toAssignedGamesInsertRows({
        leagueId,
        timezone,
        games: assignedGames,
      })
    );
  } else {
    gamesToInsert.push(
      ...toScheduledGamesInsertRows({
        leagueId,
        timezone,
        games: result.games,
        defaultLocationId: pattern.location_ids?.[0] || null,
      })
    );
  }

  const { data: insertedGames, error } = await supabase
    .from("games")
    .insert(gamesToInsert)
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const warnings: string[] = [...schedulerWarnings, ...result.notes];
  if (result.droppedPairs.length > 0) {
    warnings.push(
      `${result.droppedPairs.length} pairing${result.droppedPairs.length > 1 ? "s" : ""} could not be scheduled within the available weeks.`
    );
  }
  if (locationAssignmentDroppedCount > 0) {
    warnings.push(
      `${locationAssignmentDroppedCount} game${locationAssignmentDroppedCount === 1 ? "" : "s"} could not be assigned to an available court without overbooking.`
    );
  }
  const backToBackByes = result.byes.filter((b) => b.backToBack);
  if (backToBackByes.length > 0) {
    warnings.push(
      `${backToBackByes.length} back-to-back BYE${backToBackByes.length > 1 ? "s were" : " was"} unavoidable.`
    );
  }

  return NextResponse.json({
    games: insertedGames,
    count: insertedGames?.length || 0,
    warnings: warnings.length > 0 ? warnings : undefined,
    preflight,
    byes: result.byes,
    droppedPairs: result.droppedPairs,
    targetWeeks: result.targetWeeks,
    scheduler: {
      requestedEngine,
      engineUsed,
    },
  });
}

function formatSchedulerError(err: unknown): string {
  if (err instanceof Error) {
    const parts = [err.message];
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause instanceof Error) {
      parts.push(`cause=${cause.message}`);
    } else if (cause) {
      parts.push(`cause=${String(cause)}`);
    }
    const stackLine = err.stack?.split("\n").map((line) => line.trim())[1];
    if (stackLine) {
      parts.push(stackLine);
    }
    return parts.join(" | ");
  }
  return String(err);
}

async function callSchedulerService(input: {
  timezone: string;
  gamesPerTeam: number;
  gamesPerSession: number;
  matchupFrequency: number;
  mergedSkipDates: string[];
  effectiveMixDivisions: boolean;
  effectiveCrossPlayRules: Array<{ division_a_id: string; division_b_id: string }>;
  regenerateFrom?: string;
  existingMatchupCounts: Map<string, number>;
  pattern: {
    starts_on: string;
    ends_on: string | null;
    day_of_week: number;
    start_time: string;
    end_time: string | null;
    duration_minutes: number | null;
  };
  weekFillTeams: Array<{
    id: string;
    name: string;
    division_id: string | null;
    preferences?: unknown;
  }>;
  reseedTeamWeights: Map<string, number> | null;
  locationsData: Array<{ id: string; name: string; court_count: number }>;
  unavailByDate: Map<string, Set<string>>;
}): Promise<SchedulerServiceResponse> {
  const baseUrl = process.env.SCHEDULER_SERVICE_URL;
  const token = process.env.SCHEDULER_SERVICE_TOKEN;
  if (!baseUrl || !token) {
    throw new Error("scheduler service env vars are not configured");
  }

  const venues = input.locationsData.map((location) => ({
    id: location.id,
    name: location.name,
    court_count: location.court_count,
    unavailable_dates: Array.from(input.unavailByDate.entries())
      .filter(([, ids]) => ids.has(location.id))
      .map(([date]) => date)
      .sort(),
  }));

  const payload = {
    league: {
      start_date: input.regenerateFrom ?? input.pattern.starts_on,
      end_date: input.pattern.ends_on,
      day_of_week: input.pattern.day_of_week,
      start_time: input.pattern.start_time.slice(0, 5),
      end_time: input.pattern.end_time ? input.pattern.end_time.slice(0, 5) : null,
      duration_minutes: input.pattern.duration_minutes || 60,
      skip_dates: input.mergedSkipDates,
      games_per_team: input.gamesPerTeam,
      matchup_frequency: input.matchupFrequency,
      games_per_session: input.gamesPerSession,
      allow_cross_play: input.effectiveMixDivisions,
      cross_play_rules: input.effectiveCrossPlayRules,
    },
    teams: input.weekFillTeams.map((team) => ({
      id: team.id,
      name: team.name,
      division_id: team.division_id,
      weight: input.reseedTeamWeights?.get(team.id),
      preferences: team.preferences ?? {},
    })),
    venues,
    regeneration: input.regenerateFrom
      ? {
          from_date: input.regenerateFrom,
          existing_matchup_counts: Object.fromEntries(input.existingMatchupCounts),
        }
      : null,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 58_000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/solve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const data = (await response.json().catch(() => null)) as
      | SchedulerServiceResponse
      | { error?: string; message?: string }
      | null;

    if (!response.ok) {
      throw new Error(
        `scheduler service ${response.status}: ${data && "message" in data ? data.message || data.error || "request failed" : "request failed"}`
      );
    }

    return data as SchedulerServiceResponse;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeServiceResult(
  serviceResult: SchedulerServiceResponse,
  locationsMap: Map<string, { id: string; name: string; court_count: number }>
): LocalSchedulerResult {
  return {
    games: serviceResult.games.map((game) => {
      const location = game.venue_id ? locationsMap.get(game.venue_id) : null;
      return {
        home: game.home_team_id,
        away: game.away_team_id,
        scheduledAt: parseLocalDate(game.scheduled_at),
        venue: location?.name ?? null,
        locationId: game.venue_id,
        court: location && location.court_count > 1 ? `Court ${game.court_number}` : null,
        weekNumber: game.week_number,
        preferenceApplied:
          game.preferences_honored &&
          ((game.preferences_honored.home_team?.length || 0) > 0 ||
            (game.preferences_honored.away_team?.length || 0) > 0)
            ? game.preferences_honored
            : null,
        schedulingNotes: game.scheduling_notes ?? null,
      };
    }),
    byes: serviceResult.byes.map((bye) => ({
      teamId: bye.team_id,
      date: parseLocalDate(bye.date),
      weekNumber: bye.week_number,
      backToBack: bye.back_to_back,
    })),
    notes: serviceResult.diagnostics.notes || [],
    droppedPairs: serviceResult.dropped_pairs.map((pair) => ({
      teamA: pair.team_a_id,
      teamB: pair.team_b_id,
      reason: pair.reason,
    })),
    targetWeeks: serviceResult.diagnostics.target_weeks,
    availableWeeks: serviceResult.diagnostics.available_weeks,
  };
}
