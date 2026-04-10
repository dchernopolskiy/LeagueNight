import { createClient as createServerClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/supabase/helpers";
import { redirect } from "next/navigation";
import { ChatsHub } from "@/components/dashboard/chats-hub";

export default async function ChatsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createServerClient();

  // Fetch owned leagues + co-organized leagues + player leagues
  const [ownedRes, staffRes, playerRes] = await Promise.all([
    supabase
      .from("leagues")
      .select("id, name, sport, divisions(id, name)")
      .eq("organizer_id", profile.id)
      .order("name"),
    supabase
      .from("league_staff")
      .select("leagues(id, name, sport, divisions(id, name))")
      .eq("profile_id", profile.id),
    supabase
      .from("players")
      .select("leagues(id, name, sport, divisions(id, name))")
      .eq("profile_id", profile.id),
  ]);

  const ownedIds = new Set((ownedRes.data || []).map((l) => l.id));
  const staffLeagues = (staffRes.data || [])
    .map((s: any) => s.leagues)
    .filter((l: any) => l && !ownedIds.has(l.id));
  const knownIds = new Set([...ownedIds, ...staffLeagues.map((l: any) => l.id)]);
  const playerLeagues = (playerRes.data || [])
    .map((p: any) => p.leagues)
    .filter((l: any) => l && !knownIds.has(l.id));
  const leagues = [...(ownedRes.data || []), ...staffLeagues, ...playerLeagues];

  // Fetch latest message per league for preview
  const leagueIds = leagues.map((l: any) => l.id);
  let latestMessages: Record<string, { content: string; created_at: string }> = {};

  if (leagueIds.length > 0) {
    const { data: messages } = await supabase
      .from("messages")
      .select("league_id, content, created_at")
      .in("league_id", leagueIds)
      .order("created_at", { ascending: false });

    if (messages) {
      for (const msg of messages) {
        if (!latestMessages[msg.league_id]) {
          latestMessages[msg.league_id] = {
            content: msg.content,
            created_at: msg.created_at,
          };
        }
      }
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Chats</h1>
      <ChatsHub
        leagues={(leagues || []) as any}
        latestMessages={latestMessages}
      />
    </div>
  );
}
