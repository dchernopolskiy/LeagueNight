import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/supabase/helpers";
import { generateBracket } from "@/lib/scheduling/brackets";
import { localToUTCISO } from "@/lib/scheduling/date-utils";
import { NextRequest, NextResponse } from "next/server";
import type { Standing, Team } from "@/lib/types";

// Default assumed length of a single game-day session when no end-time is configured.
// Used to derive how many time slots fit in a day for round-robin-style court rotation.
const DEFAULT_SESSION_HOURS = 8;
const VALID_BRACKET_FORMATS = new Set(["single_elimination", "double_elimination"]);
const VALID_SEED_MODES = new Set(["record", "points"]);

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isTimeString(value: unknown): value is string {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value);
}

export async function POST(request: NextRequest) {
  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    leagueId,
    divisionId,
    numTeams,
    format,
    seedBy,
    name,
    teamsPerBracket,
    startDate,
    daysOfWeek,
    defaultLocationIds,
    defaultLocationId,
    defaultStartTime,
    defaultDurationMinutes,
  } = body;

  if (!leagueId || !numTeams || !format || !seedBy || !name) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  if (!numTeams || numTeams < 2) {
    return NextResponse.json(
      { error: "numTeams must be at least 2" },
      { status: 400 }
    );
  }

  if (!VALID_BRACKET_FORMATS.has(format)) {
    return NextResponse.json({ error: "Invalid bracket format" }, { status: 400 });
  }

  if (!VALID_SEED_MODES.has(seedBy)) {
    return NextResponse.json({ error: "Invalid seed mode" }, { status: 400 });
  }

  if (teamsPerBracket && teamsPerBracket < 2) {
    return NextResponse.json(
      { error: "teamsPerBracket must be at least 2" },
      { status: 400 }
    );
  }

  if (startDate && !isIsoDate(startDate)) {
    return NextResponse.json({ error: "startDate must be YYYY-MM-DD" }, { status: 400 });
  }

  if (startDate && (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0)) {
    return NextResponse.json(
      { error: "daysOfWeek is required when startDate is provided" },
      { status: 400 }
    );
  }

  if (
    Array.isArray(daysOfWeek) &&
    daysOfWeek.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
  ) {
    return NextResponse.json(
      { error: "daysOfWeek must contain integers from 0 to 6" },
      { status: 400 }
    );
  }

  if (defaultStartTime && !isTimeString(defaultStartTime)) {
    return NextResponse.json(
      { error: "defaultStartTime must be HH:MM" },
      { status: 400 }
    );
  }

  if (
    defaultDurationMinutes != null &&
    (!Number.isInteger(defaultDurationMinutes) || defaultDurationMinutes <= 0)
  ) {
    return NextResponse.json(
      { error: "defaultDurationMinutes must be a positive integer" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Verify ownership or staff access
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

  const { data: leagueMeta } = await supabase
    .from("leagues")
    .select("id, organizer_id, timezone")
    .eq("id", leagueId)
    .single();

  if (!leagueMeta) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }

  const effectiveDefaultLocationIds = Array.from(
    new Set(
      Array.isArray(defaultLocationIds)
        ? defaultLocationIds.filter((id): id is string => typeof id === "string" && id.length > 0)
        : defaultLocationId
          ? [defaultLocationId]
          : []
    )
  );

  const { data: selectedLocationsData } = effectiveDefaultLocationIds.length > 0
    ? await supabase
        .from("locations")
        .select("id, name, court_count")
        .eq("organizer_id", leagueMeta.organizer_id)
        .in("id", effectiveDefaultLocationIds)
    : { data: [] };

  if ((selectedLocationsData || []).length !== effectiveDefaultLocationIds.length) {
    return NextResponse.json(
      { error: "One or more selected locations are invalid for this league" },
      { status: 400 }
    );
  }

  const selectedLocations = selectedLocationsData || [];
  const courtSlots = selectedLocations.flatMap((loc) =>
    Array.from({ length: Math.max(loc.court_count || 1, 1) }, (_, index) => ({
      locationId: loc.id,
      locationName: loc.name,
      court: (loc.court_count || 1) > 1 ? `Court ${index + 1}` : null,
    }))
  );
  const timezone = leagueMeta.timezone || "America/New_York";

  const duration = defaultDurationMinutes || 60;
  const timeSlotsPerDay = Math.max(
    1,
    Math.floor((DEFAULT_SESSION_HOURS * 60) / duration)
  );
  const courtCount = Math.max(courtSlots.length, 1);
  const slotsPerDay = timeSlotsPerDay * courtCount;

  function buildScheduledGame(gameIndex: number) {
    const withinDayIndex = gameIndex % slotsPerDay;
    const timeSlotIndex = Math.floor(withinDayIndex / courtCount);
    const courtSlot = courtSlots.length > 0 ? courtSlots[withinDayIndex % courtCount] : null;

    let date: Date;

    if (!startDate || !daysOfWeek || !daysOfWeek.length) {
      date = new Date();
    } else {
      date = new Date(startDate + "T00:00:00");
      while (!daysOfWeek.includes(date.getDay())) {
        date.setDate(date.getDate() + 1);
      }

      const sessionIndex = Math.floor(gameIndex / slotsPerDay);
      for (let i = 0; i < sessionIndex; i++) {
        date.setDate(date.getDate() + 1);
        while (!daysOfWeek.includes(date.getDay())) {
          date.setDate(date.getDate() + 1);
        }
      }
    }

    if (defaultStartTime) {
      const [h, m] = defaultStartTime.split(":").map(Number);
      date.setHours(h, m + (timeSlotIndex * duration), 0, 0);
    }

    return {
      scheduledAt:
        startDate || defaultStartTime
          ? localToUTCISO(date, timezone)
          : date.toISOString(),
      locationId: courtSlot?.locationId || null,
      venue: courtSlot?.locationName || null,
      court: courtSlot?.court || null,
      timeSlotIndex,
    };
  }

  // Get standings, optionally filtered by division
  const standingsQuery = supabase
    .from("standings")
    .select("*")
    .eq("league_id", leagueId)
    .order("rank");

  let teamsQuery = supabase
    .from("teams")
    .select("*")
    .eq("league_id", leagueId);

  if (divisionId) {
    teamsQuery = teamsQuery.eq("division_id", divisionId);
  }

  const [standingsRes, teamsRes] = await Promise.all([
    standingsQuery,
    teamsQuery,
  ]);

  const teams = (teamsRes.data || []) as Team[];
  let standings = (standingsRes.data || []) as Standing[];

  // If division filter, only keep standings for teams in that division
  if (divisionId) {
    const teamIds = new Set(teams.map((t) => t.id));
    standings = standings.filter((s) => teamIds.has(s.team_id));
  }

  // Re-sort by seed criteria
  if (seedBy === "points") {
    standings.sort((a, b) => b.points_for - a.points_for);
  }

  const effectiveNumTeams = Math.min(standings.length, numTeams);
  const seededStandings = standings.slice(0, effectiveNumTeams);

  // Split into multiple brackets if teamsPerBracket is set
  const perBracket = teamsPerBracket || effectiveNumTeams;
  const bracketCount = Math.ceil(effectiveNumTeams / perBracket);

  const allBrackets: { id: string }[] = [];
  const allSlots = [];
  const allGames: { id: string }[] = [];
  let globalGameOffset = 0;

  // Track everything we've inserted so we can roll back on any failure mid-loop.
  // Supabase lacks client-side transactions — this is the next-best option.
  const insertedBracketIds: string[] = [];
  const insertedGameIds: string[] = [];
  async function rollbackAndFail(message: string, status = 500) {
    if (insertedGameIds.length > 0) {
      await supabase.from("games").delete().in("id", insertedGameIds);
    }
    if (insertedBracketIds.length > 0) {
      // bracket_slots have ON DELETE CASCADE from brackets, so this is sufficient
      await supabase.from("brackets").delete().in("id", insertedBracketIds);
    }
    return NextResponse.json({ error: message }, { status });
  }

  for (let bi = 0; bi < bracketCount; bi++) {
    const start = bi * perBracket;
    const end = Math.min(start + perBracket, effectiveNumTeams);
    const bracketStandings = seededStandings.slice(start, end);
    const bracketTeamIds = new Set(bracketStandings.map((s) => s.team_id));
    const bracketTeams = teams.filter((t) => bracketTeamIds.has(t.id));

    const bracketName =
      bracketCount === 1
        ? name
        : `${name} — ${bracketCount <= 3 ? ["Top", "Middle", "Bottom"][bi] || `Group ${bi + 1}` : `Group ${bi + 1}`} (Teams ${start + 1}-${end})`;

    // Generate bracket structure
    const { slots } = generateBracket({
      standings: bracketStandings,
      teams: bracketTeams,
      numTeams: bracketStandings.length,
      format,
    });

    // Create bracket record
    const { data: bracket, error: bracketError } = await supabase
      .from("brackets")
      .insert({
        league_id: leagueId,
        division_id: divisionId || null,
        name: bracketName,
        format,
        num_teams: bracketStandings.length,
        seed_by: seedBy,
        default_location_id: effectiveDefaultLocationIds[0] || null,
        default_location_ids: effectiveDefaultLocationIds.length > 0 ? effectiveDefaultLocationIds : null,
        default_start_time: defaultStartTime || null,
        default_duration_minutes: defaultDurationMinutes || null,
        start_date: startDate || null,
        days_of_week: daysOfWeek || null,
      })
      .select()
      .single();

    if (bracketError || !bracket) {
      return rollbackAndFail(bracketError?.message || "Failed to create bracket");
    }
    insertedBracketIds.push(bracket.id);

    // Create playoff games for first round matchups.
    // We must iterate ALL R1 slots in pairs (by position order) so that bye slots
    // are skipped correctly — filtering out byes first would mis-pair the remaining teams.
    const allFirstRoundSlots = slots.filter((s) => s.round === 1);
    const gameInserts: {
      league_id: string;
      home_team_id: string;
      away_team_id: string;
      scheduled_at: string;
      status: string;
      is_playoff: boolean;
      location_id?: string;
      venue?: string;
      court?: string | null;
    }[] = [];
    // Map from matchup index (i/2) to gameInserts index, for game_id assignment below.
    const matchupGameIdx: (number | null)[] = [];

    for (let i = 0; i < allFirstRoundSlots.length; i += 2) {
      const topSlot = allFirstRoundSlots[i];
      const bottomSlot = allFirstRoundSlots[i + 1];

      if (topSlot?.team_id && bottomSlot?.team_id) {
        const gameIdx = gameInserts.length;
        const scheduledGame = buildScheduledGame(globalGameOffset + gameIdx);
        matchupGameIdx.push(gameIdx);
        gameInserts.push({
          league_id: leagueId,
          home_team_id: topSlot.team_id,
          away_team_id: bottomSlot.team_id,
          scheduled_at: scheduledGame.scheduledAt,
          status: "scheduled",
          is_playoff: true,
          ...(scheduledGame.locationId && {
            location_id: scheduledGame.locationId,
            venue: scheduledGame.venue,
            court: scheduledGame.court,
          }),
        });
      } else {
        matchupGameIdx.push(null); // bye matchup — no game
      }
    }

    let insertedGames: { id: string }[] = [];
    if (gameInserts.length > 0) {
      const { data: games, error: gamesError } = await supabase
        .from("games")
        .insert(gameInserts)
        .select("id");

      if (gamesError) {
        return rollbackAndFail(gamesError.message);
      }

      insertedGames = games || [];
      for (const g of insertedGames) insertedGameIds.push(g.id);
    }

    globalGameOffset += gameInserts.length;

    // Assign game IDs to first round slot pairs using positional matchup index.
    const slotsWithGames = slots.map((slot) => {
      if (slot.round === 1) {
        const matchupIndex = Math.floor(slot.position / 2);
        const gameIdx = matchupGameIdx[matchupIndex];
        const gameId = gameIdx != null ? (insertedGames[gameIdx]?.id ?? null) : null;
        return { ...slot, bracket_id: bracket.id, game_id: gameId };
      }
      return { ...slot, bracket_id: bracket.id };
    });

    // Insert bracket slots
    const { data: insertedSlots, error: slotsError } = await supabase
      .from("bracket_slots")
      .insert(slotsWithGames)
      .select();

    if (slotsError) {
      return rollbackAndFail(slotsError.message);
    }

    allBrackets.push(bracket);
    allSlots.push(...(insertedSlots || []));
    allGames.push(...insertedGames);
  }

  return NextResponse.json({
    brackets: allBrackets,
    slots: allSlots,
    games: allGames,
    bracketCount,
  });
}
