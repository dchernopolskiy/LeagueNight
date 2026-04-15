"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  UserPlus,
  Copy,
  Check,
  Crown,
  MoreVertical,
  Pencil,
  Trash2,
  ArrowRightLeft,
  Settings2,
  Calendar,
  X,
  ArrowUpCircle,
  XCircle,
} from "lucide-react";
import type { Team, Player, Division, TeamPreferences, Standing } from "@/lib/types";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "next/navigation";

export function TeamsManager({
  leagueId,
  initialTeams,
  initialPlayers,
  divisions = [],
  standings = [],
  activeDivisionId,
  canManage = true,
  currentPlayerId = null,
}: {
  leagueId: string;
  initialTeams: Team[];
  initialPlayers: Player[];
  divisions?: Division[];
  standings?: Standing[];
  activeDivisionId?: string;
  canManage?: boolean;
  currentPlayerId?: string | null;
}) {
  const [teams, setTeams] = useState(initialTeams);
  const [players, setPlayers] = useState(initialPlayers);
  const [newTeamName, setNewTeamName] = useState("");
  const [addingTeam, setAddingTeam] = useState(false);

  // Add player form state
  const [playerName, setPlayerName] = useState("");
  const [playerEmail, setPlayerEmail] = useState("");
  const [playerPhone, setPlayerPhone] = useState("");
  const [playerTeamId, setPlayerTeamId] = useState<string>("");
  const [addingPlayer, setAddingPlayer] = useState(false);

  const [playerError, setPlayerError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Inline editing state
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingTeamName, setEditingTeamName] = useState("");
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editingPlayerName, setEditingPlayerName] = useState("");

  // Delete team dialog
  const [deletingTeamId, setDeletingTeamId] = useState<string | null>(null);
  const [moveToSubPool, setMoveToSubPool] = useState(true);

  // Team promotion dialog
  const [promotingTeamId, setPromotingTeamId] = useState<string | null>(null);
  const [promotionDivisionId, setPromotionDivisionId] = useState<string>("");

  // Team drop out dialog
  const [droppingOutTeamId, setDroppingOutTeamId] = useState<string | null>(null);

  // Team preferences dialog
  const [editingPreferencesTeamId, setEditingPreferencesTeamId] = useState<string | null>(null);
  const [preferredTime, setPreferredTime] = useState<"early" | "late" | "">("");
  const [preferredDays, setPreferredDays] = useState<string[]>([]);
  const [byeDates, setByeDates] = useState<string[]>([]);
  const [newByeDate, setNewByeDate] = useState("");
  const [weekPreferences, setWeekPreferences] = useState<Record<string, "early" | "late">>({});
  const [newWeekNum, setNewWeekNum] = useState("");
  const [newWeekTime, setNewWeekTime] = useState<"early" | "late" | "">("");
  const [preferencesNotes, setPreferencesNotes] = useState("");

  const router = useRouter();

  const activeDivisionName = activeDivisionId
    ? divisions.find((d) => d.id === activeDivisionId)?.name
    : undefined;

  const displayedTeams = activeDivisionId
    ? teams.filter((t) => t.division_id === activeDivisionId)
    : teams;

  // Calculate promotion suggestions
  const promotionSuggestions = canManage && divisions.length > 1 ? (() => {
    const suggestions: Array<{
      team: Team;
      standing: Standing;
      weight: number;
      gamesPlayed: number;
      division: Division | undefined;
    }> = [];

    for (const team of teams) {
      const standing = standings.find((s) => s.team_id === team.id);
      if (!standing) continue;

      const gamesPlayed = standing.wins + standing.losses + standing.ties;
      if (gamesPlayed < 8) continue; // Only suggest after 8 games

      // Calculate weight: 8-0 = 10, 7-1 = 9, 6-2 = 8, etc.
      const weight = standing.wins - standing.losses;

      // Only suggest teams with positive records
      if (weight <= 0) continue;

      const currentDivision = divisions.find((d) => d.id === team.division_id);

      suggestions.push({
        team,
        standing,
        weight,
        gamesPlayed,
        division: currentDivision,
      });
    }

    // Sort by weight descending and return top 3
    return suggestions.sort((a, b) => b.weight - a.weight).slice(0, 3);
  })() : [];

  async function addTeam() {
    if (!newTeamName.trim()) return;
    setAddingTeam(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("teams")
      .insert({ league_id: leagueId, name: newTeamName.trim() })
      .select()
      .single();

    if (!error && data) {
      setTeams([...teams, data as Team]);
      setNewTeamName("");
    }
    setAddingTeam(false);
  }

  async function addPlayer() {
    if (!playerName.trim()) return;
    setAddingPlayer(true);
    setPlayerError(null);
    const supabase = createClient();

    // Handle "none" or empty string as null for sub pool
    const finalTeamId = (!playerTeamId || playerTeamId === "none") ? null : playerTeamId;

    const { data, error } = await supabase
      .from("players")
      .insert({
        league_id: leagueId,
        team_id: finalTeamId,
        name: playerName.trim(),
        email: playerEmail.trim() || null,
        phone: playerPhone.trim() || null,
        is_sub: finalTeamId === null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505" || error.message.includes("duplicate")) {
        setPlayerError("A player with this email already exists in this league.");
      } else {
        setPlayerError(error.message);
      }
      setAddingPlayer(false);
      return;
    }

    if (data) {
      setPlayers([...players, data as Player]);
      setPlayerName("");
      setPlayerEmail("");
      setPlayerPhone("");
      setPlayerTeamId("");
      setPlayerError(null);
    }
    setAddingPlayer(false);
  }

  async function setCaptain(teamId: string, playerId: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("teams")
      .update({ captain_player_id: playerId })
      .eq("id", teamId);

    if (!error) {
      setTeams(
        teams.map((t) =>
          t.id === teamId ? { ...t, captain_player_id: playerId } : t
        )
      );
    }
  }

  async function changeDivision(teamId: string, divisionId: string | null) {
    const supabase = createClient();
    const { error } = await supabase
      .from("teams")
      .update({ division_id: divisionId })
      .eq("id", teamId);
    if (!error) {
      setTeams(
        teams.map((t) =>
          t.id === teamId ? { ...t, division_id: divisionId } : t
        )
      );
    }
  }

  async function confirmPromoteTeam() {
    if (!promotingTeamId || !promotionDivisionId) return;
    await changeDivision(promotingTeamId, promotionDivisionId === "none" ? null : promotionDivisionId);
    setPromotingTeamId(null);
    setPromotionDivisionId("");
  }

  async function confirmDropOutTeam() {
    if (!droppingOutTeamId) return;
    const teamId = droppingOutTeamId;
    const supabase = createClient();

    // Move players to sub pool
    await supabase
      .from("players")
      .update({ team_id: null, is_sub: true })
      .eq("team_id", teamId);
    setPlayers(
      players.map((p) =>
        p.team_id === teamId ? { ...p, team_id: null, is_sub: true } : p
      )
    );

    // Delete the team
    const { error } = await supabase.from("teams").delete().eq("id", teamId);
    if (!error) {
      setTeams(teams.filter((t) => t.id !== teamId));
    }
    setDroppingOutTeamId(null);
  }

  async function renameTeam(teamId: string) {
    if (!editingTeamName.trim()) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("teams")
      .update({ name: editingTeamName.trim() })
      .eq("id", teamId);
    if (!error) {
      setTeams(
        teams.map((t) =>
          t.id === teamId ? { ...t, name: editingTeamName.trim() } : t
        )
      );
    }
    setEditingTeamId(null);
    setEditingTeamName("");
  }

  async function confirmDeleteTeam() {
    if (!deletingTeamId) return;
    const teamId = deletingTeamId;
    const supabase = createClient();

    if (moveToSubPool) {
      // Move players to sub pool
      await supabase
        .from("players")
        .update({ team_id: null, is_sub: true })
        .eq("team_id", teamId);
      setPlayers(
        players.map((p) =>
          p.team_id === teamId ? { ...p, team_id: null, is_sub: true } : p
        )
      );
    } else {
      // Delete players with the team
      await supabase.from("players").delete().eq("team_id", teamId);
      setPlayers(players.filter((p) => p.team_id !== teamId));
    }

    const { error } = await supabase.from("teams").delete().eq("id", teamId);
    if (!error) {
      setTeams(teams.filter((t) => t.id !== teamId));
    }
    setDeletingTeamId(null);
    setMoveToSubPool(true);
  }

  async function movePlayer(playerId: string, newTeamId: string | null) {
    const supabase = createClient();
    const isSub = newTeamId === null;
    const { error } = await supabase
      .from("players")
      .update({ team_id: newTeamId, is_sub: isSub })
      .eq("id", playerId);
    if (!error) {
      setPlayers(
        players.map((p) =>
          p.id === playerId ? { ...p, team_id: newTeamId, is_sub: isSub } : p
        )
      );
    }
  }

  async function renamePlayer(playerId: string) {
    if (!editingPlayerName.trim()) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("players")
      .update({ name: editingPlayerName.trim() })
      .eq("id", playerId);
    if (!error) {
      setPlayers(
        players.map((p) =>
          p.id === playerId ? { ...p, name: editingPlayerName.trim() } : p
        )
      );
    }
    setEditingPlayerId(null);
    setEditingPlayerName("");
  }

  async function deletePlayer(playerId: string) {
    if (!confirm("Remove this player from the league? This cannot be undone.")) return;
    const supabase = createClient();
    const { error } = await supabase.from("players").delete().eq("id", playerId);
    if (!error) {
      setPlayers(players.filter((p) => p.id !== playerId));
    }
  }

  function openTeamPreferences(team: Team) {
    setEditingPreferencesTeamId(team.id);
    const prefs = team.preferences || {};
    setPreferredTime(prefs.preferred_time || "");
    setPreferredDays(prefs.preferred_days || []);
    setByeDates(prefs.bye_dates || []);
    setWeekPreferences(prefs.week_preferences || {});
    setPreferencesNotes(prefs.notes || "");
    setNewByeDate("");
    setNewWeekNum("");
    setNewWeekTime("");
  }

  function closeTeamPreferences() {
    setEditingPreferencesTeamId(null);
    setPreferredTime("");
    setPreferredDays([]);
    setByeDates([]);
    setWeekPreferences({});
    setPreferencesNotes("");
    setNewByeDate("");
    setNewWeekNum("");
    setNewWeekTime("");
  }

  async function saveTeamPreferences() {
    if (!editingPreferencesTeamId) return;

    const preferences: TeamPreferences = {
      preferred_time: preferredTime || null,
      preferred_days: preferredDays.length > 0 ? preferredDays : undefined,
      bye_dates: byeDates.length > 0 ? byeDates : undefined,
      week_preferences: Object.keys(weekPreferences).length > 0 ? weekPreferences : undefined,
      notes: preferencesNotes.trim() || undefined,
    };

    const supabase = createClient();
    const { error } = await supabase
      .from("teams")
      .update({ preferences })
      .eq("id", editingPreferencesTeamId);

    if (!error) {
      setTeams(
        teams.map((t) =>
          t.id === editingPreferencesTeamId ? { ...t, preferences } : t
        )
      );
      closeTeamPreferences();
    }
  }

  function toggleDay(day: string) {
    if (preferredDays.includes(day)) {
      setPreferredDays(preferredDays.filter(d => d !== day));
    } else {
      setPreferredDays([...preferredDays, day]);
    }
  }

  function addByeDate() {
    if (newByeDate && !byeDates.includes(newByeDate)) {
      setByeDates([...byeDates, newByeDate].sort());
      setNewByeDate("");
    }
  }

  function removeByeDate(date: string) {
    setByeDates(byeDates.filter(d => d !== date));
  }

  function addWeekPreference() {
    if (newWeekNum && newWeekTime && !weekPreferences[newWeekNum]) {
      setWeekPreferences({ ...weekPreferences, [newWeekNum]: newWeekTime });
      setNewWeekNum("");
      setNewWeekTime("");
    }
  }

  function removeWeekPreference(week: string) {
    const newPrefs = { ...weekPreferences };
    delete newPrefs[week];
    setWeekPreferences(newPrefs);
  }

  function copyInviteLink(token: string) {
    const url = `${window.location.origin}/p/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  }

  function renderPlayerRow(player: Player, teamId: string | null) {
    const isEditing = editingPlayerId === player.id;
    const otherTeams = teams.filter((t) => t.id !== teamId);

    return (
      <li
        key={player.id}
        className="flex items-center justify-between text-sm py-1"
      >
        {isEditing ? (
          <div className="flex items-center gap-1 flex-1 mr-2">
            <Input
              className="h-6 text-sm"
              value={editingPlayerName}
              onChange={(e) => setEditingPlayerName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") renamePlayer(player.id);
                if (e.key === "Escape") {
                  setEditingPlayerId(null);
                  setEditingPlayerName("");
                }
              }}
              autoFocus
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => renamePlayer(player.id)}
            >
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => {
                setEditingPlayerId(null);
                setEditingPlayerName("");
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <span className="flex items-center gap-1.5">
            {player.name}
            {teamId && teams.find((t) => t.id === teamId)?.captain_player_id === player.id && (
              <Crown className="h-3 w-3 text-amber-500" />
            )}
          </span>
        )}
        <div className="flex items-center gap-1">
          {canManage && teamId && !isEditing && teams.find((t) => t.id === teamId)?.captain_player_id !== player.id && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => setCaptain(teamId, player.id)}
            >
              Make captain
            </Button>
          )}
          {canManage && !isEditing && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => copyInviteLink(player.token)}
            >
              {copiedToken === player.token ? (
                <Check className="h-3 w-3 text-green-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          )}
          {canManage && !isEditing && (
            <DropdownMenu>
              <DropdownMenuTrigger>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                  <MoreVertical className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {otherTeams.length > 0 && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" />
                      Move to...
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {otherTeams.map((t) => (
                        <DropdownMenuItem
                          key={t.id}
                          onClick={() => movePlayer(player.id, t.id)}
                        >
                          {t.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
                {teamId && (
                  <DropdownMenuItem onClick={() => movePlayer(player.id, null)}>
                    <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" />
                    Move to sub pool
                  </DropdownMenuItem>
                )}
                {!teamId && otherTeams.length === 0 && teams.length > 0 && (
                  <>
                    {teams.map((t) => (
                      <DropdownMenuItem
                        key={t.id}
                        onClick={() => movePlayer(player.id, t.id)}
                      >
                        <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" />
                        Move to {t.name}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                <DropdownMenuItem
                  onClick={() => {
                    setEditingPlayerId(player.id);
                    setEditingPlayerName(player.name);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />
                  Edit name
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => deletePlayer(player.id)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Remove from league
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </li>
    );
  }

  const subs = players.filter((p) => p.is_sub);

  return (
    <div className="space-y-6">
      {/* Add team and player — managers only */}
      {canManage && (
        <div className="flex gap-2">
          <Input
            placeholder="New team name"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTeam()}
          />
          <Button onClick={addTeam} disabled={addingTeam}>
            <Plus className="h-4 w-4 mr-1" />
            Add Team
          </Button>
          <Dialog>
            <DialogTrigger>
              <Button variant="outline">
                <UserPlus className="h-4 w-4 mr-2" />
                Add Player
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add a Player</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                {playerError && (
                  <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">
                    {playerError}
                  </p>
                )}
                <div className="space-y-2">
                  <Label>Name *</Label>
                  <Input
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    placeholder="Jane Smith"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={playerEmail}
                    onChange={(e) => setPlayerEmail(e.target.value)}
                    placeholder="jane@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input
                    value={playerPhone}
                    onChange={(e) => setPlayerPhone(e.target.value)}
                    placeholder="+1 555-1234"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Team</Label>
                  <Select value={playerTeamId} onValueChange={(v) => v && setPlayerTeamId(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Sub pool (no team)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sub pool (no team)</SelectItem>
                      {divisions.length > 0 ? (
                        <>
                          {divisions.map((div) => {
                            const divTeams = teams.filter(
                              (t) => t.division_id === div.id
                            );
                            if (divTeams.length === 0) return null;
                            return (
                              <div key={div.id}>
                                <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                                  {div.name}
                                </p>
                                {divTeams.map((t) => (
                                  <SelectItem key={t.id} value={t.id}>
                                    {t.name}
                                  </SelectItem>
                                ))}
                              </div>
                            );
                          })}
                          {teams.filter((t) => !t.division_id).length > 0 && (
                            <div>
                              <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                                No division
                              </p>
                              {teams
                                .filter((t) => !t.division_id)
                                .map((t) => (
                                  <SelectItem key={t.id} value={t.id}>
                                    {t.name}
                                  </SelectItem>
                                ))}
                            </div>
                          )}
                        </>
                      ) : (
                        teams.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={addPlayer}
                  disabled={addingPlayer || !playerName.trim()}
                  className="w-full"
                >
                  {addingPlayer ? "Adding..." : "Add Player"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* Division filter indicator */}
      {activeDivisionName && (
        <p className="text-sm text-muted-foreground">
          Showing <span className="font-medium text-foreground">{activeDivisionName}</span>{" "}
          ({displayedTeams.length} {displayedTeams.length === 1 ? "team" : "teams"})
        </p>
      )}

      {/* Promotion suggestions */}
      {promotionSuggestions.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ArrowUpCircle className="h-4 w-4 text-amber-600" />
              Division Promotion Suggestions
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Based on performance after 8+ games. Suggestions refresh automatically when standings update.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {promotionSuggestions.map((suggestion) => (
                <div
                  key={suggestion.team.id}
                  className="flex items-center justify-between bg-white rounded-lg p-3 border"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary" className="font-mono">
                      {suggestion.standing.wins}-{suggestion.standing.losses}
                      {suggestion.standing.ties > 0 && `-${suggestion.standing.ties}`}
                    </Badge>
                    <div>
                      <p className="font-medium text-sm">{suggestion.team.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {suggestion.division?.name || "No division"} • Weight: {suggestion.weight}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPromotingTeamId(suggestion.team.id);
                      setPromotionDivisionId("");
                    }}
                  >
                    <ArrowUpCircle className="h-3.5 w-3.5 mr-1.5" />
                    Promote
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Teams grid */}
      <div className="grid gap-4 sm:grid-cols-2">
        {displayedTeams.map((team) => {
          const teamPlayers = players.filter((p) => p.team_id === team.id);
          const isEditingThisTeam = editingTeamId === team.id;

          return (
            <Card key={team.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2 flex-1 min-w-0">
                    {isEditingThisTeam ? (
                      <div className="flex items-center gap-1 flex-1">
                        <Input
                          className="h-7 text-sm"
                          value={editingTeamName}
                          onChange={(e) => setEditingTeamName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") renameTeam(team.id);
                            if (e.key === "Escape") {
                              setEditingTeamId(null);
                              setEditingTeamName("");
                            }
                          }}
                          autoFocus
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => renameTeam(team.id)}
                        >
                          Save
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => {
                            setEditingTeamId(null);
                            setEditingTeamName("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <>
                        {team.name}
                        {team.division_id && divisions.length > 0 && (
                          <Badge variant="outline" className="text-xs font-normal">
                            {divisions.find((d) => d.id === team.division_id)?.name}
                          </Badge>
                        )}
                      </>
                    )}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <Badge variant="secondary">{teamPlayers.length} players</Badge>
                    {!isEditingThisTeam && (canManage || team.captain_player_id === currentPlayerId) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canManage && (
                            <DropdownMenuItem
                              onClick={() => {
                                setEditingTeamId(team.id);
                                setEditingTeamName(team.name);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5 mr-1.5" />
                              Rename team
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => openTeamPreferences(team)}>
                            <Settings2 className="h-3.5 w-3.5 mr-1.5" />
                            Scheduling preferences
                          </DropdownMenuItem>
                          {canManage && divisions.length > 1 && (
                            <DropdownMenuItem onClick={() => setPromotingTeamId(team.id)}>
                              <ArrowUpCircle className="h-3.5 w-3.5 mr-1.5" />
                              Change division
                            </DropdownMenuItem>
                          )}
                          {canManage && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setDroppingOutTeamId(team.id)}
                              >
                                <XCircle className="h-3.5 w-3.5 mr-1.5" />
                                Drop out of season
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => { setDeletingTeamId(team.id); setMoveToSubPool(true); }}
                              >
                                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                                Delete team
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </CardTitle>
                {divisions.length > 0 && canManage && (
                  <Select
                    value={team.division_id || "none"}
                    onValueChange={(v) =>
                      v && changeDivision(team.id, v === "none" ? null : v)
                    }
                  >
                    <SelectTrigger className="h-7 text-xs w-auto">
                      <SelectValue>
                        {team.division_id
                          ? divisions.find((d) => d.id === team.division_id)?.name || "No division"
                          : "No division"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No division</SelectItem>
                      {divisions.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </CardHeader>
              <CardContent>
                {teamPlayers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No players yet</p>
                ) : (
                  <ul className="space-y-1">
                    {teamPlayers.map((player) => renderPlayerRow(player, team.id))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Delete team confirmation dialog */}
      {deletingTeamId && (
        <Dialog open onOpenChange={(open) => { if (!open) setDeletingTeamId(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Team</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground">
                Are you sure you want to delete{" "}
                <span className="font-medium text-foreground">
                  {teams.find((t) => t.id === deletingTeamId)?.name}
                </span>
                ? This cannot be undone.
              </p>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={moveToSubPool}
                  onChange={(e) => setMoveToSubPool(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm">Move players to sub pool</span>
              </label>
              {!moveToSubPool && (
                <p className="text-xs text-destructive">
                  Players will be permanently removed from the league.
                </p>
              )}
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setDeletingTeamId(null)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={confirmDeleteTeam}>
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete Team
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Team promotion dialog */}
      {promotingTeamId && (
        <Dialog open onOpenChange={(open) => { if (!open) { setPromotingTeamId(null); setPromotionDivisionId(""); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change Division</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground">
                Move{" "}
                <span className="font-medium text-foreground">
                  {teams.find((t) => t.id === promotingTeamId)?.name}
                </span>{" "}
                to a different division.
              </p>
              <div className="space-y-2">
                <Label>New Division</Label>
                <Select value={promotionDivisionId} onValueChange={(v) => v && setPromotionDivisionId(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select division" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No division</SelectItem>
                    {divisions.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => { setPromotingTeamId(null); setPromotionDivisionId(""); }}>
                  Cancel
                </Button>
                <Button onClick={confirmPromoteTeam} disabled={!promotionDivisionId}>
                  <ArrowUpCircle className="h-4 w-4 mr-1" />
                  Change Division
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Team drop out dialog */}
      {droppingOutTeamId && (
        <Dialog open onOpenChange={(open) => { if (!open) setDroppingOutTeamId(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Drop Out of Season</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground">
                Are you sure{" "}
                <span className="font-medium text-foreground">
                  {teams.find((t) => t.id === droppingOutTeamId)?.name}
                </span>{" "}
                wants to drop out of the season?
              </p>
              <p className="text-sm text-muted-foreground">
                The team will be removed and all players will be moved to the sub pool. This action cannot be undone.
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setDroppingOutTeamId(null)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={confirmDropOutTeam}>
                  <XCircle className="h-4 w-4 mr-1" />
                  Drop Out
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Team Preferences Dialog */}
      {editingPreferencesTeamId && (
        <Dialog open={editingPreferencesTeamId !== null} onOpenChange={(open) => !open && closeTeamPreferences()}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5" />
                Scheduling Preferences: {teams.find(t => t.id === editingPreferencesTeamId)?.name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-6 pt-4">
              {/* Preferred Time */}
              <div className="space-y-2">
                <Label htmlFor="pref-time" className="text-sm font-medium">
                  Preferred Game Time
                </Label>
                <Select value={preferredTime} onValueChange={(v) => setPreferredTime(v as "early" | "late" | "")}>
                  <SelectTrigger id="pref-time">
                    <SelectValue placeholder="No preference" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No preference</SelectItem>
                    <SelectItem value="early">Early games</SelectItem>
                    <SelectItem value="late">Late games</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Team requests to play either early or late time slots when possible
                </p>
              </div>

              {/* Preferred Days */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Preferred Days of Week</Label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => (
                    <label key={day} className="flex items-center gap-2 cursor-pointer hover:bg-accent rounded px-2 py-1.5 transition-colors">
                      <Checkbox
                        checked={preferredDays.includes(day)}
                        onCheckedChange={() => toggleDay(day)}
                      />
                      <span className="text-sm">{day.slice(0, 3)}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Select days when the team prefers to play
                </p>
              </div>

              {/* Bye Dates */}
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Requested Bye Dates
                </Label>
                {byeDates.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {byeDates.map((date) => (
                      <Badge key={date} variant="secondary" className="flex items-center gap-1">
                        {new Date(date + "T00:00:00").toLocaleDateString()}
                        <button
                          onClick={() => removeByeDate(date)}
                          className="hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    type="date"
                    value={newByeDate}
                    onChange={(e) => setNewByeDate(e.target.value)}
                    className="flex-1"
                  />
                  <Button variant="outline" onClick={addByeDate} disabled={!newByeDate}>
                    Add
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Request specific dates when the team needs a bye week (e.g., team event, holiday)
                </p>
              </div>

              {/* Week-Specific Preferences */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Week-Specific Time Preferences</Label>
                {Object.keys(weekPreferences).length > 0 && (
                  <div className="space-y-1 mb-2">
                    {Object.entries(weekPreferences).map(([week, time]) => (
                      <div key={week} className="flex items-center justify-between border rounded px-3 py-2">
                        <span className="text-sm">
                          Week {week}: <Badge variant="outline">{time === "early" ? "Early" : "Late"}</Badge>
                        </span>
                        <button
                          onClick={() => removeWeekPreference(week)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min="1"
                    placeholder="Week #"
                    value={newWeekNum}
                    onChange={(e) => setNewWeekNum(e.target.value)}
                    className="w-24"
                  />
                  <Select value={newWeekTime} onValueChange={(v) => setNewWeekTime(v as "early" | "late")}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Time preference" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="early">Early</SelectItem>
                      <SelectItem value="late">Late</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={addWeekPreference} disabled={!newWeekNum || !newWeekTime}>
                    Add
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Request early or late games for specific weeks (e.g., weeks 1 and 3 need late games)
                </p>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label htmlFor="pref-notes" className="text-sm font-medium">
                  Additional Notes
                </Label>
                <Textarea
                  id="pref-notes"
                  value={preferencesNotes}
                  onChange={(e) => setPreferencesNotes(e.target.value)}
                  placeholder="Any other scheduling requests or constraints..."
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  Optional notes about scheduling needs or constraints
                </p>
              </div>

              <div className="flex gap-2 justify-end pt-4 border-t">
                <Button variant="outline" onClick={closeTeamPreferences}>
                  Cancel
                </Button>
                <Button onClick={saveTeamPreferences}>
                  <Check className="h-4 w-4 mr-2" />
                  Save Preferences
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Sub pool */}
      {subs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Sub Pool
              <Badge variant="secondary" className="ml-2">
                {subs.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {subs.map((sub) => renderPlayerRow(sub, null))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
