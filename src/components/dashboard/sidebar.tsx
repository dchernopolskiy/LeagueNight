"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Profile } from "@/lib/types";
import {
  LayoutDashboard,
  Trophy,
  Plus,
  LogOut,
  Menu,
  X,
  CalendarDays,
  MapPin,
  Dumbbell,
  MessageSquare,
  UserCircle,
  Download,
  ShieldCheck,
  Zap,
  MoreHorizontal,
} from "lucide-react";
import { useState } from "react";
import { useUnread } from "@/lib/hooks/use-unread";

/** Items visible to all users */
const playerItems = [
  { href: "/dashboard", label: "My Leagues", icon: LayoutDashboard },
  { href: "/dashboard/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/dashboard/chats", label: "Chats", icon: MessageSquare },
  { href: "/dashboard/scoreboard", label: "Record Scores", icon: Zap },
];

/** Items only visible to organizers / staff */
const organizerItems = [
  { href: "/dashboard/locations", label: "Locations", icon: MapPin },
  { href: "/dashboard/open-gym", label: "Open Gym", icon: Dumbbell },
  { href: "/dashboard/exports", label: "Exports", icon: Download },
  { href: "/dashboard/leagues/new", label: "New League", icon: Plus },
  { href: "/dashboard/admin", label: "Admin", icon: ShieldCheck },
];

/** Mobile bottom tab items — the 4 most-used + More */
const bottomTabs = [
  { href: "/dashboard", label: "Leagues", icon: LayoutDashboard },
  { href: "/dashboard/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/dashboard/scoreboard", label: "Scores", icon: Zap },
  { href: "/dashboard/chats", label: "Chats", icon: MessageSquare },
];

export function DashboardSidebar({
  profile,
  isOrganizerOfAny = false,
}: {
  profile: Profile;
  isOrganizerOfAny?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { totalUnread } = useUnread();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  function renderNavItem(item: (typeof playerItems)[0]) {
    const active = isActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
          active
            ? "bg-accent text-accent-foreground font-medium"
            : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
        )}
      >
        <item.icon className="h-[18px] w-[18px] shrink-0" />
        <span className="truncate">{item.label}</span>
        {item.label === "Chats" && totalUnread > 0 && (
          <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warm text-warm-foreground text-[10px] font-semibold px-1">
            {totalUnread > 99 ? "99+" : totalUnread}
          </span>
        )}
      </Link>
    );
  }

  const sidebarContent = (
    <>
      <div className="p-5 pb-4">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-foreground text-background flex items-center justify-center">
            <Trophy className="h-4 w-4" />
          </div>
          <span className="font-heading text-lg font-semibold tracking-tight">
            LeagueNight
          </span>
        </Link>
      </div>
      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
        {playerItems.map(renderNavItem)}

        {/* Organizer section */}
        {isOrganizerOfAny ? (
          <>
            <div className="pt-6 pb-1.5 px-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                Organizer Tools
              </p>
            </div>
            {organizerItems.map(renderNavItem)}
          </>
        ) : (
          <div className="pt-6 pb-1 px-3">
            <div className="border-t pt-4">
              <p className="text-[10px] text-muted-foreground/50 leading-relaxed">
                Create your own leagues to access organizer tools
              </p>
              <Link
                href="/dashboard/leagues/new"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 mt-1 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              >
                <Plus className="h-[18px] w-[18px]" />
                New League
              </Link>
            </div>
          </div>
        )}
      </nav>
      <div className="p-3 border-t">
        <div className="flex items-center gap-2 px-3 py-2">
          <Link
            href="/dashboard/profile"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-2.5 flex-1 min-w-0 rounded-lg hover:bg-accent/50 -mx-1 px-1 py-1.5 transition-colors"
          >
            <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0">
              <span className="text-xs font-medium text-muted-foreground">
                {profile.full_name?.charAt(0)?.toUpperCase() || "?"}
              </span>
            </div>
            <span className="text-sm truncate">{profile.full_name}</span>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="h-8 w-8 p-0 shrink-0"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* ─── DESKTOP SIDEBAR ─── */}
      <aside className="hidden md:flex h-full w-64 bg-sidebar border-r flex-col shrink-0">
        {sidebarContent}
      </aside>

      {/* ─── MOBILE: Top bar ─── */}
      <header className="fixed top-0 left-0 right-0 z-40 md:hidden bg-background/80 backdrop-blur-lg border-b">
        <div className="flex items-center justify-between h-12 px-4">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-foreground text-background flex items-center justify-center">
              <Trophy className="h-3 w-3" />
            </div>
            <span className="font-heading text-sm font-semibold tracking-tight">
              LeagueNight
            </span>
          </Link>
          <div className="flex items-center gap-1">
            <Link
              href="/dashboard/profile"
              className="h-8 w-8 rounded-full bg-muted flex items-center justify-center"
            >
              <span className="text-xs font-medium text-muted-foreground">
                {profile.full_name?.charAt(0)?.toUpperCase() || "?"}
              </span>
            </Link>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? (
                <X className="h-4 w-4" />
              ) : (
                <MoreHorizontal className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </header>

      {/* ─── MOBILE: Full nav overlay (from "More" button) ─── */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed top-12 right-0 bottom-0 w-72 bg-card z-50 md:hidden flex flex-col border-l shadow-2xl animate-in slide-in-from-right duration-200">
            <nav className="flex-1 p-3 pt-4 space-y-0.5 overflow-y-auto">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 px-3 pb-2">
                Menu
              </p>
              {playerItems.map(renderNavItem)}

              {isOrganizerOfAny && (
                <>
                  <div className="pt-5 pb-1.5 px-3">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                      Organizer Tools
                    </p>
                  </div>
                  {organizerItems.map(renderNavItem)}
                </>
              )}

              {!isOrganizerOfAny && (
                <div className="pt-5 pb-1 px-3">
                  <div className="border-t pt-4">
                    <p className="text-[10px] text-muted-foreground/50 leading-relaxed">
                      Create your own leagues to access organizer tools
                    </p>
                    <Link
                      href="/dashboard/leagues/new"
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-3 px-3 py-2.5 mt-1 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                    >
                      <Plus className="h-[18px] w-[18px]" />
                      New League
                    </Link>
                  </div>
                </div>
              )}
            </nav>
            <div className="p-3 border-t">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="w-full justify-start gap-2 text-muted-foreground"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </Button>
            </div>
          </div>
        </>
      )}

      {/* ─── MOBILE: Bottom tab bar ─── */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-background/80 backdrop-blur-lg border-t pb-safe">
        <div className="flex items-center justify-around h-14">
          {bottomTabs.map((tab) => {
            const active = isActive(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 flex-1 h-full relative transition-colors",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-warm rounded-full" />
                )}
                <tab.icon
                  className={cn("h-5 w-5", active && "text-warm")}
                />
                <span className="text-[10px] font-medium">{tab.label}</span>
                {tab.label === "Chats" && totalUnread > 0 && (
                  <span className="absolute top-1.5 left-1/2 translate-x-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warm text-warm-foreground text-[9px] font-bold px-0.5">
                    {totalUnread > 99 ? "99+" : totalUnread}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
