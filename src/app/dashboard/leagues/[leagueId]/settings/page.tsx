"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, Check, ExternalLink, Plus, Trash2, Shield, UserPlus, ArrowRightLeft, Archive, ArchiveRestore } from "lucide-react";
import type { League, LeagueSettings, Division, LeagueStaff } from "@/lib/types";

export default function SettingsPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const router = useRouter();
  const [league, setLeague] = useState<League | null>(null);
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
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [newDivName, setNewDivName] = useState("");
  const [newDivLevel, setNewDivLevel] = useState("1");
  const [addingDiv, setAddingDiv] = useState(false);

  // Co-organizer state
  const [staff, setStaff] = useState<(LeagueStaff & { profile?: { full_name: string; email: string } })[]>([]);
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "manager">("manager");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("leagues")
        .select("*")
        .eq("id", leagueId)
        .single();
      if (data) {
        const l = data as League;
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

      const { data: divs } = await supabase
        .from("divisions")
        .select("*")
        .eq("league_id", leagueId)
        .order("level");
      if (divs) setDivisions(divs as Division[]);

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
          // Check if admin (original organizer)
          const l = data as League;
          setIsAdmin(l?.organizer_id === profile.id);
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
    }
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

    // Find profile by email
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

    // Can't add the original organizer as staff
    if (profile.id === league?.organizer_id) {
      setInviteError("That's the league owner — already has full access.");
      setInviting(false);
      return;
    }

    // Check if already staff
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
    // Update league organizer_id to the new admin
    await supabase.from("leagues").update({ organizer_id: staffMember.profile_id }).eq("id", leagueId);
    // Add current user as manager staff
    await supabase.from("league_staff").insert({
      league_id: leagueId,
      profile_id: currentProfileId,
      role: "manager",
      invited_by: staffMember.profile_id,
    });
    // Remove the new admin from staff table (they're now the organizer)
    await supabase.from("league_staff").delete().eq("id", staffMember.id);
    // Reload
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

  if (!league) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-6 max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">League Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>League name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Season</Label>
            <Input
              value={seasonName}
              onChange={(e) => setSeasonName(e.target.value)}
              placeholder="Spring 2026"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Season start</Label>
              <Input
                type="date"
                value={seasonStart}
                onChange={(e) => setSeasonStart(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Season end</Label>
              <Input
                type="date"
                value={seasonEnd}
                onChange={(e) => setSeasonEnd(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <Separator />
          <div className="space-y-2">
            <Label>Scoring mode</Label>
            <Select value={scoringMode} onValueChange={(v) => v && setScoringMode(v)}>
              <SelectTrigger>
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
              <Label>Sets to win (best of)</Label>
              <Select value={setsToWin} onValueChange={(v) => v && setSetsToWin(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">Best of 3 (first to 2)</SelectItem>
                  <SelectItem value="3">Best of 5 (first to 3)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <Button onClick={saveSettings} disabled={saving}>
            {saved ? "Saved!" : saving ? "Saving..." : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Divisions</CardTitle>
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
                  className="flex items-center justify-between rounded-md border px-3 py-2"
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Co-Organizers
          </CardTitle>
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
            <div key={s.id} className="flex items-center justify-between rounded-md border px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{s.profile?.full_name || "Unknown"}</span>
                <span className="text-xs text-muted-foreground">{s.profile?.email}</span>
                <Badge variant={s.role === "admin" ? "default" : "secondary"} className="text-[10px]">
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
                      className="h-7 w-7 p-0 text-muted-foreground"
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
              <div className="space-y-2">
                <Label className="text-xs">Invite co-organizer by email</Label>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    placeholder="email@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="flex-1"
                    onKeyDown={(e) => e.key === "Enter" && inviteStaff()}
                  />
                  <Select value={inviteRole} onValueChange={(v) => v && setInviteRole(v as "admin" | "manager")}>
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
                <p className="text-[10px] text-muted-foreground">
                  Admins have full access. Managers can manage games, teams, and chat but cannot remove the owner or other admins.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Public League Page</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <code className="text-sm bg-muted px-2 py-1 rounded flex-1 truncate">
              /league/{league.slug}
            </code>
            <Button variant="outline" size="sm" onClick={copyPublicLink}>
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
            <Button variant="outline" size="sm" render={<a href={`/league/${league.slug}`} target="_blank" rel="noopener noreferrer" />}>
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {league.archived_at ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Unarchive this league</p>
                <p className="text-xs text-muted-foreground">Restore this league to your active dashboard.</p>
              </div>
              <Button variant="outline" onClick={unarchiveLeague} disabled={archiving}>
                <ArchiveRestore className="h-4 w-4 mr-1" />
                {archiving ? "Restoring..." : "Unarchive"}
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Archive this league</p>
                <p className="text-xs text-muted-foreground">Hide from dashboard. All data preserved.</p>
              </div>
              <Button variant="destructive" onClick={() => setShowArchiveConfirm(true)} disabled={archiving}>
                <Archive className="h-4 w-4 mr-1" />
                Archive
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {showArchiveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle className="text-base">Archive this league?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This league will be hidden from your dashboard. All historical data
                (games, standings, playoffs) will be preserved. You can unarchive it at
                any time.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowArchiveConfirm(false)} disabled={archiving}>
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
    </div>
  );
}
