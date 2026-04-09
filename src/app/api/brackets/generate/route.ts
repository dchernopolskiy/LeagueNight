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

  // Verify organizer owns the league
  const { data: league } = await supabase
    .from("leagues")
    .select("id")
    .eq("id", leagueId)
    .eq("organizer_id", profile.id)
    .single();

  if (!league) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
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
      })
      .select()
      .single();

    if (bracketError || !bracket) {
      return NextResponse.json(
        { error: bracketError?.message || "Failed to create bracket" },
        { status: 500 }
      );
    }

    // Create playoff games for first round matchups
    const firstRoundSlots = slots.filter((s) => s.round === 1 && s.team_id);
    const gameInserts: {
      league_id: string;
      home_team_id: string;
      away_team_id: string;
      scheduled_at: string;
      status: string;
      is_playoff: boolean;
    }[] = [];

    for (let i = 0; i < firstRoundSlots.length; i += 2) {
      const topSlot = firstRoundSlots[i];
      const bottomSlot = firstRoundSlots[i + 1];

      if (topSlot?.team_id && bottomSlot?.team_id) {
        gameInserts.push({
          league_id: leagueId,
          home_team_id: topSlot.team_id,
          away_team_id: bottomSlot.team_id,
          scheduled_at: new Date().toISOString(),
          status: "scheduled",
          is_playoff: true,
        });
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

    // Assign game IDs to first round slot pairs
    const slotsWithGames = slots.map((slot) => {
      if (slot.round === 1 && slot.team_id) {
        const pairIndex = Math.floor(firstRoundSlots.indexOf(slot) / 2);
        return {
          ...slot,
          bracket_id: bracket.id,
          game_id: insertedGames[pairIndex]?.id ?? null,
        };
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
