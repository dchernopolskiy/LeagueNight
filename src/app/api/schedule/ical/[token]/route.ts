import { createAdminClient } from "@/lib/supabase/admin";
import { generateIcalFeed } from "@/lib/scheduling/ical";
import { NextRequest, NextResponse } from "next/server";
import type { Game, Team, League } from "@/lib/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const supabase = createAdminClient();

  // Resolve player from token
  const { data: player } = await supabase
    .from("players")
    .select("id, league_id, team_id")
    .eq("token", token)
    .single();

  if (!player) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Get league
  const { data: league } = await supabase
    .from("leagues")
    .select("*")
    .eq("id", player.league_id)
    .single();

  if (!league) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }

  // Get games (filter to player's team if they have one)
  const gamesQuery = supabase
    .from("games")
    .select("*")
    .eq("league_id", player.league_id)
    .neq("status", "cancelled")
    .order("scheduled_at");

  if (player.team_id) {
    gamesQuery.or(
      `home_team_id.eq.${player.team_id},away_team_id.eq.${player.team_id}`
    );
  }

  const { data: games } = await gamesQuery;

  // Get teams
  const { data: teams } = await supabase
    .from("teams")
    .select("*")
    .eq("league_id", player.league_id);

  const teamsMap = new Map(
    (teams || []).map((t) => [t.id, t as Team])
  );

  const ical = generateIcalFeed(
    (games || []) as Game[],
    teamsMap,
    (league as League).name
  );

  return new NextResponse(ical, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "attachment; filename=league.ics",
    },
  });
}
