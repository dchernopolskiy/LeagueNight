"use client";

import { useState } from "react";
import Link from "next/link";
import { MessageSquare, ChevronDown, ChevronRight, Hash, Lock, Users, Megaphone, Crown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { useUnread } from "@/lib/hooks/use-unread";

// ── Types ────────────────────────────────────────────────────────────────────

interface Division {
  id: string;
  name: string;
}

interface LeagueEntry {
  id: string;
  name: string;
  sport: string | null;
  role: "organizer" | "staff" | "player";
  divisions: Division[];
  userTeamId: string | null;
  userDivisionId: string | null;
}

interface LatestMessage {
  body: string;
  created_at: string;
}

interface Props {
  leagues: LeagueEntry[];
  teamsByLeague: Record<string, { id: string; name: string }[]>;
  playerTeamNames: Record<string, string>;
  latestMessages: Record<string, LatestMessage>;
}

// ── Channel definition ───────────────────────────────────────────────────────

interface Channel {
  label: string;
  href: string;
  channelKey: string; // matches use-unread key: "league", "organizer", `team-${id}`, etc.
  icon: "hash" | "lock" | "users" | "announce" | "team";
  description?: string;
}

const SPORT_BADGE: Record<string, string> = {
  Volleyball: "bg-blue-100 text-blue-800 border-blue-200",
  Basketball: "bg-orange-100 text-orange-800 border-orange-200",
  Pickleball: "bg-emerald-100 text-emerald-800 border-emerald-200",
  Soccer: "bg-green-100 text-green-800 border-green-200",
  Tennis: "bg-yellow-100 text-yellow-800 border-yellow-200",
  Softball: "bg-red-100 text-red-800 border-red-200",
  Baseball: "bg-amber-100 text-amber-800 border-amber-200",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildChannels(
  league: LeagueEntry,
  teams: { id: string; name: string }[],
  playerTeamNames: Record<string, string>
): Channel[] {
  const base = `/dashboard/leagues/${league.id}/chat`;
  const isManager = league.role === "organizer" || league.role === "staff";
  const channels: Channel[] = [];

  // League-wide channel — everyone sees this
  channels.push({
    label: "league-chat",
    href: base,
    channelKey: "league",
    icon: "hash",
    description: "All players & staff",
  });

  // Organizer-only channel
  if (isManager) {
    channels.push({
      label: "organizer",
      href: `${base}?channel=organizer`,
      channelKey: "organizer",
      icon: "lock",
      description: "Staff only",
    });
  }

  // Division channels — managers see all, players see only their own
  if (league.divisions.length > 1) {
    const visibleDivisions = isManager
      ? league.divisions
      : league.divisions.filter((d) => d.id === league.userDivisionId);

    for (const div of visibleDivisions) {
      channels.push({
        label: div.name.toLowerCase().replace(/\s+/g, "-"),
        href: `${base}?division=${div.id}`,
        channelKey: `division-${div.id}`,
        icon: "hash",
        description: div.name,
      });
    }
  }

  // Team channels — managers see all, player sees only their own
  if (isManager) {
    for (const team of teams) {
      channels.push({
        label: team.name.toLowerCase().replace(/\s+/g, "-"),
        href: `${base}?team=${team.id}`,
        channelKey: `team-${team.id}`,
        icon: "team",
        description: team.name,
      });
    }
  } else if (league.userTeamId) {
    const teamName = playerTeamNames[league.userTeamId] || "my-team";
    channels.push({
      label: teamName.toLowerCase().replace(/\s+/g, "-"),
      href: `${base}?team=${league.userTeamId}`,
      channelKey: `team-${league.userTeamId}`,
      icon: "team",
      description: teamName,
    });
  }

  return channels;
}

function ChannelIcon({ type }: { type: Channel["icon"] }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  if (type === "lock") return <Lock className={cls} />;
  if (type === "users") return <Users className={cls} />;
  if (type === "announce") return <Megaphone className={cls} />;
  if (type === "team") return <Users className={cls} />;
  return <Hash className={cls} />;
}

function UnreadDot({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="ml-auto text-[10px] font-semibold bg-primary text-primary-foreground rounded-full px-1.5 py-px min-w-[18px] text-center leading-tight">
      {count > 99 ? "99+" : count}
    </span>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function ChatsHub({ leagues, teamsByLeague, playerTeamNames, latestMessages }: Props) {
  const { channels: unreadChannels, leagues: unreadLeagues } = useUnread();

  // All leagues collapsed by default
  const [collapsed, setCollapsed] = useState<Set<string>>(
    new Set(leagues.map((l) => l.id))
  );

  function toggleLeague(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (leagues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <MessageSquare className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium text-muted-foreground">No leagues yet</p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Create or join a league to start chatting.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <h1 className="text-lg font-semibold px-1 mb-4">Chats</h1>

      {leagues.map((league) => {
        const teams = teamsByLeague[league.id] || [];
        const channels = buildChannels(league, teams, playerTeamNames);
        const isCollapsed = collapsed.has(league.id);
        const latest = latestMessages[league.id];
        const leagueUnread = unreadLeagues[league.id] || 0;
        const isManager = league.role === "organizer" || league.role === "staff";

        return (
          <div key={league.id} className="rounded-lg border bg-card overflow-hidden">
            {/* ── League header (workspace bar) ────────────────────────── */}
            <button
              type="button"
              className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-accent/50 transition-colors text-left"
              onClick={() => toggleLeague(league.id)}
            >
              {isCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}

              {/* League name */}
              <span className="font-semibold text-sm truncate flex-1">{league.name}</span>

              {/* Role badge */}
              {isManager && (
                <Crown className="h-3 w-3 text-amber-500 shrink-0" />
              )}

              {/* Sport badge */}
              {league.sport && (
                <Badge
                  variant="outline"
                  className={`text-[10px] shrink-0 ${SPORT_BADGE[league.sport] || "bg-muted text-muted-foreground"}`}
                >
                  {league.sport}
                </Badge>
              )}

              {/* Collapsed unread indicator */}
              {isCollapsed && leagueUnread > 0 && (
                <UnreadDot count={leagueUnread} />
              )}

              {/* Latest message preview (collapsed only) */}
              {isCollapsed && latest && leagueUnread === 0 && (
                <span className="text-[10px] text-muted-foreground ml-1 truncate max-w-[120px] hidden sm:block">
                  {formatDistanceToNow(new Date(latest.created_at), { addSuffix: true })}
                </span>
              )}
            </button>

            {/* ── Channel list ──────────────────────────────────────────── */}
            {!isCollapsed && (
              <div className="border-t">
                {channels.map((ch) => {
                  const fullKey = `${league.id}:${ch.channelKey}`;
                  const unread = unreadChannels[fullKey] || 0;
                  const hasUnread = unread > 0;

                  return (
                    <Link
                      key={ch.channelKey}
                      href={ch.href}
                      className={`flex items-center gap-2 px-4 py-1.5 text-sm transition-colors group
                        ${hasUnread
                          ? "text-foreground font-medium hover:bg-accent/60"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                        }`}
                    >
                      <ChannelIcon type={ch.icon} />
                      <span className="truncate flex-1">{ch.label}</span>
                      <UnreadDot count={unread} />
                    </Link>
                  );
                })}

                {/* Latest message footer */}
                {latest && (
                  <div className="px-4 py-2 border-t bg-muted/20">
                    <p className="text-[10px] text-muted-foreground truncate">
                      <span className="font-medium">Latest: </span>
                      {latest.body}
                    </p>
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                      {formatDistanceToNow(new Date(latest.created_at), { addSuffix: true })}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
