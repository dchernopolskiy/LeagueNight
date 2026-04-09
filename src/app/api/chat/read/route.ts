import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/chat/read
 * Body: { leagueId, channelKey }
 * Upserts read cursor for current user.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("auth_id", user.id)
    .single();
  if (!profile) return NextResponse.json({ error: "No profile" }, { status: 401 });

  const { leagueId, channelKey } = await req.json();
  if (!leagueId || !channelKey) {
    return NextResponse.json({ error: "Missing leagueId or channelKey" }, { status: 400 });
  }

  const { error } = await supabase.from("chat_read_cursors").upsert(
    {
      profile_id: profile.id,
      league_id: leagueId,
      channel_key: channelKey,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: "profile_id,league_id,channel_key" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
