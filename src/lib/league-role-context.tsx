"use client";

import { createContext, useContext } from "react";

export type LeagueRole = "organizer" | "staff" | "player";

interface LeagueRoleContextValue {
  role: LeagueRole;
  isOrganizer: boolean;
  isStaff: boolean;
  isPlayer: boolean;
  /** true if organizer or staff — i.e. can manage the league */
  canManage: boolean;
  /** The user's player ID in this league (if they are a player) */
  playerId?: string | null;
}

const LeagueRoleContext = createContext<LeagueRoleContextValue>({
  role: "player",
  isOrganizer: false,
  isStaff: false,
  isPlayer: true,
  canManage: false,
  playerId: null,
});

export function LeagueRoleProvider({
  children,
  role,
  playerId,
}: {
  children: React.ReactNode;
  role: LeagueRole;
  playerId?: string | null;
}) {
  const isOrganizer = role === "organizer";
  const isStaff = role === "staff";
  const isPlayer = role === "player";
  const canManage = isOrganizer || isStaff;

  return (
    <LeagueRoleContext.Provider
      value={{ role, isOrganizer, isStaff, isPlayer, canManage, playerId }}
    >
      {children}
    </LeagueRoleContext.Provider>
  );
}

export function useLeagueRole() {
  return useContext(LeagueRoleContext);
}
