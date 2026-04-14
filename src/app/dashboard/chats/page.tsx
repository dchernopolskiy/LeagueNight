import { createClient as createServerClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/supabase/helpers";
import { redirect } from "next/navigation";
import { ChatsHub } from "@/components/dashboard/chats-hub";

export default async function ChatsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createServerClient();

  // ── 1. Fetch league memberships ──────────────────────────────────────
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
      .select("league_id, team_id, division_id, leagues(id, name, sport, divisions(id, name))")
      .eq("profile_id", profile.id),
  ]);

  const ownedIds = new Set((ownedRes.data || []).map((l: any) => l.id));
  const staffLeagues = (staffRes.data || [])
    .map((s: any) => s.leagues)
    .filter((l: any) => l && !ownedIds.has(l.id));
  const knownIds = new Set([...ownedIds, ...staffLeagues.map((l: any) => l.id)]);

  // Player rows — for their team/division context
  const playerRows = (playerRes.data || []) as {
    league_id: string;
    team_id: string | null;
    division_id: string | null;
    leagues: any;
  }[];

  // ── 2. Build typed league list ───────────────────────────────────────
  type LeagueEntry = {
    id: string;
    name: string;
    sport: string | null;
    role: "organizer" | "staff" | "player";
    divisions: { id: string; name: string }[];
    userTeamId: string | null;
    userDivisionId: string | null;
  };

  const leagues: LeagueEntry[] = [
    ...(ownedRes.data || []).map((l: any) => ({
      id: l.id,
      name: l.name,
      sport: l.sport,
      role: "organizer" as const,
      divisions: l.divisions || [],
      userTeamId: null,
      userDivisionId: null,
    })),
    ...staffLeagues.map((l: any) => ({
      id: l.id,
      name: l.name,
      sport: l.sport,
      role: "staff" as const,
      divisions: l.divisions || [],
      userTeamId: null,
      userDivisionId: null,
    })),
    ...playerRows
      .filter((p) => p.leagues && !knownIds.has(p.league_id))
      .map((p) => ({
        id: p.league_id,
        name: p.leagues.name,
        sport: p.leagues.sport,
        role: "player" as const,
        divisions: (p.leagues.divisions || []) as { id: string; name: string }[],
        userTeamId: p.team_id,
        userDivisionId: p.division_id,
      })),
  ];

  // ── 3. Fetch teams for organizer/staff leagues ────────────────────────
  const managedLeagueIds = leagues
    .filter((l) => l.role === "organizer" || l.role === "staff")
    .map((l) => l.id);

  let teamsByLeague: Record<string, { id: string; name: string }[]> = {};
  if (managedLeagueIds.length > 0) {
    const { data: allTeams } = await supabase
      .from("teams")
      .select("id, name, league_id")
      .in("league_id", managedLeagueIds)
      .order("name");
    for (const team of allTeams || []) {
      if (!teamsByLeague[team.league_id]) teamsByLeague[team.league_id] = [];
      teamsByLeague[team.league_id].push({ id: team.id, name: team.name });
    }
  }

  // For player leagues: fetch their team name if they have a team
  const playerTeamIds = playerRows
    .filter((p) => p.team_id && !knownIds.has(p.league_id))
    .map((p) => p.team_id as string);
  let playerTeamNames: Record<string, string> = {};
  if (playerTeamIds.length > 0) {
    const { data: playerTeams } = await supabase
      .from("teams")
      .select("id, name")
      .in("id", playerTeamIds);
    for (const t of playerTeams || []) playerTeamNames[t.id] = t.name;
  }

  // ── 4. Latest message per league ─────────────────────────────────────
  const leagueIds = leagues.map((l) => l.id);
  let latestMessages: Record<string, { body: string; created_at: string }> = {};

  if (leagueIds.length > 0) {
    const { data: messages } = await supabase
      .from("messages")
      .select("league_id, body, created_at")
      .in("league_id", leagueIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200);

    if (messages) {
      for (const msg of messages) {
        if (!latestMessages[msg.league_id]) {
          latestMessages[msg.league_id] = {
            body: msg.body,
            created_at: msg.created_at,
          };
        }
      }
    }
  }

  return (
    <ChatsHub
      leagues={leagues}
      teamsByLeague={teamsByLeague}
      playerTeamNames={playerTeamNames}
      latestMessages={latestMessages}
    />
  );
}
