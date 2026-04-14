import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/supabase/helpers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Settings, ChevronRight, Users, Archive } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import type { League, Division, Team } from "@/lib/types";

/** Color accent for division level tiers */
const LEVEL_COLORS: Record<number, string> = {
  1: "bg-amber-500",   // top tier
  2: "bg-blue-500",
  3: "bg-green-500",
  4: "bg-purple-500",
  5: "bg-gray-400",
};

function levelColor(level: number): string {
  return LEVEL_COLORS[level] || LEVEL_COLORS[5];
}

export default async function DashboardPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const [leaguesRes, staffRes, playerRes, divisionsRes, teamsRes, archivedOwnedRes] = await Promise.all([
    supabase
      .from("leagues")
      .select("*")
      .eq("organizer_id", profile.id)
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("league_staff")
      .select("league_id, leagues(*)")
      .eq("profile_id", profile.id),
    supabase
      .from("players")
      .select("league_id, leagues(*)")
      .eq("profile_id", profile.id),
    supabase
      .from("divisions")
      .select("*")
      .order("level"),
    supabase
      .from("teams")
      .select("id, league_id, division_id"),
    supabase
      .from("leagues")
      .select("*")
      .eq("organizer_id", profile.id)
      .not("archived_at", "is", null)
      .order("created_at", { ascending: false }),
  ]);

  // Merge owned leagues + co-organized leagues + player leagues (dedup)
  const ownedIds = new Set((leaguesRes.data || []).map((l: any) => l.id));
  const staffLeagues = (staffRes.data || [])
    .map((s: any) => s.leagues)
    .filter((l: any) => l && !l.archived_at && !ownedIds.has(l.id));
  const knownIds = new Set([...ownedIds, ...staffLeagues.map((l: any) => l.id)]);
  const playerLeagues = (playerRes.data || [])
    .map((p: any) => p.leagues)
    .filter((l: any) => l && !l.archived_at && !knownIds.has(l.id));
  const leagues = [...(leaguesRes.data || []), ...staffLeagues, ...playerLeagues];
  const allDivisions = divisionsRes.data;
  const allTeams = (teamsRes.data || []) as Pick<Team, "id" | "league_id" | "division_id">[];

  // Collect archived leagues from all sources
  const archivedOwnedIds = new Set((archivedOwnedRes.data || []).map((l: any) => l.id));
  const archivedStaffLeagues = (staffRes.data || [])
    .map((s: any) => s.leagues)
    .filter((l: any) => l && l.archived_at && !archivedOwnedIds.has(l.id));
  const archivedKnownIds = new Set([...archivedOwnedIds, ...archivedStaffLeagues.map((l: any) => l.id)]);
  const archivedPlayerLeagues = (playerRes.data || [])
    .map((p: any) => p.leagues)
    .filter((l: any) => l && l.archived_at && !archivedKnownIds.has(l.id));
  const archivedLeagues = [
    ...(archivedOwnedRes.data || []),
    ...archivedStaffLeagues,
    ...archivedPlayerLeagues,
  ] as League[];

  const divisionsByLeague = new Map<string, Division[]>();
  if (allDivisions) {
    for (const div of allDivisions as Division[]) {
      const arr = divisionsByLeague.get(div.league_id) || [];
      arr.push(div);
      divisionsByLeague.set(div.league_id, arr);
    }
  }

  const teamCountByDivision = new Map<string, number>();
  const teamCountByLeague = new Map<string, number>();
  for (const t of allTeams) {
    if (t.division_id) {
      teamCountByDivision.set(t.division_id, (teamCountByDivision.get(t.division_id) || 0) + 1);
    }
    teamCountByLeague.set(t.league_id, (teamCountByLeague.get(t.league_id) || 0) + 1);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8 md:mb-10">
        <h1 className="font-heading text-2xl md:text-3xl font-bold tracking-tight">My Leagues</h1>
        <Button render={<Link href="/dashboard/leagues/new" />}>
          <Plus className="h-4 w-4 mr-2" />
          New League
        </Button>
      </div>

      {!leagues || leagues.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">
              You haven&apos;t created any leagues yet.
            </p>
            <Button render={<Link href="/dashboard/leagues/new" />}>Create your first league</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {(() => {
            const allLeagues = leagues as League[];
            const sportGroups = new Map<string, League[]>();
            for (const league of allLeagues) {
              const sport = league.sport || "Other";
              const group = sportGroups.get(sport) || [];
              group.push(league);
              sportGroups.set(sport, group);
            }
            const sortedSports = [...sportGroups.keys()].sort();

            return sortedSports.map((sport, i) => (
              <div key={sport}>
                {sortedSports.length > 1 && (
                  <>
                    {i > 0 && <Separator className="mb-6" />}
                    <h2 className="font-heading text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">
                      {sport}
                    </h2>
                  </>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  {sportGroups.get(sport)!.map((league) => {
                    const divisions = divisionsByLeague.get(league.id);
                    const hasDivisions = divisions && divisions.length > 0;
                    const totalTeams = teamCountByLeague.get(league.id) || 0;

                    if (hasDivisions) {
                      return (
                        <Card key={league.id}>
                          {/* Clickable card header → league overview */}
                          <Link href={`/dashboard/leagues/${league.id}`}>
                            <CardHeader className="pb-2 hover:bg-accent/40 transition-colors rounded-t-2xl">
                              <div className="flex items-center justify-between">
                                <div>
                                  <CardTitle className="text-lg tracking-tight">{league.name}</CardTitle>
                                  <p className="text-sm text-muted-foreground mt-0.5">
                                    {league.season_name || "No season set"}
                                    <span className="mx-1.5">·</span>
                                    {totalTeams} {totalTeams === 1 ? "team" : "teams"}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {league.sport && (
                                    <Badge variant="secondary">{league.sport}</Badge>
                                  )}
                                </div>
                              </div>
                            </CardHeader>
                          </Link>

                          <CardContent className="pt-0 pb-2">
                            {/* Division rows with level indicators */}
                            <div className="space-y-0.5">
                              {divisions.map((div, di) => {
                                const teamCount = teamCountByDivision.get(div.id) || 0;
                                return (
                                  <Link
                                    key={div.id}
                                    href={`/dashboard/leagues/${league.id}/teams?division=${div.id}`}
                                    className="flex items-center gap-3 py-2.5 px-3 -mx-3 rounded-lg hover:bg-muted/50 transition-colors group"
                                  >
                                    {/* Level indicator bar */}
                                    <div className={`w-1 h-8 rounded-full shrink-0 ${levelColor(div.level)}`} />

                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-semibold">{div.name}</span>
                                        {div.level === 1 && (
                                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-600 border-amber-300">
                                            Top
                                          </Badge>
                                        )}
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-2 text-muted-foreground">
                                      <Users className="h-3.5 w-3.5" />
                                      <span className="text-xs tabular-nums">{teamCount}</span>
                                      <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </div>
                                  </Link>
                                );
                              })}
                            </div>

                            {/* Quick links */}
                            <div className="flex items-center gap-2 mt-2 pt-2 border-t">
                              <Link
                                href={`/dashboard/leagues/${league.id}/schedule`}
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                              >
                                Schedule
                              </Link>
                              <span className="text-muted-foreground/40">·</span>
                              <Link
                                href={`/dashboard/leagues/${league.id}/standings`}
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                              >
                                Standings
                              </Link>
                              <span className="text-muted-foreground/40">·</span>
                              <Link
                                href={`/dashboard/leagues/${league.id}/playoffs`}
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                              >
                                Playoffs
                              </Link>
                              <Link
                                href={`/dashboard/leagues/${league.id}`}
                                className="ml-auto p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                                title="View league overview"
                              >
                                <Settings className="h-3.5 w-3.5" />
                              </Link>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    }

                    // Simple card for leagues without divisions
                    return (
                      <Link
                        key={league.id}
                        href={`/dashboard/leagues/${league.id}`}
                      >
                        <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                          <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-lg">{league.name}</CardTitle>
                              {league.sport && (
                                <Badge variant="secondary">{league.sport}</Badge>
                              )}
                            </div>
                          </CardHeader>
                          <CardContent>
                            <p className="text-sm text-muted-foreground">
                              {league.season_name || "No season set"}
                            </p>
                          </CardContent>
                        </Card>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ));
          })()}
        </div>
      )}

      {archivedLeagues.length > 0 && (
        <details className="mt-12 md:mt-16">
          <summary className="cursor-pointer text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors flex items-center gap-2 select-none font-medium uppercase tracking-widest">
            <Archive className="h-3.5 w-3.5" />
            {archivedLeagues.length} archived {archivedLeagues.length === 1 ? "league" : "leagues"}
          </summary>
          <div className="grid gap-3 sm:grid-cols-2 mt-4">
            {archivedLeagues.map((league) => (
              <Card key={league.id} className="opacity-50 hover:opacity-70 transition-opacity">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{league.name}</CardTitle>
                    {league.sport && (
                      <Badge variant="secondary">{league.sport}</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-3">
                    {league.season_name || "No season set"}
                  </p>
                  <Link
                    href={`/dashboard/leagues/${league.id}`}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                  >
                    <Settings className="h-3 w-3" />
                    Manage / Unarchive
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
