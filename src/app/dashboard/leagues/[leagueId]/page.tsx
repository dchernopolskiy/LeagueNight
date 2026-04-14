"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LayoutDashboard,
  Settings,
  Users,
  Calendar,
  Trophy,
  Link2,
  ExternalLink,
  Plus,
  Trash2,
  Shield,
  UserPlus,
  ArrowRightLeft,
  Archive,
  ArchiveRestore,
  OctagonX,
  Copy,
  Check,
} from "lucide-react";
import type { League, LeagueSettings, Team, Player, Game, Division, LeagueStaff, DivisionCrossPlay } from "@/lib/types";
import { PublicLinkCopy } from "@/components/dashboard/public-link-copy";

export default function LeagueOverviewPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const router = useRouter();

  // Overview state
  const [league, setLeague] = useState<League | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [upcomingGames, setUpcomingGames] = useState<Game[]>([]);

  // Settings state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [seasonName, setSeasonName] = useState("");
  const [scoringMode, setScoringMode] = useState<string>("game");
  const [setsToWin, setSetsToWin] = useState("2");
  const [seasonStart, setSeasonStart] = useState("");
  const [seasonEnd, setSeasonEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  // Divisions state
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [newDivName, setNewDivName] = useState("");
  const [newDivLevel, setNewDivLevel] = useState("1");
  const [addingDiv, setAddingDiv] = useState(false);

  // Cross-division play state
  const [crossPlayRules, setCrossPlayRules] = useState<DivisionCrossPlay[]>([]);
  const [selectedDivisionA, setSelectedDivisionA] = useState<string>("");
  const [selectedDivisionB, setSelectedDivisionB] = useState<string>("");
  const [addingCrossPlay, setAddingCrossPlay] = useState(false);

  // Co-organizer state
  const [staff, setStaff] = useState<(LeagueStaff & { profile?: { full_name: string; email: string } })[]>([]);
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "manager">("manager");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Danger zone state
  const [archiving, setArchiving] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      // Load league data
      const { data: leagueData } = await supabase
        .from("leagues")
        .select("*")
        .eq("id", leagueId)
        .single();

      if (leagueData) {
        const l = leagueData as League;
        setLeague(l);
        setName(l.name);
        setDescription(l.description || "");
        setSeasonName(l.season_name || "");
        setSeasonStart(l.season_start || "");
        setSeasonEnd(l.season_end || "");
        const settings = l.settings as LeagueSettings;
        setScoringMode(settings.scoring_mode || "game");
        setSetsToWin(String(settings.sets_to_win || 2));
      }

      // Load overview data
      const [teamsRes, playersRes, gamesRes, divsRes, crossPlayRes] = await Promise.all([
        supabase.from("teams").select("*").eq("league_id", leagueId),
        supabase.from("players").select("*").eq("league_id", leagueId),
        supabase
          .from("games")
          .select("*")
          .eq("league_id", leagueId)
          .eq("status", "scheduled")
          .order("scheduled_at")
          .limit(5),
        supabase
          .from("divisions")
          .select("*")
          .eq("league_id", leagueId)
          .order("level"),
        supabase
          .from("division_cross_play")
          .select("*")
          .eq("league_id", leagueId),
      ]);

      setTeams((teamsRes.data || []) as Team[]);
      setPlayers((playersRes.data || []) as Player[]);
      setUpcomingGames((gamesRes.data || []) as Game[]);
      setDivisions((divsRes.data || []) as Division[]);
      setCrossPlayRules((crossPlayRes.data || []) as DivisionCrossPlay[]);

      // Load current user profile
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id")
          .eq("auth_id", user.id)
          .single();
        if (profile) {
          setCurrentProfileId(profile.id);
          setIsAdmin(leagueData?.organizer_id === profile.id);
        }
      }

      // Load co-organizer staff
      const { data: staffData } = await supabase
        .from("league_staff")
        .select("*, profile:profiles!league_staff_profile_id_fkey(full_name, email)")
        .eq("league_id", leagueId);
      if (staffData) setStaff(staffData as any);
    }
    load();
  }, [leagueId]);

  async function saveSettings() {
    setSaving(true);
    const supabase = createClient();
    await supabase
      .from("leagues")
      .update({
        name,
        description: description || null,
        season_name: seasonName || null,
        season_start: seasonStart || null,
        season_end: seasonEnd || null,
        settings: {
          ...(league?.settings || {}),
          scoring_mode: scoringMode,
          sets_to_win: parseInt(setsToWin),
        },
      })
      .eq("id", leagueId);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setSaving(false);
    router.refresh();
  }

  async function addDivision() {
    if (!newDivName.trim()) return;
    setAddingDiv(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("divisions")
      .insert({
        league_id: leagueId,
        name: newDivName.trim(),
        level: parseInt(newDivLevel) || 1,
      })
      .select()
      .single();
    if (!error && data) {
      setDivisions([...divisions, data as Division]);
      setNewDivName("");
      setNewDivLevel("1");
    }
    setAddingDiv(false);
  }

  async function deleteDivision(divId: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("divisions")
      .delete()
      .eq("id", divId);
    if (!error) {
      setDivisions(divisions.filter((d) => d.id !== divId));
      // Also remove any cross-play rules involving this division
      setCrossPlayRules(crossPlayRules.filter(
        (rule) => rule.division_a_id !== divId && rule.division_b_id !== divId
      ));
    }
  }

  async function addCrossPlayRule() {
    if (!selectedDivisionA || !selectedDivisionB) return;
    if (selectedDivisionA === selectedDivisionB) return;

    setAddingCrossPlay(true);
    const supabase = createClient();

    // Ensure ordering: division_a_id < division_b_id
    const [divA, divB] = selectedDivisionA < selectedDivisionB
      ? [selectedDivisionA, selectedDivisionB]
      : [selectedDivisionB, selectedDivisionA];

    const { data, error } = await supabase
      .from("division_cross_play")
      .insert({
        league_id: leagueId,
        division_a_id: divA,
        division_b_id: divB,
      })
      .select()
      .single();

    if (!error && data) {
      setCrossPlayRules([...crossPlayRules, data as DivisionCrossPlay]);
      setSelectedDivisionA("");
      setSelectedDivisionB("");
    }
    setAddingCrossPlay(false);
  }

  async function deleteCrossPlayRule(ruleId: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("division_cross_play")
      .delete()
      .eq("id", ruleId);
    if (!error) {
      setCrossPlayRules(crossPlayRules.filter((r) => r.id !== ruleId));
    }
  }

  // Helper function to check if two divisions can play together
  function canDivisionsPlay(divAId: string, divBId: string): boolean {
    if (divAId === divBId) return true; // Same division always plays together
    if (crossPlayRules.length === 0) return true; // No rules = all divisions can play

    const [smaller, larger] = divAId < divBId ? [divAId, divBId] : [divBId, divAId];
    return crossPlayRules.some(
      (rule) => rule.division_a_id === smaller && rule.division_b_id === larger
    );
  }

  function copyPublicLink() {
    if (!league) return;
    const url = `${window.location.origin}/league/${league.slug}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function inviteStaff() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError(null);
    const supabase = createClient();

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("email", inviteEmail.trim().toLowerCase())
      .single();

    if (!profile) {
      setInviteError("No account found with that email.");
      setInviting(false);
      return;
    }

    if (profile.id === league?.organizer_id) {
      setInviteError("That's the league owner — already has full access.");
      setInviting(false);
      return;
    }

    if (staff.some((s) => s.profile_id === profile.id)) {
      setInviteError("Already a co-organizer.");
      setInviting(false);
      return;
    }

    const { data, error } = await supabase
      .from("league_staff")
      .insert({
        league_id: leagueId,
        profile_id: profile.id,
        role: inviteRole,
        invited_by: currentProfileId,
      })
      .select("*, profile:profiles!league_staff_profile_id_fkey(full_name, email)")
      .single();

    if (error) {
      setInviteError(error.message);
    } else if (data) {
      setStaff([...staff, data as any]);
      setInviteEmail("");
    }
    setInviting(false);
  }

  async function removeStaff(staffId: string) {
    const supabase = createClient();
    await supabase.from("league_staff").delete().eq("id", staffId);
    setStaff(staff.filter((s) => s.id !== staffId));
  }

  async function changeRole(staffId: string, newRole: "admin" | "manager") {
    const supabase = createClient();
    await supabase.from("league_staff").update({ role: newRole }).eq("id", staffId);
    setStaff(staff.map((s) => (s.id === staffId ? { ...s, role: newRole } : s)));
  }

  async function transferAdmin(staffMember: typeof staff[0]) {
    if (!confirm(`Transfer admin ownership to ${staffMember.profile?.full_name}? You will become a manager.`)) return;
    const supabase = createClient();
    await supabase.from("leagues").update({ organizer_id: staffMember.profile_id }).eq("id", leagueId);
    await supabase.from("league_staff").insert({
      league_id: leagueId,
      profile_id: currentProfileId,
      role: "manager",
      invited_by: staffMember.profile_id,
    });
    await supabase.from("league_staff").delete().eq("id", staffMember.id);
    router.refresh();
    window.location.reload();
  }

  async function archiveLeague() {
    setArchiving(true);
    const supabase = createClient();
    await supabase
      .from("leagues")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", leagueId);
    setArchiving(false);
    setShowArchiveConfirm(false);
    router.push("/dashboard");
  }

  async function deleteLeague() {
    setDeleting(true);
    const res = await fetch(`/api/leagues/${leagueId}`, { method: "DELETE" });
    setDeleting(false);
    if (res.ok) {
      router.push("/dashboard");
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Failed to delete league.");
      setShowDeleteConfirm(false);
      setDeleteConfirmName("");
    }
  }

  async function unarchiveLeague() {
    setArchiving(true);
    const supabase = createClient();
    await supabase
      .from("leagues")
      .update({ archived_at: null })
      .eq("id", leagueId);
    setLeague({ ...league!, archived_at: null });
    setArchiving(false);
    router.refresh();
  }

  if (!league) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <LayoutDashboard className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        {/* OVERVIEW TAB */}
        <TabsContent value="overview" className="space-y-6 mt-6">
          {/* Public Link Banner */}
          {league.slug && (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="flex items-center gap-3 py-4">
                <Link2 className="h-5 w-5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Public League Page</p>
                  <code className="text-sm bg-background/50 px-2 py-1 rounded truncate block">
                    /league/{league.slug}
                  </code>
                </div>
                <PublicLinkCopy slug={league.slug} />
                <a
                  href={`/league/${league.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center h-9 w-9 rounded-md border bg-background hover:bg-accent hover:text-accent-foreground transition-colors shrink-0 cursor-pointer"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </CardContent>
            </Card>
          )}

          {/* Stats Grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="transition-all duration-200 hover:shadow-md cursor-pointer" onClick={() => router.push(`/dashboard/leagues/${leagueId}/teams`)}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Teams
                  </CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <p className="text-3xl font-bold">{teams.length}</p>
                  {divisions.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {divisions.length} {divisions.length === 1 ? 'division' : 'divisions'}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="transition-all duration-200 hover:shadow-md cursor-pointer" onClick={() => router.push(`/dashboard/leagues/${leagueId}/teams`)}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Players
                  </CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <p className="text-3xl font-bold">{players.length}</p>
                  {teams.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      ~{Math.round(players.length / teams.length)} per team
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="transition-all duration-200 hover:shadow-md cursor-pointer" onClick={() => router.push(`/dashboard/leagues/${leagueId}/schedule`)}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Upcoming Games
                  </CardTitle>
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{upcomingGames.length}</p>
              </CardContent>
            </Card>

            <Card className="transition-all duration-200 hover:shadow-md cursor-pointer" onClick={() => router.push(`/dashboard/leagues/${leagueId}/standings`)}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Season
                  </CardTitle>
                  <Trophy className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-lg font-semibold truncate">
                  {league.season_name || "Not set"}
                </p>
                {league.season_start && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Started {new Date(league.season_start).toLocaleDateString()}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Upcoming Games */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Upcoming Games</CardTitle>
                  <CardDescription>Next 5 scheduled matches</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(`/dashboard/leagues/${leagueId}/schedule`)}
                >
                  View All
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {upcomingGames.length === 0 ? (
                <div className="text-center py-12">
                  <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                  <p className="text-sm text-muted-foreground mb-4">
                    No upcoming games scheduled.
                  </p>
                  <Button
                    variant="default"
                    onClick={() => router.push(`/dashboard/leagues/${leagueId}/schedule`)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Generate Schedule
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {upcomingGames.map((game) => {
                    const homeTeam = teams.find((t) => t.id === game.home_team_id);
                    const awayTeam = teams.find((t) => t.id === game.away_team_id);
                    return (
                      <div
                        key={game.id}
                        className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
                        onClick={() => router.push(`/dashboard/leagues/${leagueId}/schedule`)}
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-medium truncate">
                              {homeTeam?.name ?? "TBD"}
                            </span>
                            <span className="text-xs text-muted-foreground">vs</span>
                            <span className="text-sm font-medium truncate">
                              {awayTeam?.name ?? "TBD"}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="secondary">
                            {new Date(game.scheduled_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </Badge>
                          {game.venue && (
                            <span className="text-xs text-muted-foreground hidden sm:inline">
                              {game.venue}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Common tasks for this league</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Button
                  variant="outline"
                  className="justify-start h-auto py-3"
                  onClick={() => router.push(`/dashboard/leagues/${leagueId}/teams`)}
                >
                  <Users className="h-4 w-4 mr-2 shrink-0" />
                  <div className="text-left">
                    <div className="font-medium">Manage Teams</div>
                    <div className="text-xs text-muted-foreground">Add, edit, or remove teams</div>
                  </div>
                </Button>
                <Button
                  variant="outline"
                  className="justify-start h-auto py-3"
                  onClick={() => router.push(`/dashboard/leagues/${leagueId}/schedule`)}
                >
                  <Calendar className="h-4 w-4 mr-2 shrink-0" />
                  <div className="text-left">
                    <div className="font-medium">Schedule Games</div>
                    <div className="text-xs text-muted-foreground">Generate or edit schedule</div>
                  </div>
                </Button>
                <Button
                  variant="outline"
                  className="justify-start h-auto py-3"
                  onClick={() => router.push(`/dashboard/leagues/${leagueId}/standings`)}
                >
                  <Trophy className="h-4 w-4 mr-2 shrink-0" />
                  <div className="text-left">
                    <div className="font-medium">View Standings</div>
                    <div className="text-xs text-muted-foreground">Check team rankings</div>
                  </div>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SETTINGS TAB */}
        <TabsContent value="settings" className="space-y-6 mt-6">
          <div className="max-w-2xl space-y-6">
            {/* League Settings */}
            <Card>
              <CardHeader>
                <CardTitle>League Information</CardTitle>
                <CardDescription>Basic details about your league</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="league-name">League name</Label>
                  <Input
                    id="league-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="season-name">Season</Label>
                  <Input
                    id="season-name"
                    value={seasonName}
                    onChange={(e) => setSeasonName(e.target.value)}
                    placeholder="Spring 2026"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="season-start">Season start</Label>
                    <Input
                      id="season-start"
                      type="date"
                      value={seasonStart}
                      onChange={(e) => setSeasonStart(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="season-end">Season end</Label>
                    <Input
                      id="season-end"
                      type="date"
                      value={seasonEnd}
                      onChange={(e) => setSeasonEnd(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    placeholder="Optional league description"
                  />
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label htmlFor="scoring-mode">Scoring mode</Label>
                  <Select value={scoringMode} onValueChange={(v) => v && setScoringMode(v)}>
                    <SelectTrigger id="scoring-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="game">Game won/lost (simple)</SelectItem>
                      <SelectItem value="sets">Sets (volleyball-style, e.g. 2-1)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {scoringMode === "sets" && (
                  <div className="space-y-2">
                    <Label htmlFor="sets-to-win">Sets to win (best of)</Label>
                    <Select value={setsToWin} onValueChange={(v) => v && setSetsToWin(v)}>
                      <SelectTrigger id="sets-to-win">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="2">Best of 3 (first to 2)</SelectItem>
                        <SelectItem value="3">Best of 5 (first to 3)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Button onClick={saveSettings} disabled={saving} className="w-full sm:w-auto">
                  {saved ? (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Saved!
                    </>
                  ) : saving ? (
                    "Saving..."
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Divisions */}
            <Card>
              <CardHeader>
                <CardTitle>Divisions</CardTitle>
                <CardDescription>
                  Group teams by skill level or category
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {divisions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No divisions yet. Add one to group teams by skill level.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {divisions.map((div) => (
                      <li
                        key={div.id}
                        className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-accent/50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{div.name}</span>
                          <Badge variant="secondary">Level {div.level}</Badge>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteDivision(div.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <Separator />
                <div className="flex gap-2">
                  <Input
                    placeholder="Division name"
                    value={newDivName}
                    onChange={(e) => setNewDivName(e.target.value)}
                    className="flex-1"
                    onKeyDown={(e) => e.key === "Enter" && addDivision()}
                  />
                  <Input
                    type="number"
                    min={1}
                    placeholder="Level"
                    value={newDivLevel}
                    onChange={(e) => setNewDivLevel(e.target.value)}
                    className="w-20"
                  />
                  <Button
                    variant="outline"
                    onClick={addDivision}
                    disabled={addingDiv || !newDivName.trim()}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Cross-Division Play */}
            {divisions.length >= 2 && (
              <Card>
                <CardHeader>
                  <CardTitle>Cross-Division Play</CardTitle>
                  <CardDescription>
                    Configure which divisions can play games against each other
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {crossPlayRules.length === 0 ? (
                    <div className="rounded-md border border-dashed p-4 text-center">
                      <p className="text-sm text-muted-foreground mb-1">
                        No cross-division rules configured
                      </p>
                      <p className="text-xs text-muted-foreground">
                        By default, all divisions can play together when "Mix Divisions" is enabled. Add rules to restrict which divisions can play each other.
                      </p>
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {crossPlayRules.map((rule) => {
                        const divA = divisions.find((d) => d.id === rule.division_a_id);
                        const divB = divisions.find((d) => d.id === rule.division_b_id);
                        return (
                          <li
                            key={rule.id}
                            className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-accent/50 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm">
                                {divA?.name || "Unknown"} <span className="text-muted-foreground">↔</span> {divB?.name || "Unknown"}
                              </span>
                              <Badge variant="outline" className="text-[10px]">Can play</Badge>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                              onClick={() => deleteCrossPlayRule(rule.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <Separator />
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Add cross-play rule</Label>
                    <div className="flex gap-2">
                      <Select
                        value={selectedDivisionA}
                        onValueChange={(v) => v && setSelectedDivisionA(v)}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Select division" />
                        </SelectTrigger>
                        <SelectContent>
                          {divisions.map((div) => (
                            <SelectItem key={div.id} value={div.id} disabled={div.id === selectedDivisionB}>
                              {div.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="self-center text-muted-foreground">↔</span>
                      <Select
                        value={selectedDivisionB}
                        onValueChange={(v) => v && setSelectedDivisionB(v)}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Select division" />
                        </SelectTrigger>
                        <SelectContent>
                          {divisions.map((div) => (
                            <SelectItem key={div.id} value={div.id} disabled={div.id === selectedDivisionA}>
                              {div.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        onClick={addCrossPlayRule}
                        disabled={addingCrossPlay || !selectedDivisionA || !selectedDivisionB || selectedDivisionA === selectedDivisionB}
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Add
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Allow two divisions to play games against each other. Example: "A Rank ↔ B Major" means teams from A Rank can play against teams from B Major.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Co-Organizers */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Co-Organizers
                </CardTitle>
                <CardDescription>
                  Invite others to help manage this league
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Current owner */}
                <div className="flex items-center justify-between rounded-md border px-3 py-2 bg-muted/30">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">You (Owner)</span>
                    <Badge className="text-[10px]">Admin</Badge>
                  </div>
                </div>

                {/* Staff list */}
                {staff.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-sm font-medium truncate">
                        {s.profile?.full_name || "Unknown"}
                      </span>
                      <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                        {s.profile?.email}
                      </span>
                      <Badge
                        variant={s.role === "admin" ? "default" : "secondary"}
                        className="text-[10px] shrink-0"
                      >
                        {s.role === "admin" ? "Admin" : "Manager"}
                      </Badge>
                    </div>
                    {isAdmin && (
                      <div className="flex items-center gap-1">
                        <Select
                          value={s.role}
                          onValueChange={(v) => v && changeRole(s.id, v as "admin" | "manager")}
                        >
                          <SelectTrigger className="h-7 w-[100px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="manager">Manager</SelectItem>
                          </SelectContent>
                        </Select>
                        {s.role === "admin" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                            onClick={() => transferAdmin(s)}
                            title="Transfer ownership"
                          >
                            <ArrowRightLeft className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeStaff(s.id)}
                          title="Remove"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}

                {staff.length === 0 && (
                  <p className="text-xs text-muted-foreground">No co-organizers yet.</p>
                )}

                {/* Invite form */}
                {isAdmin && (
                  <>
                    <Separator />
                    <div className="space-y-3">
                      <Label className="text-sm font-medium">Invite co-organizer by email</Label>
                      <div className="flex gap-2">
                        <Input
                          type="email"
                          placeholder="email@example.com"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          className="flex-1"
                          onKeyDown={(e) => e.key === "Enter" && inviteStaff()}
                        />
                        <Select
                          value={inviteRole}
                          onValueChange={(v) => v && setInviteRole(v as "admin" | "manager")}
                        >
                          <SelectTrigger className="w-[110px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="manager">Manager</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="outline"
                          onClick={inviteStaff}
                          disabled={inviting || !inviteEmail.trim()}
                        >
                          <UserPlus className="h-4 w-4 mr-1" />
                          Invite
                        </Button>
                      </div>
                      {inviteError && (
                        <p className="text-xs text-destructive">{inviteError}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Admins have full access. Managers can manage games, teams, and chat but
                        cannot remove the owner or other admins.
                      </p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Public Link */}
            <Card>
              <CardHeader>
                <CardTitle>Public League Page</CardTitle>
                <CardDescription>Share this link with players and fans</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <code className="text-sm bg-muted px-2 py-1 rounded flex-1 truncate">
                    /league/{league.slug}
                  </code>
                  <Button variant="outline" size="sm" onClick={copyPublicLink}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(`/league/${league.slug}`, "_blank")}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Danger Zone */}
            <Card className="border-destructive/30">
              <CardHeader>
                <CardTitle className="text-destructive">Danger Zone</CardTitle>
                <CardDescription>Irreversible actions for this league</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {league.archived_at ? (
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                      <p className="text-sm font-medium">Unarchive this league</p>
                      <p className="text-xs text-muted-foreground">
                        Restore this league to your active dashboard.
                      </p>
                    </div>
                    <Button variant="outline" onClick={unarchiveLeague} disabled={archiving}>
                      <ArchiveRestore className="h-4 w-4 mr-1" />
                      {archiving ? "Restoring..." : "Unarchive"}
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                      <p className="text-sm font-medium">Archive this league</p>
                      <p className="text-xs text-muted-foreground">
                        Hide from dashboard. All data preserved.
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      onClick={() => setShowArchiveConfirm(true)}
                      disabled={archiving}
                    >
                      <Archive className="h-4 w-4 mr-1" />
                      Archive
                    </Button>
                  </div>
                )}

                {isAdmin && (
                  <>
                    <Separator />
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-sm font-medium">Delete this league</p>
                        <p className="text-xs text-muted-foreground">
                          Permanently remove all data. This cannot be undone.
                        </p>
                      </div>
                      <Button
                        variant="destructive"
                        onClick={() => {
                          setShowDeleteConfirm(true);
                          setDeleteConfirmName("");
                        }}
                        disabled={deleting}
                      >
                        <OctagonX className="h-4 w-4 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Archive Confirmation Modal */}
      {showArchiveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle>Archive this league?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This league will be hidden from your dashboard. All historical data (games,
                standings, playoffs) will be preserved. You can unarchive it at any time.
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowArchiveConfirm(false)}
                  disabled={archiving}
                >
                  Cancel
                </Button>
                <Button variant="destructive" onClick={archiveLeague} disabled={archiving}>
                  {archiving ? "Archiving..." : "Archive League"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle className="text-destructive flex items-center gap-2">
                <OctagonX className="h-5 w-5" />
                Delete league permanently?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This will permanently delete{" "}
                <span className="font-semibold text-foreground">{league.name}</span> along with
                all teams, players, games, standings, playoffs, and messages.{" "}
                <span className="font-semibold text-destructive">This cannot be undone.</span>
              </p>
              <div className="space-y-2">
                <Label htmlFor="delete-confirm" className="text-xs">
                  Type the league name to confirm
                </Label>
                <Input
                  id="delete-confirm"
                  value={deleteConfirmName}
                  onChange={(e) => setDeleteConfirmName(e.target.value)}
                  placeholder={league.name}
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteConfirmName("");
                  }}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={deleteLeague}
                  disabled={deleting || deleteConfirmName !== league.name}
                >
                  {deleting ? "Deleting..." : "Delete Forever"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
