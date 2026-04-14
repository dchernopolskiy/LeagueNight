import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/supabase/helpers";
import { generateRoundRobin, assignDates } from "@/lib/scheduling/round-robin";
import { NextRequest, NextResponse } from "next/server";

/**
 * Convert a Date whose get*() components represent the intended local time
 * in `timezone` into a correct UTC ISO string.
 *
 * On the server (UTC), `setHours(19, 0)` creates 19:00 UTC — but we actually
 * mean 19:00 in the league's timezone. This function finds the real UTC instant
 * that corresponds to those year/month/day/hour/minute values in the given tz.
 */
function localToUTCISO(date: Date, timezone: string): string {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();

  // Start with a UTC guess using the same numeric components
  let guess = new Date(Date.UTC(year, month, day, hours, minutes, 0));

  // Iteratively adjust: check what those UTC millis look like in the target
  // timezone, compute the drift, and correct. Two passes always converge.
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(guess);

    const get = (type: string) =>
      parseInt(parts.find((p) => p.type === type)?.value || "0");

    const gotH = get("hour") === 24 ? 0 : get("hour");
    const gotMs = Date.UTC(get("year"), get("month") - 1, get("day"), gotH, get("minute"), 0);
    const wantMs = Date.UTC(year, month, day, hours, minutes, 0);

    guess = new Date(guess.getTime() + (wantMs - gotMs));
  }

  return guess.toISOString();
}

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

  // Get league timezone for correct timestamp conversion
  const { data: leagueInfo } = await supabase
    .from("leagues")
    .select("timezone")
    .eq("id", leagueId)
    .single();
  const timezone = leagueInfo?.timezone || "America/New_York";

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
      : pattern.location_ids?.length > 0
        ? pattern.location_ids
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
  // Append T00:00:00 to force local-time parsing (date-only strings like
  // "2026-04-06" are parsed as UTC midnight, which shifts the day backward
  // in western timezones and breaks day-of-week calculations).
  const parseLocalDate = (s: string) => new Date(s.includes("T") ? s : `${s}T00:00:00`);
  const effectiveStartsOn = regenerateFrom ? parseLocalDate(regenerateFrom) : parseLocalDate(pattern.starts_on);
  const totalCourts = effectiveLocationIds.length > 0
    ? locationsData.reduce((sum, l) => sum + l.court_count, 0)
    : (pattern.court_count || 1);

  const scheduled = assignDates(
    allMatchups,
    {
      dayOfWeek: pattern.day_of_week,
      startTime: pattern.start_time,
      endTime: pattern.end_time || null,
      venue: pattern.venue,
      courtCount: totalCourts,
      startsOn: effectiveStartsOn,
      durationMinutes: pattern.duration_minutes || 60,
      skipDates: mergedSkipDates,
    },
    gamesPerTeam
  );

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

  // Helper to format date as YYYY-MM-DD
  function formatYMD(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // Insert new games, distributing across available location court slots per date
  const gamesToInsert: any[] = [];

  if (courtSlots.length > 0) {
    // Group scheduled games by date for per-date court distribution
    const gamesByDate = new Map<string, typeof scheduled>();
    for (const g of scheduled) {
      const key = formatYMD(g.scheduledAt);
      const arr = gamesByDate.get(key) || [];
      arr.push(g);
      gamesByDate.set(key, arr);
    }

    for (const [dateStr, dateGames] of gamesByDate) {
      const unavailOnDate = unavailByDate.get(dateStr) || new Set<string>();
      // Filter court slots to only available locations on this date
      const availableSlots = courtSlots.filter(s => !unavailOnDate.has(s.locationId));
      const slotsToUse = availableSlots.length > 0 ? availableSlots : courtSlots;

      for (let i = 0; i < dateGames.length; i++) {
        const g = dateGames[i];
        const slot = slotsToUse[i % slotsToUse.length];
        gamesToInsert.push({
          league_id: leagueId,
          home_team_id: g.home,
          away_team_id: g.away,
          scheduled_at: localToUTCISO(g.scheduledAt, timezone),
          venue: slot.locationName,
          court: slot.totalCourts > 1 ? `Court ${slot.courtNum}` : null,
          week_number: g.weekNumber,
          status: "scheduled",
          location_id: slot.locationId,
        });
      }
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
  });
}
