import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * GET /api/chat/unread
 * Returns unread message counts per league and per channel.
 * Response: { leagues: Record<leagueId, number>, channels: Record<`${leagueId}:${channelKey}`, number> }
 *
 * Aggregation happens in Postgres via the `unread_counts_for_profile` RPC —
 * see supabase/migrations/019_unread_counts_rpc.sql. The previous implementation
 * pulled up to 1000 messages and counted them in JS, which silently under-counted
 * once a league exceeded that threshold.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ leagues: {}, channels: {} });

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("auth_id", user.id)
    .single();
  if (!profile) return NextResponse.json({ leagues: {}, channels: {} });

  const { data: rows, error } = await supabase.rpc("unread_counts_for_profile", {
    p_profile_id: profile.id,
  });

  if (error) {
    return NextResponse.json(
      { leagues: {}, channels: {}, error: error.message },
      { status: 500 }
    );
  }

  const leagues: Record<string, number> = {};
  const channels: Record<string, number> = {};

  for (const row of (rows || []) as Array<{
    league_id: string;
    channel_key: string;
    unread_count: number;
  }>) {
    const count = Number(row.unread_count) || 0;
    leagues[row.league_id] = (leagues[row.league_id] || 0) + count;
    channels[`${row.league_id}:${row.channel_key}`] = count;
  }

  return NextResponse.json({ leagues, channels });
}
