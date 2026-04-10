"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  CheckSquare,
} from "lucide-react";
import type {
  League,
  Team,
  Player,
  Game,
  Standing,
  Division,
  Profile,
} from "@/lib/types";
import {
  exportLeaguesSummary,
  exportTeamsAndCaptains,
  exportFullSchedule,
  exportLeagueData,
} from "@/lib/export/data-export";

type ExportFormat = "pdf" | "xlsx";

export default function ExportsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);

  // Per-league state
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>("");
  const [perLeagueFormat, setPerLeagueFormat] = useState<ExportFormat>("xlsx");
  const [sections, setSections] = useState({
    leagueInfo: true,
    standings: true,
    teamsRosters: true,
    schedule: true,
    gameResults: true,
  });

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // Get profile
      const { data: prof } = await supabase
        .from("profiles")
        .select("*")
        .eq("auth_id", user.id)
        .single();
      if (!prof) return;
      setProfile(prof as Profile);

      // Get leagues where user is organizer
      const { data: ownedLeagues } = await supabase
        .from("leagues")
        .select("*")
        .eq("organizer_id", prof.id)
        .is("archived_at", null);

      // Get leagues where user is staff (co-organizer)
      const { data: staffRows } = await supabase
        .from("league_staff")
        .select("league_id")
        .eq("profile_id", prof.id);

      const staffLeagueIds = (staffRows || []).map(
        (s: { league_id: string }) => s.league_id
      );

      let staffLeagues: League[] = [];
      if (staffLeagueIds.length > 0) {
        const { data } = await supabase
          .from("leagues")
          .select("*")
          .in("id", staffLeagueIds)
          .is("archived_at", null);
        staffLeagues = (data || []) as League[];
      }

      // Merge and deduplicate
      const allLeagues = [
        ...((ownedLeagues || []) as League[]),
        ...staffLeagues,
      ];
      const uniqueLeagues = Array.from(
        new Map(allLeagues.map((l) => [l.id, l])).values()
      );
      setLeagues(uniqueLeagues);

      if (uniqueLeagues.length === 0) {
        setLoading(false);
        return;
      }

      const leagueIds = uniqueLeagues.map((l) => l.id);

      // Fetch all related data in parallel
      const [teamsRes, playersRes, gamesRes, standingsRes, divisionsRes] =
        await Promise.all([
          supabase
            .from("teams")
            .select("*")
            .in("league_id", leagueIds),
          supabase
            .from("players")
            .select("*")
            .in("league_id", leagueIds),
          supabase
            .from("games")
            .select("*")
            .in("league_id", leagueIds),
          supabase
            .from("standings")
            .select("*")
            .in("league_id", leagueIds),
          supabase
            .from("divisions")
            .select("*")
            .in("league_id", leagueIds),
        ]);

      setTeams((teamsRes.data || []) as Team[]);
      setPlayers((playersRes.data || []) as Player[]);
      setGames((gamesRes.data || []) as Game[]);
      setStandings((standingsRes.data || []) as Standing[]);
      setDivisions((divisionsRes.data || []) as Division[]);
      setLoading(false);
    }
    load();
  }, []);

  function toggleSection(key: keyof typeof sections) {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleQuickExport(
    type: "leagues" | "teams" | "schedule",
    format: ExportFormat
  ) {
    const key = `${type}-${format}`;
    setExporting(key);
    try {
      // Small delay so the UI updates before heavy PDF/XLSX work
      await new Promise((r) => setTimeout(r, 50));
      if (type === "leagues") {
        exportLeaguesSummary({ leagues, teams, games }, format);
      } else if (type === "teams") {
        exportTeamsAndCaptains({ leagues, teams, players }, format);
      } else {
        exportFullSchedule({ leagues, teams, games }, format);
      }
    } finally {
      setExporting(null);
    }
  }

  async function handlePerLeagueExport() {
    if (!selectedLeagueId) return;
    setExporting("per-league");
    try {
      await new Promise((r) => setTimeout(r, 50));
      const league = leagues.find((l) => l.id === selectedLeagueId);
      if (!league) return;
      const leagueDivisions = divisions.filter(
        (d) => d.league_id === selectedLeagueId
      );
      const leagueStandings = standings.filter(
        (s) => s.league_id === selectedLeagueId
      );
      const leagueTeams = teams.filter(
        (t) => t.league_id === selectedLeagueId
      );
      const leaguePlayers = players.filter(
        (p) => p.league_id === selectedLeagueId
      );
      const leagueGames = games.filter(
        (g) => g.league_id === selectedLeagueId
      );

      exportLeagueData({
        league,
        divisions: leagueDivisions,
        standings: leagueStandings,
        teams: leagueTeams,
        players: leaguePlayers,
        games: leagueGames,
        sections,
        format: perLeagueFormat,
      });
    } finally {
      setExporting(null);
    }
  }

  const anySectionSelected = Object.values(sections).some(Boolean);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (leagues.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Data Exports</h1>
        <Card>
          <CardContent>
            <p className="text-muted-foreground py-8 text-center">
              You don&apos;t have any leagues to export data from. Create or join
              a league first.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Data Exports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Export league data to PDF or Excel. Across{" "}
          <span className="font-medium text-foreground">
            {leagues.length}
          </span>{" "}
          league{leagues.length !== 1 ? "s" : ""}.
        </p>
      </div>

      {/* Quick Exports */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            Quick Exports
          </CardTitle>
          <CardDescription>
            One-click exports across all your leagues
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* All Leagues Summary */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <p className="font-medium text-sm">All Leagues Summary</p>
                <p className="text-xs text-muted-foreground">
                  League names, sport, season, team count, game count
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting !== null}
                  onClick={() => handleQuickExport("leagues", "pdf")}
                >
                  {exporting === "leagues-pdf" ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <FileText className="h-3 w-3 mr-1" />
                  )}
                  PDF
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting !== null}
                  onClick={() => handleQuickExport("leagues", "xlsx")}
                >
                  {exporting === "leagues-xlsx" ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <FileSpreadsheet className="h-3 w-3 mr-1" />
                  )}
                  Excel
                </Button>
              </div>
            </div>

            <div className="border-t" />

            {/* All Teams & Captains */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <p className="font-medium text-sm">All Teams &amp; Captains</p>
                <p className="text-xs text-muted-foreground">
                  All teams across all leagues with captain names and contact
                  info
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting !== null}
                  onClick={() => handleQuickExport("teams", "pdf")}
                >
                  {exporting === "teams-pdf" ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <FileText className="h-3 w-3 mr-1" />
                  )}
                  PDF
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting !== null}
                  onClick={() => handleQuickExport("teams", "xlsx")}
                >
                  {exporting === "teams-xlsx" ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <FileSpreadsheet className="h-3 w-3 mr-1" />
                  )}
                  Excel
                </Button>
              </div>
            </div>

            <div className="border-t" />

            {/* Full Schedule */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <p className="font-medium text-sm">Full Schedule</p>
                <p className="text-xs text-muted-foreground">
                  All games across all leagues with dates, teams, scores, venue
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting !== null}
                  onClick={() => handleQuickExport("schedule", "pdf")}
                >
                  {exporting === "schedule-pdf" ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <FileText className="h-3 w-3 mr-1" />
                  )}
                  PDF
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting !== null}
                  onClick={() => handleQuickExport("schedule", "xlsx")}
                >
                  {exporting === "schedule-xlsx" ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <FileSpreadsheet className="h-3 w-3 mr-1" />
                  )}
                  Excel
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Per-League Export */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckSquare className="h-4 w-4" />
            Per-League Export
          </CardTitle>
          <CardDescription>
            Pick a league, choose what to include, and export
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-5">
            {/* League selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium">League</label>
              <Select
                value={selectedLeagueId}
                onValueChange={(v) => v && setSelectedLeagueId(v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a league" />
                </SelectTrigger>
                <SelectContent>
                  {leagues.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                      {l.season_name ? ` (${l.season_name})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Section checkboxes */}
            {selectedLeagueId && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Sections to include
                  </label>
                  <div className="space-y-2">
                    {[
                      {
                        key: "leagueInfo" as const,
                        label: "League Info",
                        desc: "Name, sport, season, dates, divisions",
                      },
                      {
                        key: "standings" as const,
                        label: "Standings",
                        desc: "Per-division standings with W/L, Win%, point differential",
                      },
                      {
                        key: "teamsRosters" as const,
                        label: "Teams & Rosters",
                        desc: "Team name, players, captain",
                      },
                      {
                        key: "schedule" as const,
                        label: "Schedule",
                        desc: "All games with dates, teams, scores, venue",
                      },
                      {
                        key: "gameResults" as const,
                        label: "Game Results",
                        desc: "Completed games only with final scores",
                      },
                    ].map((item) => (
                      <label
                        key={item.key}
                        className="flex items-start gap-3 cursor-pointer rounded-md border p-3 hover:bg-accent/30 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={sections[item.key]}
                          onChange={() => toggleSection(item.key)}
                          className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-none">
                            {item.label}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {item.desc}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Format selector */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Format</label>
                  <div className="flex items-center gap-2">
                    <Button
                      variant={
                        perLeagueFormat === "xlsx" ? "default" : "outline"
                      }
                      size="sm"
                      onClick={() => setPerLeagueFormat("xlsx")}
                    >
                      <FileSpreadsheet className="h-3 w-3 mr-1" />
                      Excel (XLSX)
                    </Button>
                    <Button
                      variant={
                        perLeagueFormat === "pdf" ? "default" : "outline"
                      }
                      size="sm"
                      onClick={() => setPerLeagueFormat("pdf")}
                    >
                      <FileText className="h-3 w-3 mr-1" />
                      PDF
                    </Button>
                  </div>
                </div>

                {/* Export button */}
                <Button
                  onClick={handlePerLeagueExport}
                  disabled={
                    !anySectionSelected ||
                    !selectedLeagueId ||
                    exporting !== null
                  }
                  className="w-full"
                >
                  {exporting === "per-league" ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Export{" "}
                  {
                    leagues.find((l) => l.id === selectedLeagueId)?.name
                  }{" "}
                  as {perLeagueFormat === "xlsx" ? "Excel" : "PDF"}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
