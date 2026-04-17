"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MapPin, Plus, Pencil, Trash2, X, CalendarX, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import type { Location, LocationUnavailability, Game, League } from "@/lib/types";

const SPORT_SUGGESTIONS = [
  "Basketball",
  "Volleyball",
  "Soccer",
  "Tennis",
  "Baseball",
  "Football",
  "Multi-sport",
];

interface ConflictGame {
  id: string;
  league_id: string;
  scheduled_at: string;
  home_team_id: string;
  away_team_id: string;
  venue: string | null;
  location_id: string | null;
  leagueName?: string;
}

interface LocationsManagerProps {
  initialLocations: Location[];
  initialUnavailability: LocationUnavailability[];
  organizerId: string;
  leagues?: League[];
  games?: Game[];
}

export function LocationsManager({
  initialLocations,
  initialUnavailability,
  organizerId,
  leagues = [],
  games = [],
}: LocationsManagerProps) {
  const [locations, setLocations] = useState<Location[]>(initialLocations);
  const [unavailability, setUnavailability] = useState<LocationUnavailability[]>(
    initialUnavailability
  );

  // Conflict tracking
  const [conflicts, setConflicts] = useState<Map<string, ConflictGame[]>>(new Map());

  // Add dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addAddress, setAddAddress] = useState("");
  const [addCourtCount, setAddCourtCount] = useState("1");
  const [addNotes, setAddNotes] = useState("");
  const [addTags, setAddTags] = useState<string[]>([]);
  const [addTagInput, setAddTagInput] = useState("");
  const [adding, setAdding] = useState(false);

  // Edit dialog state
  const [editLocation, setEditLocation] = useState<Location | null>(null);
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editCourtCount, setEditCourtCount] = useState("1");
  const [editNotes, setEditNotes] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editTagInput, setEditTagInput] = useState("");
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Unavailability form per location
  const [unavailDate, setUnavailDate] = useState<Record<string, string>>({});
  const [unavailReason, setUnavailReason] = useState<Record<string, string>>(
    {}
  );
  const [showPastUnavail, setShowPastUnavail] = useState<Record<string, boolean>>({});

  const leaguesMap = new Map(leagues.map((l) => [l.id, l]));

  function addTag(tags: string[], setTags: (t: string[]) => void, tag: string) {
    const trimmed = tag.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
  }

  function removeTag(tags: string[], setTags: (t: string[]) => void, tag: string) {
    setTags(tags.filter((t) => t !== tag));
  }

  async function checkConflicts(locationId: string, unavailableDate: string) {
    // Check local games data first
    const affected = games.filter(
      (g) =>
        g.location_id === locationId &&
        g.status === "scheduled" &&
        format(new Date(g.scheduled_at), "yyyy-MM-dd") === unavailableDate
    );

    if (affected.length > 0) {
      const conflictGames: ConflictGame[] = affected.map((g) => ({
        ...g,
        leagueName: leaguesMap.get(g.league_id)?.name || "Unknown League",
      }));
      setConflicts((prev) => {
        const next = new Map(prev);
        const existing = next.get(locationId) || [];
        // Merge, avoiding duplicates
        const ids = new Set(existing.map((c) => c.id));
        const merged = [...existing, ...conflictGames.filter((c) => !ids.has(c.id))];
        next.set(locationId, merged);
        return next;
      });
    }

    // Also do a live query for games we might not have locally
    const supabase = createClient();
    const { data: liveGames } = await supabase
      .from("games")
      .select("id, league_id, scheduled_at, home_team_id, away_team_id, venue, location_id")
      .eq("location_id", locationId)
      .eq("status", "scheduled");

    if (liveGames && liveGames.length > 0) {
      const liveAffected = liveGames.filter(
        (g) => format(new Date(g.scheduled_at), "yyyy-MM-dd") === unavailableDate
      );
      if (liveAffected.length > 0) {
        // Fetch league names for any we don't already have
        const leagueIds = [...new Set(liveAffected.map((g) => g.league_id))];
        const missingIds = leagueIds.filter((id) => !leaguesMap.has(id));
        let extraLeagues = new Map<string, string>();
        if (missingIds.length > 0) {
          const { data: extraLeagueData } = await supabase
            .from("leagues")
            .select("id, name")
            .in("id", missingIds);
          if (extraLeagueData) {
            extraLeagues = new Map(extraLeagueData.map((l) => [l.id, l.name]));
          }
        }

        const conflictGames: ConflictGame[] = liveAffected.map((g) => ({
          ...g,
          leagueName:
            leaguesMap.get(g.league_id)?.name ||
            extraLeagues.get(g.league_id) ||
            "Unknown League",
        }));

        setConflicts((prev) => {
          const next = new Map(prev);
          const existing = next.get(locationId) || [];
          const ids = new Set(existing.map((c) => c.id));
          const merged = [...existing, ...conflictGames.filter((c) => !ids.has(c.id))];
          next.set(locationId, merged);
          return next;
        });
      }
    }
  }

  async function addLocation() {
    if (!addName.trim()) return;
    setAdding(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("locations")
      .insert({
        organizer_id: organizerId,
        name: addName.trim(),
        address: addAddress.trim() || null,
        court_count: parseInt(addCourtCount) || 1,
        notes: addNotes.trim() || null,
        tags: addTags,
      })
      .select()
      .single();

    if (!error && data) {
      setLocations([...locations, data as Location]);
      setAddName("");
      setAddAddress("");
      setAddCourtCount("1");
      setAddNotes("");
      setAddTags([]);
      setAddTagInput("");
      setAddOpen(false);
    }
    setAdding(false);
  }

  function openEdit(loc: Location) {
    setEditLocation(loc);
    setEditName(loc.name);
    setEditAddress(loc.address || "");
    setEditCourtCount(loc.court_count.toString());
    setEditNotes(loc.notes || "");
    setEditTags(loc.tags || []);
    setEditTagInput("");
  }

  async function saveEdit() {
    if (!editLocation || !editName.trim()) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("locations")
      .update({
        name: editName.trim(),
        address: editAddress.trim() || null,
        court_count: parseInt(editCourtCount) || 1,
        notes: editNotes.trim() || null,
        tags: editTags,
      })
      .eq("id", editLocation.id);

    if (!error) {
      setLocations(
        locations.map((l) =>
          l.id === editLocation.id
            ? {
                ...l,
                name: editName.trim(),
                address: editAddress.trim() || null,
                court_count: parseInt(editCourtCount) || 1,
                notes: editNotes.trim() || null,
                tags: editTags,
              }
            : l
        )
      );
      setEditLocation(null);
    }
    setSaving(false);
  }

  async function deleteLocation(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("locations").delete().eq("id", id);
    if (!error) {
      setLocations(locations.filter((l) => l.id !== id));
      setUnavailability(unavailability.filter((u) => u.location_id !== id));
    }
    setConfirmDelete(null);
  }

  async function addUnavailability(locationId: string) {
    const date = unavailDate[locationId];
    if (!date) return;
    const reason = unavailReason[locationId] || null;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("location_unavailability")
      .insert({
        location_id: locationId,
        unavailable_date: date,
        reason: reason?.trim() || null,
      })
      .select()
      .single();

    if (!error && data) {
      setUnavailability([...unavailability, data as LocationUnavailability]);
      setUnavailDate((prev) => ({ ...prev, [locationId]: "" }));
      setUnavailReason((prev) => ({ ...prev, [locationId]: "" }));

      // Check for conflicts
      await checkConflicts(locationId, date);
    }
  }

  async function removeUnavailability(id: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("location_unavailability")
      .delete()
      .eq("id", id);
    if (!error) {
      // Also clear any conflicts for this unavailability's date/location
      const removed = unavailability.find((u) => u.id === id);
      if (removed) {
        setConflicts((prev) => {
          const next = new Map(prev);
          const existing = next.get(removed.location_id) || [];
          const filtered = existing.filter(
            (c) =>
              format(new Date(c.scheduled_at), "yyyy-MM-dd") !== removed.unavailable_date
          );
          if (filtered.length === 0) {
            next.delete(removed.location_id);
          } else {
            next.set(removed.location_id, filtered);
          }
          return next;
        });
      }
      setUnavailability(unavailability.filter((u) => u.id !== id));
    }
  }

  const today = new Date().toISOString().split("T")[0];

  function renderTagsInput(
    tags: string[],
    setTags: (t: string[]) => void,
    tagInput: string,
    setTagInput: (v: string) => void
  ) {
    return (
      <div className="space-y-2">
        <Label>Tags</Label>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="gap-1 text-xs">
                {tag}
                <button
                  onClick={() => removeTag(tags, setTags, tag)}
                  className="ml-0.5 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="Add a tag..."
            className="h-8 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag(tags, setTags, tagInput);
                setTagInput("");
              }
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs shrink-0"
            onClick={() => {
              addTag(tags, setTags, tagInput);
              setTagInput("");
            }}
            disabled={!tagInput.trim()}
          >
            Add
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {SPORT_SUGGESTIONS.filter((s) => !tags.includes(s)).map((sport) => (
            <button
              key={sport}
              type="button"
              onClick={() => addTag(tags, setTags, sport)}
              className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              + {sport}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const TAG_COLORS: Record<string, string> = {
    Basketball: "bg-orange-100 text-orange-800 border-orange-200",
    Volleyball: "bg-blue-100 text-blue-800 border-blue-200",
    Soccer: "bg-green-100 text-green-800 border-green-200",
    Tennis: "bg-yellow-100 text-yellow-800 border-yellow-200",
    Baseball: "bg-red-100 text-red-800 border-red-200",
    Football: "bg-purple-100 text-purple-800 border-purple-200",
    "Multi-sport": "bg-gray-100 text-gray-800 border-gray-200",
  };

  return (
    <div className="space-y-4">
      {/* Add Location Button */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogTrigger render={<Button size="sm" />}>
          <Plus className="h-4 w-4 mr-1" />
          Add Location
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Location</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="South Sound YMCA"
              />
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Input
                value={addAddress}
                onChange={(e) => setAddAddress(e.target.value)}
                placeholder="123 Main St, City, ST 12345"
              />
            </div>
            <div className="space-y-2">
              <Label>Number of courts</Label>
              <Input
                type="number"
                min={1}
                value={addCourtCount}
                onChange={(e) => setAddCourtCount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={addNotes}
                onChange={(e) => setAddNotes(e.target.value)}
                placeholder="Enter through the side door..."
                rows={2}
              />
            </div>
            {renderTagsInput(addTags, setAddTags, addTagInput, setAddTagInput)}
            <Button
              onClick={addLocation}
              disabled={adding || !addName.trim()}
              className="w-full"
            >
              {adding ? "Saving..." : "Save Location"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Locations Grid */}
      {locations.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">
          No locations yet. Add your first venue to get started.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {locations.map((loc) => {
            const locUnavail = unavailability
              .filter(
                (u) =>
                  u.location_id === loc.id && u.unavailable_date >= today
              )
              .sort((a, b) =>
                a.unavailable_date.localeCompare(b.unavailable_date)
              );

            const locUnavailPast = unavailability
              .filter(
                (u) =>
                  u.location_id === loc.id && u.unavailable_date < today
              )
              .sort((a, b) =>
                b.unavailable_date.localeCompare(a.unavailable_date)
              );

            const locConflicts = conflicts.get(loc.id) || [];

            return (
              <Card key={loc.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <MapPin className="h-4 w-4 shrink-0" />
                      {loc.name}
                    </CardTitle>
                    <div className="flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground"
                        onClick={() => openEdit(loc)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setConfirmDelete(loc.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Tags */}
                  {loc.tags && loc.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {loc.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="outline"
                          className={`text-[10px] ${TAG_COLORS[tag] || "bg-slate-100 text-slate-700 border-slate-200"}`}
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {loc.address && (
                    <p className="text-sm text-muted-foreground">
                      {loc.address}
                    </p>
                  )}
                  <p className="text-sm">
                    {loc.court_count > 1
                      ? `${loc.court_count} courts`
                      : "1 court"}
                  </p>
                  {loc.notes && (
                    <p className="text-xs text-muted-foreground italic">
                      {loc.notes}
                    </p>
                  )}

                  {/* Unavailable dates */}
                  <div className="space-y-2 pt-2 border-t">
                    <p className="text-xs font-medium flex items-center gap-1">
                      <CalendarX className="h-3.5 w-3.5" />
                      Unavailable Dates
                    </p>
                    {locUnavail.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {locUnavail.map((u) => {
                          const hasConflictsForDate = locConflicts.some(
                            (c) => format(new Date(c.scheduled_at), "yyyy-MM-dd") === u.unavailable_date
                          );
                          return (
                            <Badge
                              key={u.id}
                              variant="secondary"
                              className={`gap-1 text-xs ${hasConflictsForDate ? "border-amber-300 bg-amber-100 text-amber-800 cursor-pointer" : ""}`}
                              onClick={hasConflictsForDate ? () => {
                                document.getElementById(`conflicts-${loc.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                              } : undefined}
                            >
                              {hasConflictsForDate && <AlertTriangle className="h-3 w-3" />}
                              {u.unavailable_date}
                              {u.reason && (
                                <span className="text-muted-foreground">
                                  ({u.reason})
                                </span>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); removeUnavailability(u.id); }}
                                className="ml-0.5 hover:text-destructive"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">None</p>
                    )}
                    <div className="flex items-end gap-2">
                      <div className="space-y-1 flex-1">
                        <Input
                          type="date"
                          value={unavailDate[loc.id] || ""}
                          onChange={(e) =>
                            setUnavailDate((prev) => ({
                              ...prev,
                              [loc.id]: e.target.value,
                            }))
                          }
                          className="h-7 text-xs"
                        />
                      </div>
                      <div className="space-y-1 flex-1">
                        <Input
                          value={unavailReason[loc.id] || ""}
                          onChange={(e) =>
                            setUnavailReason((prev) => ({
                              ...prev,
                              [loc.id]: e.target.value,
                            }))
                          }
                          placeholder="Reason"
                          className="h-7 text-xs"
                        />
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => addUnavailability(loc.id)}
                        disabled={!unavailDate[loc.id]}
                      >
                        Add
                      </Button>
                    </div>

                    {locUnavailPast.length > 0 && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() =>
                            setShowPastUnavail((prev) => ({
                              ...prev,
                              [loc.id]: !prev[loc.id],
                            }))
                          }
                          className="text-xs text-muted-foreground hover:text-foreground underline"
                        >
                          {showPastUnavail[loc.id] ? "Hide" : "Show"} past ({locUnavailPast.length})
                        </button>
                        {showPastUnavail[loc.id] && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {locUnavailPast.map((u) => (
                              <Badge
                                key={u.id}
                                variant="outline"
                                className="gap-1 text-xs text-muted-foreground"
                              >
                                {u.unavailable_date}
                                {u.reason && (
                                  <span>({u.reason})</span>
                                )}
                                <button
                                  onClick={() => removeUnavailability(u.id)}
                                  className="ml-0.5 hover:text-destructive"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Conflict alerts */}
                  {locConflicts.length > 0 && (
                    <div id={`conflicts-${loc.id}`} className="space-y-2 pt-2 border-t border-amber-200 bg-amber-50/50 -mx-6 px-6 py-3 rounded-b-lg">
                      <p className="text-xs font-medium flex items-center gap-1 text-amber-700">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {locConflicts.length} game{locConflicts.length !== 1 ? "s" : ""} affected by unavailability
                      </p>
                      <div className="space-y-1.5">
                        {locConflicts.map((c) => (
                          <div
                            key={c.id}
                            className="text-xs text-amber-800 bg-amber-100 rounded px-2 py-1.5 flex items-center justify-between"
                          >
                            <div>
                              <span className="font-medium">{c.leagueName}</span>
                              {" - "}
                              {format(new Date(c.scheduled_at), "MMM d 'at' h:mm a")}
                            </div>
                            <a
                              href={`/dashboard/leagues/${c.league_id}/schedule`}
                              className="text-amber-900 underline hover:no-underline font-medium ml-2 shrink-0"
                            >
                              Resolve
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Edit Location Dialog */}
      <Dialog
        open={!!editLocation}
        onOpenChange={(open) => !open && setEditLocation(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Location</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Input
                value={editAddress}
                onChange={(e) => setEditAddress(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Number of courts</Label>
              <Input
                type="number"
                min={1}
                value={editCourtCount}
                onChange={(e) => setEditCourtCount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={2}
              />
            </div>
            {renderTagsInput(editTags, setEditTags, editTagInput, setEditTagInput)}
            <Button
              onClick={saveEdit}
              disabled={saving || !editName.trim()}
              className="w-full"
            >
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Location?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete this location and all its unavailability
            records. Games already using this location will not be affected.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDelete && deleteLocation(confirmDelete)}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
