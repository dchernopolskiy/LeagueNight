import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/supabase/helpers";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { LeagueNav } from "@/components/dashboard/league-nav";
import { UpcomingMatchBanner } from "@/components/dashboard/upcoming-match-banner";
import { ChevronRight, Home } from "lucide-react";
import type { League, Division } from "@/lib/types";

export default async function LeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const [leagueRes, divisionsRes, staffRes, playerRes] = await Promise.all([
    supabase
      .from("leagues")
      .select("*")
      .eq("id", leagueId)
      .single(),
    supabase
      .from("divisions")
      .select("*")
      .eq("league_id", leagueId)
      .order("level"),
    supabase
      .from("league_staff")
      .select("profile_id")
      .eq("league_id", leagueId)
      .eq("profile_id", profile.id),
    supabase
      .from("players")
      .select("id")
      .eq("league_id", leagueId)
      .eq("profile_id", profile.id)
      .limit(1),
  ]);

  // Allow access if organizer, co-organizer, or player
  const isOrganizer = leagueRes.data?.organizer_id === profile.id;
  const isStaff = (staffRes.data || []).length > 0;
  const isPlayer = (playerRes.data || []).length > 0;
  if (!leagueRes.data || (!isOrganizer && !isStaff && !isPlayer)) notFound();

  const league = leagueRes.data as League;
  const divisions = (divisionsRes.data || []) as Division[];

  return (
    <div>
      {/* Breadcrumb navigation */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-3">
        <Link
          href="/dashboard"
          className="hover:text-foreground transition-colors flex items-center gap-1"
        >
          <Home className="h-3.5 w-3.5" />
          Dashboard
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium">{league.name}</span>
      </nav>

      {/* League header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold">{league.name}</h1>
        <div className="flex items-center gap-2 mt-0.5">
          {league.season_name && (
            <p className="text-muted-foreground text-sm">{league.season_name}</p>
          )}
          {league.sport && (
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {league.sport}
            </span>
          )}
        </div>
      </div>

      {/* Upcoming match banner for team members */}
      <UpcomingMatchBanner leagueId={leagueId} />

      {/* League sub-nav tabs */}
      <LeagueNav leagueId={leagueId} divisions={divisions} />
      <div className="mt-6">{children}</div>
    </div>
  );
}
