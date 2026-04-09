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
  const { leagueId, divisionId, numTeams, format, seedBy, name } = body;

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

  // Get teams, optionally filtered by division
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
  // "record" uses the default rank order which is already sorted

  // Use available teams, pad with byes if fewer than requested
  const effectiveNumTeams = Math.min(standings.length, numTeams);

  // Generate bracket structure
  const { slots, totalRounds } = generateBracket({
    standings,
    teams,
    numTeams: effectiveNumTeams || numTeams,
    format,
  });

  // Create bracket record
  const { data: bracket, error: bracketError } = await supabase
    .from("brackets")
    .insert({
      league_id: leagueId,
      division_id: divisionId || null,
      name,
      format,
      num_teams: numTeams,
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

  // Create playoff games for first round matchups (where both teams are assigned)
  const firstRoundSlots = slots.filter((s) => s.round === 1 && s.team_id);
  const gameInserts: {
    league_id: string;
    home_team_id: string;
    away_team_id: string;
    scheduled_at: string;
    status: string;
    is_playoff: boolean;
  }[] = [];

  // Group first round slots into matchup pairs (consecutive positions)
  for (let i = 0; i < firstRoundSlots.length; i += 2) {
    const topSlot = firstRoundSlots[i];
    const bottomSlot = firstRoundSlots[i + 1];

    if (topSlot?.team_id && bottomSlot?.team_id) {
      gameInserts.push({
        league_id: leagueId,
        home_team_id: topSlot.team_id,
        away_team_id: bottomSlot.team_id,
        scheduled_at: new Date().toISOString(), // placeholder — organizer schedules later
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
      // Rollback bracket on failure
      await supabase.from("brackets").delete().eq("id", bracket.id);
      return NextResponse.json(
        { error: gamesError.message },
        { status: 500 }
      );
    }

    insertedGames = games || [];
  }

  // Assign game IDs to first round slot pairs
  let gameIdx = 0;
  const slotsWithGames = slots.map((slot) => {
    if (slot.round === 1 && slot.team_id) {
      // Every pair of slots shares a game
      const pairIndex = Math.floor(
        firstRoundSlots.indexOf(slot) / 2
      );
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

  return NextResponse.json({
    bracket,
    slots: insertedSlots,
    games: insertedGames,
    totalRounds,
  });
}
