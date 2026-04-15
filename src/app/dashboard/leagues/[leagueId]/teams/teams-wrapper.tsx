"use client";

import { useLeagueRole } from "@/lib/league-role-context";
import { TeamsManager } from "@/components/dashboard/teams-manager";
import type { Team, Player, Division } from "@/lib/types";

export function TeamsManagerWrapper(props: {
  leagueId: string;
  initialTeams: Team[];
  initialPlayers: Player[];
  divisions?: Division[];
  activeDivisionId?: string;
}) {
  const { canManage, playerId } = useLeagueRole();
  return <TeamsManager {...props} canManage={canManage} currentPlayerId={playerId} />;
}
