import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * GET /api/chat/unread
 * Returns unread message counts per league and per channel.
 * Response: { leagues: Record<leagueId, number>, channels: Record<`${leagueId}:${channelKey}`, number> }
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

  // Get all leagues this user is associated with (as organizer or staff or player)
  const [orgRes, staffRes, playerRes] = await Promise.all([
    supabase.from("leagues").select("id").eq("organizer_id", profile.id),
    supabase.from("league_staff").select("league_id").eq("profile_id", profile.id),
    supabase.from("players").select("league_id").eq("profile_id", profile.id),
  ]);

  const leagueIds = new Set<string>();
  for (const l of orgRes.data || []) leagueIds.add(l.id);
  for (const s of staffRes.data || []) leagueIds.add(s.league_id);
  for (const p of playerRes.data || []) leagueIds.add(p.league_id);

  if (leagueIds.size === 0) return NextResponse.json({ leagues: {}, channels: {} });

  const ids = [...leagueIds];

  // Get read cursors
  const { data: cursors } = await supabase
    .from("chat_read_cursors")
    .select("*")
    .eq("profile_id", profile.id)
    .in("league_id", ids);

  const cursorMap = new Map<string, string>(); // "leagueId:channelKey" -> last_read_at
  for (const c of cursors || []) {
    cursorMap.set(`${c.league_id}:${c.channel_key}`, c.last_read_at);
  }

  // Get message counts per league+channel since last read
  // We'll query recent messages (last 30 days) and count unread
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: messages } = await supabase
    .from("messages")
    .select("league_id, channel_type, team_id, division_id, created_at")
    .in("league_id", ids)
    .is("deleted_at", null)
    .gte("created_at", thirtyDaysAgo)
    .order("created_at", { ascending: false })
    .limit(1000);

  const leagues: Record<string, number> = {};
  const channels: Record<string, number> = {};

  for (const msg of messages || []) {
    // Determine channel key
    let channelKey = msg.channel_type;
    if (msg.channel_type === "team" && msg.team_id) channelKey = `team-${msg.team_id}`;
    else if (msg.channel_type === "division" && msg.division_id) channelKey = `division-${msg.division_id}`;
    else if (msg.channel_type === "direct" && msg.team_id) channelKey = `direct-${msg.team_id}`;

    const cursorKey = `${msg.league_id}:${channelKey}`;
    const lastRead = cursorMap.get(cursorKey);

    if (!lastRead || msg.created_at > lastRead) {
      leagues[msg.league_id] = (leagues[msg.league_id] || 0) + 1;
      const fullKey = `${msg.league_id}:${channelKey}`;
      channels[fullKey] = (channels[fullKey] || 0) + 1;
    }
  }

  return NextResponse.json({ leagues, channels });
}
