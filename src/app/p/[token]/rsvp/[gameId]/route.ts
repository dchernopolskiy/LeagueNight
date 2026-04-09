import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; gameId: string }> }
) {
  const { token, gameId } = await params;
  const action = request.nextUrl.searchParams.get("action");

  if (!action || !["yes", "no", "maybe"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Resolve player from token
  const { data: player } = await supabase
    .from("players")
    .select("id, league_id")
    .eq("token", token)
    .single();

  if (!player) {
    return NextResponse.json({ error: "Invalid token" }, { status: 404 });
  }

  // Verify game belongs to this league
  const { data: game } = await supabase
    .from("games")
    .select("id, league_id")
    .eq("id", gameId)
    .eq("league_id", player.league_id)
    .single();

  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }

  // Upsert RSVP
  const { error } = await supabase.from("rsvps").upsert(
    {
      game_id: gameId,
      player_id: player.id,
      response: action,
      responded_at: new Date().toISOString(),
    },
    { onConflict: "game_id,player_id" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Redirect back to player portal
  const url = new URL(`/p/${token}`, request.url);
  url.searchParams.set("rsvp", "success");
  return NextResponse.redirect(url);
}
