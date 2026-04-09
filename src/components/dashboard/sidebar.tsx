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
} from "lucide-react";
import { useState } from "react";

const navItems = [
  { href: "/dashboard", label: "My Leagues", icon: LayoutDashboard },
  { href: "/dashboard/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/dashboard/locations", label: "Locations", icon: MapPin },
  { href: "/dashboard/open-gym", label: "Open Gym", icon: Dumbbell },
  { href: "/dashboard/leagues/new", label: "New League", icon: Plus },
];

export function DashboardSidebar({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const nav = (
    <>
      <div className="p-4 border-b">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Trophy className="h-5 w-5" />
          <span className="font-semibold text-lg">LeagueNight</span>
        </Link>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => (
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
          </Link>
        ))}
      </nav>
      <div className="p-3 border-t">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-sm truncate">{profile.full_name}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="h-8 w-8 p-0"
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
