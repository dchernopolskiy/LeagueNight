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
import { NextRequest, NextResponse } from "next/server";

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
    engine = "greedy",
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
    engine?: "greedy" | "solver";
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
  const requestedEngine: "greedy" | "solver" = engine === "solver" ? "solver" : "greedy";
  let engineUsed: "greedy" | "solver" = requestedEngine;
  const schedulerWarnings: string[] = [];
  let result;
  if (requestedEngine === "solver") {
    try {
      result = await solveSchedule(fillParams);
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

  // Build court slots (locationId + courtNum). Physical court assignment is
  // handled as a per-date pass so teams do not bounce between locations.
  const courtSlots: { locationId: string; courtNum: number; locationName: string; totalCourts: number }[] = [];
  for (const locId of effectiveLocationIds) {
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

  const gamesToInsert: Array<{
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
  }> = [];
  let locationAssignmentDroppedCount = 0;

  if (courtSlots.length > 0) {
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

    for (const g of assignedGames) {
      gamesToInsert.push({
        league_id: leagueId,
        home_team_id: g.home,
        away_team_id: g.away,
        scheduled_at: localToUTCISO(g.scheduledAt, timezone),
        venue: g.locationName,
        court: g.totalCourts > 1 ? `Court ${g.courtNum}` : null,
        week_number: g.weekNumber,
        status: "scheduled",
        location_id: g.locationId,
        preference_applied: g.preferenceApplied || null,
        scheduling_notes: g.schedulingNotes || null,
      });
    }
  } else {
    for (const g of result.games) {
      gamesToInsert.push({
        league_id: leagueId,
        home_team_id: g.home,
        away_team_id: g.away,
        scheduled_at: localToUTCISO(g.scheduledAt, timezone),
        venue: g.venue,
        court: g.court,
        week_number: g.weekNumber,
        status: "scheduled",
        location_id: pattern.location_ids?.[0] || null,
        preference_applied: g.preferenceApplied || null,
        scheduling_notes: g.schedulingNotes || null,
      });
    }
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
  if (err instanceof Error) return err.message;
  return String(err);
}

function formatLocationSplitWarning(splitCount: number): string {
  return `${splitCount} team-night${splitCount === 1 ? "" : "s"} had to be split across locations because no single venue had enough available courts.`;
}

function validateGenerateRequest(input: {
  leagueId: unknown;
  patternId: unknown;
  gamesPerTeam: unknown;
  gamesPerSession: unknown;
  matchupFrequency: unknown;
  engine: unknown;
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
  if (input.engine !== "greedy" && input.engine !== "solver") {
    return "engine must be either greedy or solver";
  }
  return null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
