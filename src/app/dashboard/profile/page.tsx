"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  UserCircle,
  Shield,
  Users,
  Trophy,
  Save,
  KeyRound,
  Mail,
  Phone,
  Check,
  AlertCircle,
} from "lucide-react";
import type { Profile, League, LeagueStaff } from "@/lib/types";

interface LeagueRole {
  league: League;
  role: "organizer" | "admin" | "manager" | "player";
  teamName?: string;
  divisionName?: string;
}

export default function ProfilePage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [leagueRoles, setLeagueRoles] = useState<LeagueRole[]>([]);
  const [loading, setLoading] = useState(true);

  // Editable fields
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Password change
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Get profile
    const { data: prof } = await supabase
      .from("profiles")
      .select("*")
      .eq("auth_id", user.id)
      .single();

    if (!prof) return;
    setProfile(prof);
    setFullName(prof.full_name);
    setPhone(prof.phone || "");

    // Get leagues where organizer
    const { data: ownedLeagues } = await supabase
      .from("leagues")
      .select("*")
      .eq("organizer_id", prof.id)
      .is("archived_at", null);

    // Get leagues where staff
    const { data: staffEntries } = await supabase
      .from("league_staff")
      .select("*, leagues(*)")
      .eq("profile_id", prof.id);

    // Get leagues where player
    const { data: playerEntries } = await supabase
      .from("players")
      .select("*, teams(name, division_id, divisions:division_id(name)), leagues(*)")
      .eq("profile_id", prof.id);

    const roles: LeagueRole[] = [];
    const seen = new Set<string>();

    // Organizer roles
    for (const league of ownedLeagues || []) {
      roles.push({ league, role: "organizer" });
      seen.add(league.id);
    }

    // Staff roles
    for (const entry of staffEntries || []) {
      const league = (entry as any).leagues as League;
      if (!league || seen.has(league.id)) continue;
      roles.push({ league, role: entry.role as "admin" | "manager" });
      seen.add(league.id);
    }

    // Player roles
    for (const entry of playerEntries || []) {
      const league = (entry as any).leagues as League;
      if (!league || seen.has(league.id)) continue;
      const team = (entry as any).teams;
      const divName = team?.divisions?.name;
      roles.push({
        league,
        role: "player",
        teamName: team?.name,
        divisionName: divName,
      });
      seen.add(league.id);
    }

    setLeagueRoles(roles);
    setLoading(false);
  }

  async function saveProfile() {
    if (!profile) return;
    setSaving(true);
    setSaved(false);

    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName, phone: phone || null })
      .eq("id", profile.id);

    if (!error) {
      setSaved(true);
      setProfile({ ...profile, full_name: fullName, phone: phone || null });
      setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  }

  async function changePassword() {
    if (newPw !== confirmPw) {
      setPwMsg({ type: "err", text: "Passwords don't match" });
      return;
    }
    if (newPw.length < 8) {
      setPwMsg({ type: "err", text: "Password must be at least 8 characters" });
      return;
    }

    setPwSaving(true);
    setPwMsg(null);

    const { error } = await supabase.auth.updateUser({ password: newPw });

    if (error) {
      setPwMsg({ type: "err", text: error.message });
    } else {
      setPwMsg({ type: "ok", text: "Password updated" });
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      setTimeout(() => setPwMsg(null), 3000);
    }
    setPwSaving(false);
  }

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      organizer: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
      admin: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
      manager: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
      player: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[role] || ""}`}>
        {role.charAt(0).toUpperCase() + role.slice(1)}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Profile</h1>
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Profile</h1>

      {/* Personal Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCircle className="h-5 w-5" />
            Personal Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Full Name</label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your name"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <Mail className="h-3.5 w-3.5" /> Email
              </label>
              <Input value={profile?.email || ""} disabled className="opacity-60" />
              <p className="text-xs text-muted-foreground">Email can&apos;t be changed</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <Phone className="h-3.5 w-3.5" /> Phone
              </label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(optional)"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={saveProfile} disabled={saving} size="sm">
              {saved ? <Check className="h-4 w-4 mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              {saved ? "Saved" : saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* League Roles */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5" />
            Your Leagues &amp; Permissions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {leagueRoles.length === 0 ? (
            <p className="text-muted-foreground text-sm">No leagues yet.</p>
          ) : (
            <div className="space-y-3">
              {leagueRoles.map(({ league, role, teamName, divisionName }) => (
                <div
                  key={league.id}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{league.name}</span>
                      {league.sport && (
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          {league.sport}
                        </Badge>
                      )}
                    </div>
                    {role === "player" && teamName && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {teamName}
                        {divisionName ? ` \u00B7 ${divisionName}` : ""}
                      </p>
                    )}
                  </div>
                  {roleBadge(role)}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Change Password
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 max-w-lg">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium text-muted-foreground">New Password</label>
              <Input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="Min 8 characters"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium text-muted-foreground">Confirm New Password</label>
              <Input
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                placeholder="Confirm password"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={changePassword}
              disabled={pwSaving || !newPw || !confirmPw}
              size="sm"
              variant="outline"
            >
              <KeyRound className="h-4 w-4 mr-1" />
              {pwSaving ? "Updating..." : "Update Password"}
            </Button>
            {pwMsg && (
              <span
                className={`text-sm flex items-center gap-1 ${
                  pwMsg.type === "ok" ? "text-green-600" : "text-destructive"
                }`}
              >
                {pwMsg.type === "ok" ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5" />
                )}
                {pwMsg.text}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
