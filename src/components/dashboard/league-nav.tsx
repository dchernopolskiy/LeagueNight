"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  Calendar,
  ClipboardCheck,
  Trophy,
  Swords,
  UserPlus,
  MessageSquare,
  CreditCard,
  Settings,
} from "lucide-react";
import type { Division } from "@/lib/types";
import { useUnread } from "@/lib/hooks/use-unread";

const tabs = [
  { suffix: "", label: "Overview", icon: LayoutDashboard },
  { suffix: "/teams", label: "Teams", icon: Users },
  { suffix: "/schedule", label: "Schedule", icon: Calendar },
  { suffix: "/availability", label: "Availability", icon: ClipboardCheck },
  { suffix: "/standings", label: "Standings", icon: Trophy },
  { suffix: "/playoffs", label: "Playoffs", icon: Swords },
  { suffix: "/subs", label: "Subs", icon: UserPlus },
  { suffix: "/chat", label: "Chat", icon: MessageSquare },
  { suffix: "/payments", label: "Payments", icon: CreditCard },
  { suffix: "/settings", label: "Settings", icon: Settings },
];

const LEVEL_COLORS: Record<number, string> = {
  1: "bg-amber-500",
  2: "bg-blue-500",
  3: "bg-green-500",
  4: "bg-purple-500",
  5: "bg-gray-400",
};

export function LeagueNav({
  leagueId,
  divisions = [],
}: {
  leagueId: string;
  divisions?: Division[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const base = `/dashboard/leagues/${leagueId}`;
  const activeDivision = searchParams.get("division");
  const { leagues: leagueUnread } = useUnread();
  const unreadCount = leagueUnread[leagueId] || 0;

  return (
    <div className="space-y-2">
      {/* Primary tab nav */}
      <nav className="flex gap-1 overflow-x-auto border-b pb-px -mb-px">
        {tabs.map((tab) => {
          const tabPath = `${base}${tab.suffix}`;
          const href = activeDivision
            ? `${tabPath}?division=${activeDivision}`
            : tabPath;
          const isActive =
            tab.suffix === ""
              ? pathname === tabPath
              : pathname.startsWith(tabPath);

          return (
            <Link
              key={tab.suffix}
              href={href}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap border-b-2 transition-colors",
                isActive
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              {tab.suffix === "/chat" && unreadCount > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary text-primary-foreground text-[9px] font-semibold px-0.5">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Division filter chips — shown on pages that support division filtering */}
      {divisions.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto py-1">
          <span className="text-xs text-muted-foreground shrink-0 mr-1">Division:</span>
          <Link
            href={pathname}
            className={cn(
              "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
              !activeDivision
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            All
          </Link>
          {divisions.map((div) => {
            const isActive = activeDivision === div.id;
            const color = LEVEL_COLORS[div.level] || LEVEL_COLORS[5];
            return (
              <Link
                key={div.id}
                href={`${pathname}?division=${div.id}`}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
                {div.name}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
