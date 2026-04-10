import { createClient } from "@/lib/supabase/server";
import type { Team, Player, Division } from "@/lib/types";
import { TeamsManagerWrapper } from "./teams-wrapper";

export default async function TeamsPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ division?: string }>;
}) {
  const { leagueId } = await params;
  const { division } = await searchParams;
  const supabase = await createClient();

  const [teamsRes, playersRes, divisionsRes] = await Promise.all([
    supabase
      .from("teams")
      .select("*")
      .eq("league_id", leagueId)
      .order("name"),
    supabase
      .from("players")
      .select("*")
      .eq("league_id", leagueId)
      .order("name"),
    supabase
      .from("divisions")
      .select("*")
      .eq("league_id", leagueId)
      .order("level"),
  ]);

  return (
    <TeamsManagerWrapper
      leagueId={leagueId}
      initialTeams={(teamsRes.data || []) as Team[]}
      initialPlayers={(playersRes.data || []) as Player[]}
      divisions={(divisionsRes.data || []) as Division[]}
      activeDivisionId={division}
    />
  );
}
