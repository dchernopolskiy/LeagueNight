import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/supabase/helpers";
import { generateRoundRobin, assignDatesWithPreferences } from "@/lib/scheduling/round-robin";
import { localToUTCISO } from "@/lib/scheduling/date-utils";
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
  } = body;

  const validationError = validateGenerateRequest({
    leagueId,
    patternId,
    gamesPerTeam,
    gamesPerSession,
    matchupFrequency,
  });
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const supabase = createAdminClient();
  const pairKey = (teamA: string, teamB: string) =>
    [teamA, teamB].sort().join("-");

  // Verify ownership or staff access
  const { data: league } = await supabase
    .from("leagues")
    .select("id")
    .eq("id", leagueId)
    .eq("organizer_id", profile.id)
    .single();

  if (!league) {
    // Check if user is staff
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

  // Get league metadata for authorization and timezone-safe timestamp conversion
  const { data: leagueInfo } = await supabase
    .from("leagues")
    .select("timezone, organizer_id")
    .eq("id", leagueId)
    .single();
  const timezone = leagueInfo?.timezone || "America/New_York";

  // Get teams with preferences
  const { data: teams } = await supabase
    .from("teams")
    .select("id, division_id, name, preferences")
    .eq("league_id", leagueId);

  if (!teams || teams.length < 2) {
    return NextResponse.json(
      { error: "Need at least 2 teams" },
      { status: 400 }
    );
  }

  // Get cross-division play rules
  const { data: crossPlayRules } = await supabase
    .from("division_cross_play")
    .select("*")
    .eq("league_id", leagueId);

  // Get pattern
  const { data: pattern } = await supabase
    .from("game_day_patterns")
    .select("*")
    .eq("id", patternId)
    .eq("league_id", leagueId)
    .single();

  if (!pattern) {
    return NextResponse.json(
      { error: "Game day pattern not found" },
      { status: 404 }
    );
  }

  // Resolve location IDs: use the ones from the request body, or fall back to pattern
  const effectiveLocationIds: string[] =
    locationIds.length > 0
      ? locationIds
      : pattern.location_ids?.length > 0
        ? pattern.location_ids
        : [];

  // Fetch locations data for names
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

  // Fetch location unavailability for all relevant locations (with location_id for per-date filtering)
  const unavailByDate = new Map<string, Set<string>>();
  if (effectiveLocationIds.length > 0) {
    const { data: unavailData } = await supabase
      .from("location_unavailability")
      .select("location_id, unavailable_date")
      .in("location_id", effectiveLocationIds);
    for (const u of (unavailData || [])) {
      const dateSet = unavailByDate.get(u.unavailable_date) || new Set<string>();
      dateSet.add(u.location_id);
      unavailByDate.set(u.unavailable_date, dateSet);
    }
  }

  // Only skip dates where ALL selected locations are unavailable
  const fullyUnavailDates: string[] = [];
  for (const [date, unavailLocIds] of unavailByDate) {
    if (effectiveLocationIds.every(id => unavailLocIds.has(id))) {
      fullyUnavailDates.push(date);
    }
  }
  const mergedSkipDates = Array.from(new Set([...skipDates, ...fullyUnavailDates]));

  // Helper to parse local date strings (append T00:00:00 to force local-time parsing)
  const parseLocalDate = (s: string) => new Date(s.includes("T") ? s : `${s}T00:00:00`);

  // If regenerating, fetch games before the regeneration date to avoid duplicate matchups
  const existingMatchupCounts = new Map<string, number>();
  if (regenerateFrom) {
    // Parse the regeneration date and convert to UTC ISO for comparison
    const regenerationDate = localToUTCISO(parseLocalDate(regenerateFrom), timezone);

    // Get all games (scheduled or completed) before the regeneration date
    const { data: existingGames } = await supabase
      .from("games")
      .select("home_team_id, away_team_id")
      .eq("league_id", leagueId)
      .eq("is_playoff", false)
      .lt("scheduled_at", regenerationDate);

    if (existingGames) {
      for (const game of existingGames) {
        const key = pairKey(game.home_team_id, game.away_team_id);
        existingMatchupCounts.set(key, (existingMatchupCounts.get(key) || 0) + 1);
      }
    }
  }

  // Generate round-robin matchups
  let allMatchups: ReturnType<typeof generateRoundRobin>;

  if (mixDivisions) {
    // Cross-division play with cross-play rules support
    if (!crossPlayRules || crossPlayRules.length === 0) {
      // No cross-play rules: one round-robin across all teams (old behavior)
      const teamIds = teams.map((t) => t.id);
      allMatchups = generateRoundRobin(teamIds, matchupFrequency);
    } else {
      // With cross-play rules: generate matchups respecting allowed division pairs
      // First, group teams by division
      const divisionTeams = new Map<string, string[]>();
      for (const t of teams) {
        const divKey = t.division_id ?? "__none__";
        const arr = divisionTeams.get(divKey) || [];
        arr.push(t.id);
        divisionTeams.set(divKey, arr);
      }

      // Helper to check if two divisions can play together
      const canDivisionsPlay = (divA: string | null, divB: string | null): boolean => {
        if (!divA || !divB) return true; // Teams without divisions can play with anyone
        if (divA === divB) return true; // Same division always plays together
        const [smaller, larger] = divA < divB ? [divA, divB] : [divB, divA];
        return crossPlayRules.some(
          (rule) => rule.division_a_id === smaller && rule.division_b_id === larger
        );
      };

      allMatchups = [];

      // 1. Generate within-division matchups for each division
      for (const [, teamIds] of divisionTeams) {
        if (teamIds.length >= 2) {
          allMatchups.push(...generateRoundRobin(teamIds, matchupFrequency));
        }
      }

      // 2. Generate cross-division matchups based on rules, batching independent
      // pairings into shared rounds instead of creating one round per game.
      let maxExistingRound = allMatchups.reduce(
        (max, matchup) => Math.max(max, matchup.round),
        0
      );
      const divisionIds = Array.from(divisionTeams.keys());
      for (let i = 0; i < divisionIds.length; i++) {
        for (let j = i + 1; j < divisionIds.length; j++) {
          const divA = divisionIds[i];
          const divB = divisionIds[j];
          if (canDivisionsPlay(divA === "__none__" ? null : divA, divB === "__none__" ? null : divB)) {
            const teamsA = divisionTeams.get(divA) || [];
            const teamsB = divisionTeams.get(divB) || [];
            const roundSize = Math.max(teamsA.length, teamsB.length);
            if (roundSize === 0) continue;

            const paddedA = [...teamsA];
            const paddedB = [...teamsB];
            while (paddedA.length < roundSize) paddedA.push("BYE");
            while (paddedB.length < roundSize) paddedB.push("BYE");

            for (let freq = 0; freq < matchupFrequency; freq++) {
              for (let round = 0; round < roundSize; round++) {
                const roundNumber = maxExistingRound + (freq * roundSize) + round + 1;
                for (let idx = 0; idx < roundSize; idx++) {
                  const teamA = paddedA[idx];
                  const teamB = paddedB[(idx + round) % roundSize];
                  if (teamA === "BYE" || teamB === "BYE") continue;

                  if (freq % 2 === 0) {
                    allMatchups.push({ home: teamA, away: teamB, round: roundNumber });
                  } else {
                    allMatchups.push({ home: teamB, away: teamA, round: roundNumber });
                  }
                }
              }
              maxExistingRound += roundSize;
            }
          }
        }
      }
    }
  } else {
    // Per-division: separate round-robins for each division group
    const divisionGroups = new Map<string, string[]>();
    for (const t of teams) {
      const key = t.division_id ?? "__none__";
      const arr = divisionGroups.get(key) || [];
      arr.push(t.id);
      divisionGroups.set(key, arr);
    }
    allMatchups = [];
    for (const groupTeamIds of divisionGroups.values()) {
      if (groupTeamIds.length >= 2) {
        allMatchups.push(...generateRoundRobin(groupTeamIds, matchupFrequency));
      }
    }
  }

  if (allMatchups.length === 0) {
    return NextResponse.json(
      { error: "Not enough teams to generate matchups" },
      { status: 400 }
    );
  }

  // Filter out matchups that already happened before the regeneration date.
  // Relies on Array.prototype.filter's in-order iteration guarantee: each
  // already-played matchup decrements the remaining count by one, so duplicate
  // pairings (double round-robin) are skipped proportionally.
  let skippedExistingMatchups = 0;
  if (regenerateFrom && existingMatchupCounts.size > 0) {
    const filtered: typeof allMatchups = [];
    for (const matchup of allMatchups) {
      const matchupKey = pairKey(matchup.home, matchup.away);
      const remaining = existingMatchupCounts.get(matchupKey) || 0;
      if (remaining > 0) {
        existingMatchupCounts.set(matchupKey, remaining - 1);
        skippedExistingMatchups++;
        continue;
      }
      filtered.push(matchup);
    }
    allMatchups = filtered;
  }

  // Assign dates — use total courts across all selected locations
  const effectiveStartsOn = regenerateFrom ? parseLocalDate(regenerateFrom) : parseLocalDate(pattern.starts_on);
  const totalCourts = effectiveLocationIds.length > 0
    ? locationsData.reduce((sum, l) => sum + l.court_count, 0)
    : (pattern.court_count || 1);

  // Build teams map for preference-aware scheduling
  const teamsMap = new Map();
  if (teams) {
    for (const team of teams) {
      teamsMap.set(team.id, team);
    }
  }

  const scheduled = assignDatesWithPreferences(
    allMatchups,
    {
      dayOfWeek: pattern.day_of_week,
      startTime: pattern.start_time,
      endTime: pattern.end_time || null,
      venue: null, // Don't use pattern venue - will be set per location below
      courtCount: totalCourts,
      startsOn: effectiveStartsOn,
      durationMinutes: pattern.duration_minutes || 60,
      skipDates: mergedSkipDates,
    },
    teamsMap,
    gamesPerSession
  );

  // Check if we scheduled all matchups (capacity warning)
  const schedulingWarnings: string[] = [];

  // Add info about skipped matchups from before regeneration date
  if (skippedExistingMatchups > 0) {
    schedulingWarnings.push(
      `Skipped ${skippedExistingMatchups} matchup${skippedExistingMatchups > 1 ? 's' : ''} that already occurred before the regeneration date.`
    );
  }

  if (scheduled.length < allMatchups.length) {
    const missedGames = allMatchups.length - scheduled.length;
    schedulingWarnings.push(
      `Unable to schedule ${missedGames} of ${allMatchups.length} games within the available time slots. ` +
      `Consider: (1) Adding more courts, (2) Extending game day hours, (3) Adding more game days, or (4) Reducing matchup frequency.`
    );
  }

  // Persist scheduling settings back to the pattern for self-contained regeneration
  await supabase
    .from("game_day_patterns")
    .update({
      games_per_team: gamesPerTeam,
      games_per_session: gamesPerSession,
      matchup_frequency: matchupFrequency,
      mix_divisions: mixDivisions,
      skip_dates: skipDates,
      location_ids: effectiveLocationIds.length > 0 ? effectiveLocationIds : pattern.location_ids,
    })
    .eq("id", patternId);

  // Delete existing regular scheduled games (never touch playoff games)
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

  // Build a flat list of (locationId, courtNumber) slots for distribution
  // e.g. if Reeves has 3 courts and MMS has 2 courts, slots = [Reeves-1, Reeves-2, Reeves-3, MMS-1, MMS-2]
  const courtSlots: { locationId: string; courtNum: number; locationName: string; totalCourts: number }[] = [];
  if (effectiveLocationIds.length > 0) {
    for (const locId of effectiveLocationIds) {
      const loc = locationsMap.get(locId);
      if (loc) {
        for (let c = 1; c <= loc.court_count; c++) {
          courtSlots.push({ locationId: locId, courtNum: c, locationName: loc.name, totalCourts: loc.court_count });
        }
      }
    }
  }

  // Insert new games, assigning physical courts per date so teams stay at one
  // location for the night whenever venue capacity makes that possible.
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

  if (courtSlots.length > 0) {
    const teamDivisionIds = new Map(teams.map((team) => [team.id, team.division_id]));
    const assignedGames = assignGamesToLocationCourtSlots(
      scheduled,
      courtSlots,
      unavailByDate,
      teamDivisionIds
    );
    const droppedByLocationAssignment = scheduled.length - assignedGames.length;
    if (droppedByLocationAssignment > 0) {
      schedulingWarnings.push(
        `${droppedByLocationAssignment} game${droppedByLocationAssignment === 1 ? "" : "s"} could not be assigned to an available court without overbooking.`
      );
    }
    const locationSplits = findSameNightLocationSplits(assignedGames);
    if (locationSplits.length > 0) {
      schedulingWarnings.push(
        `${locationSplits.length} team-night${locationSplits.length === 1 ? "" : "s"} had to be split across locations because no single venue had enough available courts.`
      );
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
    // No locations selected — use pattern defaults
    for (const g of scheduled) {
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

  return NextResponse.json({
    games: insertedGames,
    count: insertedGames?.length || 0,
    warnings: schedulingWarnings.length > 0 ? schedulingWarnings : undefined,
    totalMatchups: allMatchups.length,
    scheduledGames: gamesToInsert.length,
  });
}

function validateGenerateRequest(input: {
  leagueId: unknown;
  patternId: unknown;
  gamesPerTeam: unknown;
  gamesPerSession: unknown;
  matchupFrequency: unknown;
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
  return null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
