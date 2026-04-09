import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/supabase/helpers";
import { generateRoundRobin, assignDates } from "@/lib/scheduling/round-robin";
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
    matchupFrequency = 1,
    mixDivisions = false,
    skipDates = [],
    regenerateFrom,
    locationIds = [],
  } = body;

  const supabase = createAdminClient();

  // Verify ownership
  const { data: league } = await supabase
    .from("leagues")
    .select("id")
    .eq("id", leagueId)
    .eq("organizer_id", profile.id)
    .single();

  if (!league) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }

  // Get teams
  const { data: teams } = await supabase
    .from("teams")
    .select("id, division_id")
    .eq("league_id", leagueId);

  if (!teams || teams.length < 2) {
    return NextResponse.json(
      { error: "Need at least 2 teams" },
      { status: 400 }
    );
  }

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
      : pattern.location_id
        ? [pattern.location_id]
        : [];

  // Fetch locations data for names
  let locationsData: { id: string; name: string; court_count: number }[] = [];
  if (effectiveLocationIds.length > 0) {
    const { data: locsData } = await supabase
      .from("locations")
      .select("id, name, court_count")
      .in("id", effectiveLocationIds);
    locationsData = locsData || [];
  }
  const locationsMap = new Map(locationsData.map((l) => [l.id, l]));

  // Fetch location unavailability for all relevant locations
  let locationUnavailDates: string[] = [];
  if (effectiveLocationIds.length > 0) {
    const { data: unavailData } = await supabase
      .from("location_unavailability")
      .select("unavailable_date")
      .in("location_id", effectiveLocationIds);
    if (unavailData) {
      locationUnavailDates = unavailData.map((u: { unavailable_date: string }) => u.unavailable_date);
    }
  }

  // Merge location unavailability into skip dates
  const mergedSkipDates = Array.from(new Set([...skipDates, ...locationUnavailDates]));

  // Generate round-robin matchups
  let allMatchups: ReturnType<typeof generateRoundRobin>;

  if (mixDivisions) {
    // Cross-division: one round-robin across all teams
    const teamIds = teams.map((t) => t.id);
    allMatchups = generateRoundRobin(teamIds, matchupFrequency);
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

  // Assign dates — use total courts across all selected locations
  const effectiveStartsOn = regenerateFrom ? new Date(regenerateFrom) : new Date(pattern.starts_on);
  const totalCourts = effectiveLocationIds.length > 0
    ? locationsData.reduce((sum, l) => sum + l.court_count, 0)
    : (pattern.court_count || 1);

  const scheduled = assignDates(
    allMatchups,
    {
      dayOfWeek: pattern.day_of_week,
      startTime: pattern.start_time,
      venue: pattern.venue,
      courtCount: totalCourts,
      startsOn: effectiveStartsOn,
      durationMinutes: pattern.duration_minutes || 60,
      skipDates: mergedSkipDates,
    },
    gamesPerTeam
  );

  // Delete existing scheduled games (not completed ones)
  if (regenerateFrom) {
    // Only delete scheduled games from the regenerateFrom date forward
    await supabase
      .from("games")
      .delete()
      .eq("league_id", leagueId)
      .eq("status", "scheduled")
      .gte("scheduled_at", new Date(regenerateFrom).toISOString());
  } else {
    await supabase
      .from("games")
      .delete()
      .eq("league_id", leagueId)
      .eq("status", "scheduled");
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

  // Insert new games, distributing across location court slots
  const gamesToInsert = scheduled.map((g, index) => {
    let locationId: string | null = pattern.location_id || null;
    let venue = g.venue;
    let court = g.court;

    if (courtSlots.length > 0) {
      // Round-robin distribute games across all court slots
      const slot = courtSlots[index % courtSlots.length];
      locationId = slot.locationId;
      venue = slot.locationName;
      // Label with court number (e.g. "Court 1", "Court 2")
      court = slot.totalCourts > 1 ? `Court ${slot.courtNum}` : null;
    }

    return {
      league_id: leagueId,
      home_team_id: g.home,
      away_team_id: g.away,
      scheduled_at: g.scheduledAt.toISOString(),
      venue,
      court,
      week_number: g.weekNumber,
      status: "scheduled",
      location_id: locationId,
    };
  });

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
  });
}
