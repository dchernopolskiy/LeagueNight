import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const supabase = createAdminClient();

  const { data: player } = await supabase
    .from("players")
    .select("id, name, email, phone, notification_pref, is_sub, team_id, league_id")
    .eq("token", token)
    .single();

  if (!player) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(player);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await request.json();
  const supabase = createAdminClient();

  // Resolve player
  const { data: player } = await supabase
    .from("players")
    .select("id")
    .eq("token", token)
    .single();

  if (!player) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const allowed = ["notification_pref"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  const { error } = await supabase
    .from("players")
    .update(updates)
    .eq("id", player.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
