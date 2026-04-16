"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { Plus, MoreVertical, Pencil, Trash2, UserPlus } from "lucide-react";
import type { Player, SubRequest, Game, Team } from "@/lib/types";

export default function SubsPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const [subs, setSubs] = useState<Player[]>([]);
  const [requests, setRequests] = useState<SubRequest[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [addToTeamDialogOpen, setAddToTeamDialogOpen] = useState(false);
  const [selectedSub, setSelectedSub] = useState<Player | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    notification_pref: "email" as "email" | "sms" | "none" | "push",
  });

  useEffect(() => {
    loadData();
  }, [leagueId]);

  async function loadData() {
    const supabase = createClient();
    const [subsRes, reqsRes, gamesRes, teamsRes] = await Promise.all([
      supabase
        .from("players")
        .select("*")
        .eq("league_id", leagueId)
        .eq("is_sub", true)
        .order("name"),
      supabase
        .from("sub_requests")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("games")
        .select("*")
        .eq("league_id", leagueId)
        .eq("status", "scheduled")
        .order("scheduled_at"),
      supabase.from("teams").select("*").eq("league_id", leagueId),
    ]);
    setSubs((subsRes.data || []) as Player[]);
    setRequests((reqsRes.data || []) as SubRequest[]);
    setGames((gamesRes.data || []) as Game[]);
    setTeams((teamsRes.data || []) as Team[]);
    setLoading(false);
  }

  async function handleAddSub() {
    if (!formData.name.trim()) return;

    const supabase = createClient();
    const { error } = await supabase.from("players").insert({
      league_id: leagueId,
      name: formData.name,
      email: formData.email || null,
      phone: formData.phone || null,
      notification_pref: formData.notification_pref,
      is_sub: true,
      team_id: null,
    });

    if (!error) {
      setFormData({ name: "", email: "", phone: "", notification_pref: "email" });
      setAddDialogOpen(false);
      await loadData();
    }
  }

  async function handleEditSub() {
    if (!selectedSub || !formData.name.trim()) return;

    const supabase = createClient();
    const { error } = await supabase
      .from("players")
      .update({
        name: formData.name,
        email: formData.email || null,
        phone: formData.phone || null,
        notification_pref: formData.notification_pref,
      })
      .eq("id", selectedSub.id);

    if (!error) {
      setEditDialogOpen(false);
      setSelectedSub(null);
      setFormData({ name: "", email: "", phone: "", notification_pref: "email" });
      await loadData();
    }
  }

  async function handleDeleteSub(subId: string) {
    const supabase = createClient();
    const { error } = await supabase.from("players").delete().eq("id", subId);

    if (!error) {
      await loadData();
    }
  }

  async function handleAddToTeam(teamId: string) {
    if (!selectedSub) return;

    const supabase = createClient();
    const { error } = await supabase
      .from("players")
      .update({
        team_id: teamId,
        is_sub: false,
      })
      .eq("id", selectedSub.id);

    if (!error) {
      setAddToTeamDialogOpen(false);
      setSelectedSub(null);
      await loadData();
    }
  }

  function openAddDialog() {
    setFormData({ name: "", email: "", phone: "", notification_pref: "email" });
    setAddDialogOpen(true);
  }

  function openEditDialog(sub: Player) {
    setSelectedSub(sub);
    setFormData({
      name: sub.name,
      email: sub.email || "",
      phone: sub.phone || "",
      notification_pref: sub.notification_pref || "email",
    });
    setEditDialogOpen(true);
  }

  function openViewDialog(sub: Player) {
    setSelectedSub(sub);
    setViewDialogOpen(true);
  }

  function openAddToTeamDialog(sub: Player) {
    setSelectedSub(sub);
    setAddToTeamDialogOpen(true);
  }

  const teamsMap = new Map(teams.map((t) => [t.id, t]));
  const subsMap = new Map(subs.map((s) => [s.id, s]));

  if (loading) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-6">
      {/* Sub pool */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-base">
            Sub Pool <Badge variant="secondary">{subs.length}</Badge>
          </CardTitle>
          <Button onClick={openAddDialog} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Add a sub
          </Button>
        </CardHeader>
        <CardContent>
          {subs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No subs in the pool yet. Click "Add a sub" to get started.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {subs.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center justify-between border rounded-lg p-3 hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => openViewDialog(sub)}
                >
                  <div>
                    <p className="text-sm font-medium">{sub.name}</p>
                    {sub.email && (
                      <p className="text-xs text-muted-foreground">
                        {sub.email}
                      </p>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          openAddToTeamDialog(sub);
                        }}
                      >
                        <UserPlus className="mr-2 h-4 w-4" />
                        Add to team
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditDialog(sub);
                        }}
                      >
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete ${sub.name}?`)) {
                            handleDeleteSub(sub.id);
                          }
                        }}
                        className="text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active sub requests */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sub Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No sub requests yet.
            </p>
          ) : (
            <div className="space-y-2">
              {requests.map((req) => {
                const game = games.find((g) => g.id === req.game_id);
                const team = teamsMap.get(req.team_id);
                const claimedBy = req.claimed_by
                  ? subsMap.get(req.claimed_by)
                  : null;

                return (
                  <div
                    key={req.id}
                    className="flex items-center justify-between border rounded-lg p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {team?.name} needs a sub
                      </p>
                      {game && (
                        <p className="text-xs text-muted-foreground">
                          {format(
                            new Date(game.scheduled_at),
                            "EEE, MMM d 'at' h:mm a"
                          )}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant={
                        req.status === "open"
                          ? "secondary"
                          : req.status === "claimed"
                          ? "default"
                          : "destructive"
                      }
                    >
                      {req.status === "claimed" && claimedBy
                        ? `Claimed: ${claimedBy.name}`
                        : req.status}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Sub Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a sub</DialogTitle>
            <DialogDescription>
              Add a substitute player to the pool. They can be assigned to teams later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Player name"
              />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="player@example.com"
              />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="(555) 123-4567"
              />
            </div>
            <div>
              <Label htmlFor="notification_pref">Notification Preference</Label>
              <Select
                value={formData.notification_pref}
                onValueChange={(value: any) =>
                  setFormData({ ...formData, notification_pref: value })
                }
              >
                <SelectTrigger id="notification_pref">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddSub}>Add Sub</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Sub Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit sub</DialogTitle>
            <DialogDescription>Update the substitute player's information.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-name">Name *</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Player name"
              />
            </div>
            <div>
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="player@example.com"
              />
            </div>
            <div>
              <Label htmlFor="edit-phone">Phone</Label>
              <Input
                id="edit-phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="(555) 123-4567"
              />
            </div>
            <div>
              <Label htmlFor="edit-notification_pref">Notification Preference</Label>
              <Select
                value={formData.notification_pref}
                onValueChange={(value: any) =>
                  setFormData({ ...formData, notification_pref: value })
                }
              >
                <SelectTrigger id="edit-notification_pref">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditSub}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Sub Dialog (Player Card) */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedSub?.name}</DialogTitle>
            <DialogDescription>Substitute player details</DialogDescription>
          </DialogHeader>
          {selectedSub && (
            <div className="space-y-3">
              {selectedSub.email && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Email</p>
                  <p className="text-sm">{selectedSub.email}</p>
                </div>
              )}
              {selectedSub.phone && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Phone</p>
                  <p className="text-sm">{selectedSub.phone}</p>
                </div>
              )}
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Notification Preference
                </p>
                <p className="text-sm capitalize">
                  {selectedSub.notification_pref || "email"}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Status</p>
                <Badge variant="secondary">Available</Badge>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add to Team Dialog */}
      <Dialog open={addToTeamDialogOpen} onOpenChange={setAddToTeamDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {selectedSub?.name} to a team</DialogTitle>
            <DialogDescription>
              Select a team to assign this sub to. They will become a regular team member.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Select onValueChange={handleAddToTeam}>
              <SelectTrigger>
                <SelectValue placeholder="Select a team" />
              </SelectTrigger>
              <SelectContent>
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddToTeamDialogOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
