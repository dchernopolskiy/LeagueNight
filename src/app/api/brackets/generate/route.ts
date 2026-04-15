import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/supabase/helpers";
import { generateBracket } from "@/lib/scheduling/brackets";
import { NextRequest, NextResponse } from "next/server";
import type { Standing, Team } from "@/lib/types";

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

  // Get standings, optionally filtered by division
  let standingsQuery = supabase
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

  const allBrackets = [];
  const allSlots = [];
  const allGames = [];

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
    const { slots, totalRounds } = generateBracket({
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
        default_location_id: defaultLocationId || null,
        default_start_time: defaultStartTime || null,
        default_duration_minutes: defaultDurationMinutes || null,
        start_date: startDate || null,
        days_of_week: daysOfWeek || null,
      })
      .select()
      .single();

    if (bracketError || !bracket) {
      return NextResponse.json(
        { error: bracketError?.message || "Failed to create bracket" },
        { status: 500 }
      );
    }

    // Resolve default location name for games
    let defaultLocationName: string | null = null;
    if (defaultLocationId) {
      const { data: loc } = await supabase
        .from("locations")
        .select("name")
        .eq("id", defaultLocationId)
        .single();
      defaultLocationName = loc?.name || null;
    }

    // Schedule a game based on pattern (start date, days of week, duration)
    function scheduleGame(gameIndex: number): string {
      // If no scheduling pattern provided, use current time
      if (!startDate || !daysOfWeek || !daysOfWeek.length) {
        if (defaultStartTime) {
          const date = new Date();
          const [h, m] = defaultStartTime.split(":").map(Number);
          date.setHours(h, m, 0, 0);
          return date.toISOString();
        }
        return new Date().toISOString();
      }

      // Start from the provided start date
      const date = new Date(startDate + "T00:00:00");

      // Find the next valid day from daysOfWeek
      while (!daysOfWeek.includes(date.getDay())) {
        date.setDate(date.getDate() + 1);
      }

      // Calculate how many games can fit in one day
      const duration = defaultDurationMinutes || 60;
      // Assume 4 hours window per day (adjustable)
      const gamesPerDay = Math.floor((4 * 60) / duration);

      // Determine which session/day this game falls into
      const sessionIndex = Math.floor(gameIndex / gamesPerDay);

      // Advance to the correct day
      for (let i = 0; i < sessionIndex; i++) {
        date.setDate(date.getDate() + 1);
        while (!daysOfWeek.includes(date.getDay())) {
          date.setDate(date.getDate() + 1);
        }
      }

      // Set the time based on slot within the day
      const [h, m] = (defaultStartTime || "18:00").split(":").map(Number);
      const slotWithinDay = gameIndex % gamesPerDay;
      date.setHours(h, m + (slotWithinDay * duration), 0, 0);

      return date.toISOString();
    }

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
    }[] = [];
    // Map from matchup index (i/2) to gameInserts index, for game_id assignment below.
    const matchupGameIdx: (number | null)[] = [];

    for (let i = 0; i < allFirstRoundSlots.length; i += 2) {
      const topSlot = allFirstRoundSlots[i];
      const bottomSlot = allFirstRoundSlots[i + 1];

      if (topSlot?.team_id && bottomSlot?.team_id) {
        const gameIdx = gameInserts.length;
        matchupGameIdx.push(gameIdx);
        gameInserts.push({
          league_id: leagueId,
          home_team_id: topSlot.team_id,
          away_team_id: bottomSlot.team_id,
          scheduled_at: scheduleGame(gameIdx),
          status: "scheduled",
          is_playoff: true,
          ...(defaultLocationId && { location_id: defaultLocationId, venue: defaultLocationName }),
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
        await supabase.from("brackets").delete().eq("id", bracket.id);
        return NextResponse.json(
          { error: gamesError.message },
          { status: 500 }
        );
      }

      insertedGames = games || [];
    }

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
      return NextResponse.json(
        { error: slotsError.message },
        { status: 500 }
      );
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
