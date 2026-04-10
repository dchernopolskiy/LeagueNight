"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  Search,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
} from "lucide-react";
import type { Profile, League, LeagueStaff } from "@/lib/types";

type StaffWithProfile = LeagueStaff & {
  profile?: { full_name: string; email: string };
};

type LeagueWithCounts = League & {
  teamCount: number;
  staffCount: number;
};

export default function AdminPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [leagues, setLeagues] = useState<LeagueWithCounts[]>([]);
  const [allStaff, setAllStaff] = useState<StaffWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedLeague, setExpandedLeague] = useState<string | null>(null);

  // Copy state
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  // Staff directory filter
  const [staffSearch, setStaffSearch] = useState("");

  // Add co-organizer state
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<"admin" | "manager">("manager");
  const [addLeagues, setAddLeagues] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);

  // Bulk actions state
  const [bulkEmail, setBulkEmail] = useState("");
  const [bulkRole, setBulkRole] = useState<"admin" | "manager">("manager");
  const [bulkAction, setBulkAction] = useState<"add" | "remove">("add");
  const [bulking, setBulking] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSuccess, setBulkSuccess] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const supabase = createClient();

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    // Get profile
    const { data: prof } = await supabase
      .from("profiles")
      .select("*")
      .eq("auth_id", user.id)
      .single();
    if (!prof) {
      setLoading(false);
      return;
    }
    setProfile(prof as Profile);

    // Fetch leagues this user owns + leagues where they are staff
    const [ownedRes, staffRes] = await Promise.all([
      supabase
        .from("leagues")
        .select("*")
        .eq("organizer_id", prof.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("league_staff")
        .select("league_id, league:leagues!league_staff_league_id_fkey(*)")
        .eq("profile_id", prof.id),
    ]);

    // Merge and deduplicate
    const leagueMap = new Map<string, League>();
    for (const l of (ownedRes.data || []) as League[]) leagueMap.set(l.id, l);
    for (const s of (staffRes.data || []) as any[]) {
      if (s.league && !leagueMap.has(s.league.id)) leagueMap.set(s.league.id, s.league);
    }
    const leagueData = Array.from(leagueMap.values());

    if (leagueData.length === 0) {
      setLeagues([]);
      setLoading(false);
      return;
    }

    const leagueIds = leagueData.map((l: League) => l.id);

    // Fetch team counts per league
    const { data: teams } = await supabase
      .from("teams")
      .select("id, league_id")
      .in("league_id", leagueIds);

    // Fetch all staff for these leagues
    const { data: staffData } = await supabase
      .from("league_staff")
      .select("*, profile:profiles!league_staff_profile_id_fkey(full_name, email)")
      .in("league_id", leagueIds);

    const staffList = (staffData || []) as StaffWithProfile[];
    setAllStaff(staffList);

    // Build league objects with counts
    const teamsByLeague: Record<string, number> = {};
    (teams || []).forEach((t: { league_id: string }) => {
      teamsByLeague[t.league_id] = (teamsByLeague[t.league_id] || 0) + 1;
    });

    const staffByLeague: Record<string, number> = {};
    staffList.forEach((s) => {
      staffByLeague[s.league_id] = (staffByLeague[s.league_id] || 0) + 1;
    });

    setLeagues(
      (leagueData as League[]).map((l) => ({
        ...l,
        teamCount: teamsByLeague[l.id] || 0,
        staffCount: staffByLeague[l.id] || 0,
      }))
    );

    setLoading(false);
  }

  // Deduplicated staff directory grouped by profile
  const staffDirectory = useMemo(() => {
    const map = new Map<
      string,
      {
        profileId: string;
        name: string;
        email: string;
        entries: StaffWithProfile[];
      }
    >();
    allStaff.forEach((s) => {
      const existing = map.get(s.profile_id);
      if (existing) {
        existing.entries.push(s);
      } else {
        map.set(s.profile_id, {
          profileId: s.profile_id,
          name: s.profile?.full_name || "Unknown",
          email: s.profile?.email || "",
          entries: [s],
        });
      }
    });
    let list = Array.from(map.values());

    if (staffSearch.trim()) {
      const q = staffSearch.toLowerCase();
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)
      );
    }

    return list;
  }, [allStaff, staffSearch]);

  function leagueName(leagueId: string) {
    return leagues.find((l) => l.id === leagueId)?.name || leagueId;
  }

  async function changeStaffRole(
    staffId: string,
    newRole: "admin" | "manager"
  ) {
    const supabase = createClient();
    await supabase
      .from("league_staff")
      .update({ role: newRole })
      .eq("id", staffId);
    setAllStaff((prev) =>
      prev.map((s) => (s.id === staffId ? { ...s, role: newRole } : s))
    );
  }

  async function removeStaffEntry(staffId: string) {
    const supabase = createClient();
    await supabase.from("league_staff").delete().eq("id", staffId);
    setAllStaff((prev) => prev.filter((s) => s.id !== staffId));
    // Update league counts
    setLeagues((prev) =>
      prev.map((l) => {
        const removed = allStaff.find((s) => s.id === staffId);
        if (removed && removed.league_id === l.id) {
          return { ...l, staffCount: Math.max(0, l.staffCount - 1) };
        }
        return l;
      })
    );
  }

  async function removeFromAllLeagues(profileId: string) {
    const entriesToRemove = allStaff.filter((s) => s.profile_id === profileId);
    if (
      !confirm(
        `Remove this person from all ${entriesToRemove.length} league(s)?`
      )
    )
      return;
    const supabase = createClient();
    const ids = entriesToRemove.map((s) => s.id);
    await supabase.from("league_staff").delete().in("id", ids);
    setAllStaff((prev) => prev.filter((s) => s.profile_id !== profileId));
    // Update league counts
    const removedByLeague: Record<string, number> = {};
    entriesToRemove.forEach((s) => {
      removedByLeague[s.league_id] = (removedByLeague[s.league_id] || 0) + 1;
    });
    setLeagues((prev) =>
      prev.map((l) => ({
        ...l,
        staffCount: Math.max(0, l.staffCount - (removedByLeague[l.id] || 0)),
      }))
    );
  }

  async function handleAddCoOrganizer() {
    if (!addEmail.trim() || addLeagues.length === 0) return;
    setAdding(true);
    setAddError(null);
    setAddSuccess(null);

    const supabase = createClient();

    // Find profile by email
    const { data: foundProfile } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("email", addEmail.trim().toLowerCase())
      .single();

    if (!foundProfile) {
      setAddError("No account found — they need to sign up first.");
      setAdding(false);
      return;
    }

    // Can't add yourself (the organizer)
    if (foundProfile.id === profile?.id) {
      setAddError("You already have full access as the league owner.");
      setAdding(false);
      return;
    }

    let addedCount = 0;
    let skippedCount = 0;

    for (const leagueId of addLeagues) {
      // Check if already staff for this league
      const existing = allStaff.find(
        (s) => s.profile_id === foundProfile.id && s.league_id === leagueId
      );
      if (existing) {
        skippedCount++;
        continue;
      }

      const { data, error } = await supabase
        .from("league_staff")
        .insert({
          league_id: leagueId,
          profile_id: foundProfile.id,
          role: addRole,
          invited_by: profile?.id,
        })
        .select("*, profile:profiles!league_staff_profile_id_fkey(full_name, email)")
        .single();

      if (!error && data) {
        setAllStaff((prev) => [...prev, data as StaffWithProfile]);
        setLeagues((prev) =>
          prev.map((l) =>
            l.id === leagueId ? { ...l, staffCount: l.staffCount + 1 } : l
          )
        );
        addedCount++;
      }
    }

    if (addedCount > 0) {
      setAddSuccess(
        `Added to ${addedCount} league(s).${skippedCount > 0 ? ` Skipped ${skippedCount} (already staff).` : ""}`
      );
      setAddEmail("");
      setAddLeagues([]);
    } else if (skippedCount > 0) {
      setAddError("Already a co-organizer in the selected league(s).");
    }

    setAdding(false);
  }

  async function handleBulkAction() {
    if (!bulkEmail.trim()) return;
    setBulking(true);
    setBulkError(null);
    setBulkSuccess(null);

    const supabase = createClient();

    const { data: foundProfile } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("email", bulkEmail.trim().toLowerCase())
      .single();

    if (!foundProfile) {
      setBulkError("No account found — they need to sign up first.");
      setBulking(false);
      return;
    }

    if (foundProfile.id === profile?.id) {
      setBulkError("You already have full access as the league owner.");
      setBulking(false);
      return;
    }

    if (bulkAction === "add") {
      let addedCount = 0;
      for (const league of leagues) {
        const existing = allStaff.find(
          (s) =>
            s.profile_id === foundProfile.id && s.league_id === league.id
        );
        if (existing) continue;

        const { data, error } = await supabase
          .from("league_staff")
          .insert({
            league_id: league.id,
            profile_id: foundProfile.id,
            role: bulkRole,
            invited_by: profile?.id,
          })
          .select("*, profile:profiles!league_staff_profile_id_fkey(full_name, email)")
          .single();

        if (!error && data) {
          setAllStaff((prev) => [...prev, data as StaffWithProfile]);
          setLeagues((prev) =>
            prev.map((l) =>
              l.id === league.id
                ? { ...l, staffCount: l.staffCount + 1 }
                : l
            )
          );
          addedCount++;
        }
      }
      setBulkSuccess(
        addedCount > 0
          ? `Added to ${addedCount} league(s).`
          : "Already staff in all leagues."
      );
    } else {
      // Remove from all leagues
      const entries = allStaff.filter(
        (s) => s.profile_id === foundProfile.id
      );
      if (entries.length === 0) {
        setBulkError("This person is not staff in any of your leagues.");
        setBulking(false);
        return;
      }

      const ids = entries.map((s) => s.id);
      await supabase.from("league_staff").delete().in("id", ids);
      setAllStaff((prev) =>
        prev.filter((s) => s.profile_id !== foundProfile.id)
      );
      const removedByLeague: Record<string, number> = {};
      entries.forEach((s) => {
        removedByLeague[s.league_id] =
          (removedByLeague[s.league_id] || 0) + 1;
      });
      setLeagues((prev) =>
        prev.map((l) => ({
          ...l,
          staffCount: Math.max(
            0,
            l.staffCount - (removedByLeague[l.id] || 0)
          ),
        }))
      );
      setBulkSuccess(`Removed from ${entries.length} league(s).`);
    }

    setBulkEmail("");
    setBulking(false);
  }

  function toggleLeagueSelection(leagueId: string) {
    setAddLeagues((prev) =>
      prev.includes(leagueId)
        ? prev.filter((id) => id !== leagueId)
        : [...prev, leagueId]
    );
  }

  if (loading) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  if (!profile) {
    return <p className="text-muted-foreground">Not logged in.</p>;
  }

  if (leagues.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Admin
        </h1>
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">
              You don&apos;t manage any leagues.
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Create a league first, then come back here to manage your staff.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold flex items-center gap-2">
        <ShieldCheck className="h-5 w-5" />
        Admin
      </h1>

      {/* Card 1: Your Leagues */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your Leagues</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>League Name</TableHead>
                <TableHead>Sport</TableHead>
                <TableHead>Season</TableHead>
                <TableHead># Teams</TableHead>
                <TableHead># Staff</TableHead>
                <TableHead>Public Link</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leagues.map((league) => (
                <>
                  <TableRow key={league.id}>
                    <TableCell className="font-medium">{league.name}</TableCell>
                    <TableCell>{league.sport || "—"}</TableCell>
                    <TableCell>{league.season_name || "—"}</TableCell>
                    <TableCell>{league.teamCount}</TableCell>
                    <TableCell>{league.staffCount}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded truncate max-w-[200px]">
                          /league/{league.slug}
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 shrink-0"
                          onClick={() => {
                            navigator.clipboard.writeText(
                              `${window.location.origin}/league/${league.slug}`
                            );
                            setCopiedSlug(league.slug);
                            setTimeout(() => setCopiedSlug(null), 2000);
                          }}
                          title="Copy link"
                        >
                          {copiedSlug === league.slug ? (
                            <Check className="h-3 w-3 text-green-600" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setExpandedLeague(
                            expandedLeague === league.id ? null : league.id
                          )
                        }
                      >
                        {expandedLeague === league.id ? (
                          <ChevronDown className="h-4 w-4 mr-1" />
                        ) : (
                          <ChevronRight className="h-4 w-4 mr-1" />
                        )}
                        Staff
                      </Button>
                    </TableCell>
                  </TableRow>
                  {expandedLeague === league.id && (
                    <TableRow key={`${league.id}-staff`}>
                      <TableCell colSpan={7} className="bg-muted/30">
                        <div className="py-2 space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">
                            Staff for {league.name}
                          </p>
                          {allStaff.filter((s) => s.league_id === league.id)
                            .length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              No co-organizers yet.
                            </p>
                          ) : (
                            <div className="space-y-1">
                              {allStaff
                                .filter((s) => s.league_id === league.id)
                                .map((s) => (
                                  <div
                                    key={s.id}
                                    className="flex items-center justify-between rounded-md border bg-background px-3 py-1.5"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm">
                                        {s.profile?.full_name || "Unknown"}
                                      </span>
                                      <span className="text-xs text-muted-foreground">
                                        {s.profile?.email}
                                      </span>
                                      <Badge
                                        variant={
                                          s.role === "admin"
                                            ? "default"
                                            : "secondary"
                                        }
                                        className="text-[10px]"
                                      >
                                        {s.role}
                                      </Badge>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <Select
                                        value={s.role}
                                        onValueChange={(v) =>
                                          v &&
                                          changeStaffRole(
                                            s.id,
                                            v as "admin" | "manager"
                                          )
                                        }
                                      >
                                        <SelectTrigger className="h-7 w-[100px] text-xs">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="admin">
                                            Admin
                                          </SelectItem>
                                          <SelectItem value="manager">
                                            Manager
                                          </SelectItem>
                                        </SelectContent>
                                      </Select>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                        onClick={() =>
                                          removeStaffEntry(s.id)
                                        }
                                        title="Remove from this league"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Card 2: Staff Directory */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Staff Directory
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or email..."
              value={staffSearch}
              onChange={(e) => setStaffSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {staffDirectory.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {staffSearch
                ? "No staff matching your search."
                : "No co-organizers across any of your leagues yet."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role(s)</TableHead>
                  <TableHead>League(s)</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staffDirectory.map((person) => {
                  const roles = [
                    ...new Set(person.entries.map((e) => e.role)),
                  ];
                  const leagueNames = person.entries.map((e) =>
                    leagueName(e.league_id)
                  );
                  const earliestDate = person.entries.reduce(
                    (earliest, e) =>
                      e.created_at < earliest ? e.created_at : earliest,
                    person.entries[0].created_at
                  );

                  return (
                    <TableRow key={person.profileId}>
                      <TableCell className="font-medium">
                        {person.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {person.email}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {roles.map((r) => (
                            <Badge
                              key={r}
                              variant={
                                r === "admin" ? "default" : "secondary"
                              }
                              className="text-[10px]"
                            >
                              {r}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {leagueNames.map((name, i) => (
                            <Badge
                              key={i}
                              variant="outline"
                              className="text-[10px]"
                            >
                              {name}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {new Date(earliestDate).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {person.entries.length === 1 ? (
                            <>
                              <Select
                                value={person.entries[0].role}
                                onValueChange={(v) =>
                                  v &&
                                  changeStaffRole(
                                    person.entries[0].id,
                                    v as "admin" | "manager"
                                  )
                                }
                              >
                                <SelectTrigger className="h-7 w-[100px] text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="admin">Admin</SelectItem>
                                  <SelectItem value="manager">
                                    Manager
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                onClick={() =>
                                  removeStaffEntry(person.entries[0].id)
                                }
                                title="Remove from league"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-muted-foreground hover:text-destructive"
                              onClick={() =>
                                removeFromAllLeagues(person.profileId)
                              }
                              title="Remove from all leagues"
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-1" />
                              Remove all
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Card 3: Add Co-Organizer */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            Add Co-Organizer
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Email address</Label>
            <Input
              type="email"
              placeholder="email@example.com"
              value={addEmail}
              onChange={(e) => {
                setAddEmail(e.target.value);
                setAddError(null);
                setAddSuccess(null);
              }}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Add to league(s)</Label>
            <div className="flex flex-wrap gap-2">
              {leagues.map((league) => (
                <Button
                  key={league.id}
                  variant={
                    addLeagues.includes(league.id) ? "default" : "outline"
                  }
                  size="sm"
                  className="text-xs"
                  onClick={() => toggleLeagueSelection(league.id)}
                >
                  {league.name}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Role</Label>
            <Select
              value={addRole}
              onValueChange={(v) => v && setAddRole(v as "admin" | "manager")}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={handleAddCoOrganizer}
            disabled={adding || !addEmail.trim() || addLeagues.length === 0}
          >
            <UserPlus className="h-4 w-4 mr-1" />
            {adding ? "Adding..." : "Add"}
          </Button>

          {addError && <p className="text-xs text-destructive">{addError}</p>}
          {addSuccess && (
            <p className="text-xs text-green-600">{addSuccess}</p>
          )}
        </CardContent>
      </Card>

      {/* Card 4: Bulk Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bulk Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Action</Label>
            <Select
              value={bulkAction}
              onValueChange={(v) => {
                if (v) {
                  setBulkAction(v as "add" | "remove");
                  setBulkError(null);
                  setBulkSuccess(null);
                }
              }}
            >
              <SelectTrigger className="w-[240px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="add">Add person to all leagues</SelectItem>
                <SelectItem value="remove">
                  Remove person from all leagues
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Email address</Label>
            <Input
              type="email"
              placeholder="email@example.com"
              value={bulkEmail}
              onChange={(e) => {
                setBulkEmail(e.target.value);
                setBulkError(null);
                setBulkSuccess(null);
              }}
            />
          </div>

          {bulkAction === "add" && (
            <div className="space-y-2">
              <Label className="text-xs">Role</Label>
              <Select
                value={bulkRole}
                onValueChange={(v) =>
                  v && setBulkRole(v as "admin" | "manager")
                }
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <Button
            onClick={handleBulkAction}
            disabled={bulking || !bulkEmail.trim()}
            variant={bulkAction === "remove" ? "destructive" : "default"}
          >
            {bulking
              ? "Processing..."
              : bulkAction === "add"
                ? "Add to All Leagues"
                : "Remove from All Leagues"}
          </Button>

          {bulkError && (
            <p className="text-xs text-destructive">{bulkError}</p>
          )}
          {bulkSuccess && (
            <p className="text-xs text-green-600">{bulkSuccess}</p>
          )}

          <Separator />
          <p className="text-[10px] text-muted-foreground">
            Bulk add inserts the person as staff into every league you own (skipping leagues where they already exist). Bulk remove deletes all their league_staff entries across your leagues.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
