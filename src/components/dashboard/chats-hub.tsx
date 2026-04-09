"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";

interface Division {
  id: string;
  name: string;
}

interface League {
  id: string;
  name: string;
  sport: string | null;
  divisions: Division[];
}

interface LatestMessage {
  content: string;
  created_at: string;
}

const SPORT_COLORS: Record<string, string> = {
  Volleyball: "bg-blue-100 text-blue-800",
  Basketball: "bg-orange-100 text-orange-800",
  Pickleball: "bg-emerald-100 text-emerald-800",
  Soccer: "bg-green-100 text-green-800",
  Tennis: "bg-yellow-100 text-yellow-800",
};

export function ChatsHub({
  leagues,
  latestMessages,
}: {
  leagues: League[];
  latestMessages: Record<string, LatestMessage>;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(leagues.map((l) => l.id))
  );

  function toggle(leagueId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(leagueId)) next.delete(leagueId);
      else next.add(leagueId);
      return next;
    });
  }

  // Group leagues by sport
  const sportGroups = new Map<string, League[]>();
  for (const league of leagues) {
    const sport = league.sport || "Other";
    const arr = sportGroups.get(sport) || [];
    arr.push(league);
    sportGroups.set(sport, arr);
  }

  if (leagues.length === 0) {
    return (
      <div className="text-center py-12">
        <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">
          No leagues yet. Create a league to start chatting.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {[...sportGroups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([sport, sportLeagues]) => (
          <div key={sport}>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
              {sport}
            </h2>
            <div className="space-y-1">
              {sportLeagues.map((league) => {
                const isExpanded = expanded.has(league.id);
                const latest = latestMessages[league.id];
                const hasDivisions = league.divisions.length > 1;

                return (
                  <div key={league.id} className="border rounded-lg">
                    {/* League header — always links to league chat */}
                    <div className="flex items-center">
                      {hasDivisions && (
                        <button
                          type="button"
                          className="p-2 text-muted-foreground hover:text-foreground"
                          onClick={() => toggle(league.id)}
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      )}
                      <Link
                        href={`/dashboard/leagues/${league.id}/chat`}
                        className={`flex-1 flex items-center justify-between py-2.5 ${hasDivisions ? "pr-3" : "px-3"} hover:bg-accent/50 rounded-lg transition-colors`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="text-sm font-medium truncate">
                            {league.name}
                          </span>
                          {league.sport && (
                            <Badge
                              variant="outline"
                              className={`text-[10px] shrink-0 ${SPORT_COLORS[league.sport] || ""}`}
                            >
                              {league.sport}
                            </Badge>
                          )}
                        </div>
                        {latest && (
                          <div className="text-right ml-3 shrink-0">
                            <p className="text-[10px] text-muted-foreground">
                              {formatDistanceToNow(new Date(latest.created_at), {
                                addSuffix: true,
                              })}
                            </p>
                            <p className="text-xs text-muted-foreground truncate max-w-[180px]">
                              {latest.content}
                            </p>
                          </div>
                        )}
                      </Link>
                    </div>

                    {/* Division sub-chats */}
                    {hasDivisions && isExpanded && (
                      <div className="border-t ml-6 mr-3 mb-2">
                        {league.divisions.map((div) => (
                          <Link
                            key={div.id}
                            href={`/dashboard/leagues/${league.id}/chat?division=${div.id}`}
                            className="flex items-center gap-2 py-2 px-3 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/30 rounded transition-colors"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
                            {div.name}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}
