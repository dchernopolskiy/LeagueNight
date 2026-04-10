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
} from "lucide-react";
import { useState } from "react";
import { useUnread } from "@/lib/hooks/use-unread";

/** Items visible to all users */
const playerItems = [
  { href: "/dashboard", label: "My Leagues", icon: LayoutDashboard },
  { href: "/dashboard/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/dashboard/chats", label: "Chats", icon: MessageSquare },
  { href: "/dashboard/scoreboard", label: "Scoreboard", icon: Zap },
];

/** Items only visible to organizers / staff */
const organizerItems = [
  { href: "/dashboard/locations", label: "Locations", icon: MapPin },
  { href: "/dashboard/open-gym", label: "Open Gym", icon: Dumbbell },
  { href: "/dashboard/exports", label: "Exports", icon: Download },
  { href: "/dashboard/leagues/new", label: "New League", icon: Plus },
  { href: "/dashboard/admin", label: "Admin", icon: ShieldCheck },
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

  function renderNavItem(item: (typeof playerItems)[0]) {
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
          pathname === item.href
            ? "bg-accent text-accent-foreground font-medium"
            : "text-muted-foreground hover:bg-accent/50"
        )}
      >
        <item.icon className="h-4 w-4" />
        {item.label}
        {item.label === "Chats" && totalUnread > 0 && (
          <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-semibold px-1">
            {totalUnread > 99 ? "99+" : totalUnread}
          </span>
        )}
      </Link>
    );
  }

  const nav = (
    <>
      <div className="p-4 border-b">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Trophy className="h-5 w-5" />
          <span className="font-semibold text-lg">LeagueNight</span>
        </Link>
      </div>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {playerItems.map(renderNavItem)}

        {/* Organizer section */}
        {isOrganizerOfAny ? (
          <>
            <div className="pt-4 pb-1 px-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                Organizer Tools
              </p>
            </div>
            {organizerItems.map(renderNavItem)}
          </>
        ) : (
          <>
            <div className="pt-4 pb-1 px-3">
              <div className="border-t pt-3">
                <p className="text-[10px] text-muted-foreground/50 leading-relaxed">
                  Create your own leagues to access organizer tools
                </p>
                <Link
                  href="/dashboard/leagues/new"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 mt-1 rounded-md text-sm text-muted-foreground hover:bg-accent/50 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  New League
                </Link>
              </div>
            </div>
          </>
        )}
      </nav>
      <div className="p-3 border-t">
        <div className="flex items-center gap-2 px-3 py-2">
          <Link
            href="/dashboard/profile"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-2 flex-1 min-w-0 rounded-md hover:bg-accent/50 -mx-1 px-1 py-1 transition-colors"
          >
            <UserCircle className="h-5 w-5 shrink-0 text-muted-foreground" />
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
      {/* Mobile toggle */}
      <Button
        variant="ghost"
        size="sm"
        className="fixed top-3 left-3 z-50 md:hidden"
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed md:static z-40 h-full w-64 bg-card border-r flex flex-col transition-transform md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {nav}
      </aside>
    </>
  );
}
