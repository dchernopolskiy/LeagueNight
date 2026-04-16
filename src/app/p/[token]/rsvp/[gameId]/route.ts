import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

const VALID_ACTIONS = new Set(["yes", "no", "maybe"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; gameId: string }> }
) {
  const { token, gameId } = await params;

  // Read action from form body (native <form method="post">) or query string
  let action: string | null = null;
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    action = form.get("action")?.toString() ?? null;
  }
  if (!action) {
    action = request.nextUrl.searchParams.get("action");
  }

  if (!action || !VALID_ACTIONS.has(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: player } = await supabase
    .from("players")
    .select("id, league_id")
    .eq("token", token)
    .single();

  if (!player) {
    return NextResponse.json({ error: "Invalid token" }, { status: 404 });
  }

  const { data: game } = await supabase
    .from("games")
    .select("id, league_id")
    .eq("id", gameId)
    .eq("league_id", player.league_id)
    .single();

  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }

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

  const url = new URL(`/p/${token}`, request.url);
  url.searchParams.set("rsvp", "success");
  // 303 ensures the browser uses GET on the redirect target
  return NextResponse.redirect(url, 303);
}
