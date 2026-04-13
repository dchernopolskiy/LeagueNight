"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus,
  Pencil,
  Trash2,
  Download,
  Calendar,
  Clock,
  Users,
  DollarSign,
  MapPin,
  Power,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { format, addDays, startOfWeek, isBefore, isAfter, addWeeks } from "date-fns";
import { generateOpenGymPdf } from "@/lib/export/open-gym-pdf";
import type { Location, OpenGymSession } from "@/lib/types";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const SPORT_OPTIONS = ["Volleyball", "Basketball", "Pickleball", "Soccer", "Tennis", "Multi-sport", "Other"];

interface OpenGymManagerProps {
  initialSessions: OpenGymSession[];
  locations: Location[];
  organizerId: string;
}

export function OpenGymManager({ initialSessions, locations, organizerId }: OpenGymManagerProps) {
  const [sessions, setSessions] = useState<OpenGymSession[]>(initialSessions);

  // Add dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [title, setTitle] = useState("");
  const [sport, setSport] = useState("");
  const [description, setDescription] = useState("");
  const [locationId, setLocationId] = useState("");
  const [selectedCourts, setSelectedCourts] = useState<string[]>([]);
  const [scheduleType, setScheduleType] = useState<"recurring" | "one-time">("recurring");
  const [dayOfWeek, setDayOfWeek] = useState("5"); // Friday
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("20:00");
  const [specificDate, setSpecificDate] = useState("");
  const [recurringStart, setRecurringStart] = useState("");
  const [recurringEnd, setRecurringEnd] = useState("");
  const [capacity, setCapacity] = useState("");
  const [feeAmount, setFeeAmount] = useState("");
  const [feeDescription, setFeeDescription] = useState("");
  const [notes, setNotes] = useState("");

  // Edit state
  const [editSession, setEditSession] = useState<OpenGymSession | null>(null);

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const locationsMap = useMemo(
    () => new Map(locations.map((l) => [l.id, l])),
    [locations]
  );

  const selectedLocation = locationId ? locationsMap.get(locationId) : null;

  function resetForm() {
    setTitle("");
    setSport("");
    setDescription("");
    setLocationId("");
    setSelectedCourts([]);
    setScheduleType("recurring");
    setDayOfWeek("5");
    setStartTime("18:00");
    setEndTime("20:00");
    setSpecificDate("");
    setRecurringStart("");
    setRecurringEnd("");
    setCapacity("");
    setFeeAmount("");
    setFeeDescription("");
    setNotes("");
  }

  function openEdit(s: OpenGymSession) {
    setEditSession(s);
    setTitle(s.title);
    setSport(s.sport || "");
    setDescription(s.description || "");
    setLocationId(s.location_id || "");
    setSelectedCourts(s.court_numbers || []);
    if (s.specific_date) {
      setScheduleType("one-time");
      setSpecificDate(s.specific_date);
    } else {
      setScheduleType("recurring");
      setDayOfWeek(s.day_of_week?.toString() || "5");
    }
    setStartTime(s.start_time.slice(0, 5)); // "18:00:00" → "18:00"
    setEndTime(s.end_time.slice(0, 5));
    setRecurringStart(s.recurring_start || "");
    setRecurringEnd(s.recurring_end || "");
    setCapacity(s.capacity?.toString() || "");
    setFeeAmount(s.fee_amount_cents ? (s.fee_amount_cents / 100).toString() : "");
    setFeeDescription(s.fee_description || "");
    setNotes(s.notes || "");
    setAddOpen(true);
  }

  function buildPayload() {
    return {
      organizer_id: organizerId,
      title: title.trim(),
      sport: sport || null,
      description: description.trim() || null,
      location_id: locationId || null,
      day_of_week: scheduleType === "recurring" ? parseInt(dayOfWeek) : null,
      start_time: startTime,
      end_time: endTime,
      specific_date: scheduleType === "one-time" ? specificDate || null : null,
      recurring_start: scheduleType === "recurring" ? recurringStart || null : null,
      recurring_end: scheduleType === "recurring" ? recurringEnd || null : null,
      capacity: capacity ? parseInt(capacity) : null,
      fee_amount_cents: feeAmount ? Math.round(parseFloat(feeAmount) * 100) : 0,
      fee_description: feeDescription.trim() || null,
      court_numbers: selectedCourts,
      notes: notes.trim() || null,
    };
  }

  async function saveSession() {
    if (!title.trim()) return;
    setSaving(true);
    const supabase = createClient();
    const payload = buildPayload();

    if (editSession) {
      // Update
      const { error } = await supabase
        .from("open_gym_sessions")
        .update(payload)
        .eq("id", editSession.id);

      if (!error) {
        setSessions(sessions.map((s) =>
          s.id === editSession.id ? { ...s, ...payload } as OpenGymSession : s
        ));
        setEditSession(null);
        setAddOpen(false);
        resetForm();
      }
    } else {
      // Insert
      const { data, error } = await supabase
        .from("open_gym_sessions")
        .insert(payload)
        .select()
        .single();

      if (!error && data) {
        setSessions([data as OpenGymSession, ...sessions]);
        setAddOpen(false);
        resetForm();
      }
    }
    setSaving(false);
  }

  async function deleteSession(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("open_gym_sessions").delete().eq("id", id);
    if (!error) {
      setSessions(sessions.filter((s) => s.id !== id));
    }
    setConfirmDelete(null);
  }

  async function toggleActive(session: OpenGymSession) {
    const supabase = createClient();
    const newActive = !session.is_active;
    const { error } = await supabase
      .from("open_gym_sessions")
      .update({ is_active: newActive })
      .eq("id", session.id);

    if (!error) {
      setSessions(sessions.map((s) =>
        s.id === session.id ? { ...s, is_active: newActive } : s
      ));
    }
  }

  function formatSchedule(s: OpenGymSession): string {
    const time = `${formatTime(s.start_time)} – ${formatTime(s.end_time)}`;
    if (s.specific_date) {
      return `${format(new Date(s.specific_date + "T12:00:00"), "EEE, MMM d, yyyy")} · ${time}`;
    }
    if (s.day_of_week !== null && s.day_of_week !== undefined) {
      let label = `Every ${DAYS[s.day_of_week]} · ${time}`;
      if (s.recurring_start && s.recurring_end) {
        label += ` · ${format(new Date(s.recurring_start + "T12:00:00"), "MMM d")} – ${format(new Date(s.recurring_end + "T12:00:00"), "MMM d")}`;
      }
      return label;
    }
    return time;
  }

  function formatTime(t: string): string {
    const [h, m] = t.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const hr = h % 12 || 12;
    return `${hr}:${m.toString().padStart(2, "0")} ${ampm}`;
  }

  function formatFee(s: OpenGymSession): string | null {
    if (!s.fee_amount_cents) return null;
    const dollars = (s.fee_amount_cents / 100).toFixed(2);
    return s.fee_description ? `$${dollars} — ${s.fee_description}` : `$${dollars}`;
  }

  /** Generate upcoming session dates for the schedule view */
  function getUpcomingDates(session: OpenGymSession, weeksAhead: number = 12): Date[] {
    const dates: Date[] = [];
    const now = new Date();

    if (session.specific_date) {
      const d = new Date(session.specific_date + "T12:00:00");
      if (!isBefore(d, now)) dates.push(d);
      return dates;
    }

    if (session.day_of_week === null || session.day_of_week === undefined) return dates;

    const start = session.recurring_start
      ? new Date(session.recurring_start + "T12:00:00")
      : now;
    const end = session.recurring_end
      ? new Date(session.recurring_end + "T12:00:00")
      : addWeeks(now, weeksAhead);

    // Find the first occurrence on or after start
    let current = new Date(Math.max(start.getTime(), now.getTime()));
    const dayDiff = (session.day_of_week - current.getDay() + 7) % 7;
    current = addDays(current, dayDiff === 0 ? 0 : dayDiff);

    while (!isAfter(current, end) && dates.length < weeksAhead) {
      dates.push(new Date(current));
      current = addDays(current, 7);
    }

    return dates;
  }

  function exportPdf() {
    const activeSessions = sessions.filter((s) => s.is_active);
    if (activeSessions.length === 0) return;
    const doc = generateOpenGymPdf({ sessions: activeSessions, locations, getUpcomingDates });
    doc.save("Open Gym Schedule.pdf");
  }

  const activeSessions = sessions.filter((s) => s.is_active);
  const inactiveSessions = sessions.filter((s) => !s.is_active);

  const SPORT_COLORS: Record<string, string> = {
    Volleyball: "bg-blue-100 text-blue-800",
    Basketball: "bg-orange-100 text-orange-800",
    Pickleball: "bg-emerald-100 text-emerald-800",
    Soccer: "bg-green-100 text-green-800",
    Tennis: "bg-yellow-100 text-yellow-800",
    "Multi-sport": "bg-gray-100 text-gray-800",
  };

  function renderCourtCheckboxes() {
    if (!selectedLocation) return null;
    const courts: string[] = [];
    for (let i = 1; i <= selectedLocation.court_count; i++) {
      courts.push(`Court ${i}`);
    }
    if (courts.length <= 1) return null;

    return (
      <div className="space-y-2">
        <Label>Courts</Label>
        <div className="flex flex-wrap gap-2">
          {courts.map((court) => (
            <label key={court} className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedCourts.includes(court)}
                onChange={() =>
                  setSelectedCourts((prev) =>
                    prev.includes(court) ? prev.filter((c) => c !== court) : [...prev, court]
                  )
                }
                className="h-4 w-4 rounded border-input"
              />
              <span className="text-sm">{court}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  function renderSessionCard(session: OpenGymSession) {
    const loc = session.location_id ? locationsMap.get(session.location_id) : null;
    const fee = formatFee(session);

    return (
      <Card key={session.id} className={!session.is_active ? "opacity-60" : undefined}>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-base">{session.title}</CardTitle>
              {session.sport && (
                <Badge
                  variant="secondary"
                  className={SPORT_COLORS[session.sport] || ""}
                >
                  {session.sport}
                </Badge>
              )}
              {!session.is_active && (
                <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
              )}
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground"
                onClick={() => toggleActive(session)}
                title={session.is_active ? "Deactivate" : "Activate"}
              >
                {session.is_active ? (
                  <ToggleRight className="h-4 w-4 text-green-600" />
                ) : (
                  <ToggleLeft className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground"
                onClick={() => openEdit(session)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmDelete(session.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Calendar className="h-3.5 w-3.5 shrink-0" />
            {formatSchedule(session)}
          </div>
          {loc && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              {loc.name}
              {session.court_numbers.length > 0 && (
                <span className="text-xs">({session.court_numbers.join(", ")})</span>
              )}
            </div>
          )}
          {session.capacity && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Users className="h-3.5 w-3.5 shrink-0" />
              {session.capacity} spots
            </div>
          )}
          {fee && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <DollarSign className="h-3.5 w-3.5 shrink-0" />
              {fee}
            </div>
          )}
          {session.description && (
            <p className="text-xs text-muted-foreground mt-1">{session.description}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Dialog
          open={addOpen}
          onOpenChange={(open) => {
            setAddOpen(open);
            if (!open) {
              setEditSession(null);
              resetForm();
            }
          }}
        >
          <DialogTrigger>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add Session
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editSession ? "Edit Session" : "Add Open Gym Session"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Title *</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Friday Open Gym"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Sport</Label>
                  <Select value={sport} onValueChange={(v) => v && setSport(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select sport" />
                    </SelectTrigger>
                    <SelectContent>
                      {SPORT_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Location</Label>
                  <Select value={locationId} onValueChange={(v) => v && setLocationId(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select location" />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {renderCourtCheckboxes()}

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Open to all skill levels..."
                  rows={2}
                />
              </div>

              {/* Schedule type toggle */}
              <div className="space-y-2">
                <Label>Schedule</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={scheduleType === "recurring" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setScheduleType("recurring")}
                  >
                    Recurring
                  </Button>
                  <Button
                    type="button"
                    variant={scheduleType === "one-time" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setScheduleType("one-time")}
                  >
                    One-time
                  </Button>
                </div>
              </div>

              {scheduleType === "recurring" ? (
                <>
                  <div className="space-y-2">
                    <Label>Day of week</Label>
                    <Select value={dayOfWeek} onValueChange={(v) => v && setDayOfWeek(v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DAYS.map((d, i) => (
                          <SelectItem key={i} value={i.toString()}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Start date</Label>
                      <Input
                        type="date"
                        value={recurringStart}
                        onChange={(e) => setRecurringStart(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>End date</Label>
                      <Input
                        type="date"
                        value={recurringEnd}
                        onChange={(e) => setRecurringEnd(e.target.value)}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={specificDate}
                    onChange={(e) => setSpecificDate(e.target.value)}
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Start time</Label>
                  <Input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>End time</Label>
                  <Input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Capacity</Label>
                  <Input
                    type="number"
                    min={1}
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value)}
                    placeholder="Unlimited"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Fee ($)</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={feeAmount}
                    onChange={(e) => setFeeAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>

              {feeAmount && parseFloat(feeAmount) > 0 && (
                <div className="space-y-2">
                  <Label>Fee description</Label>
                  <Input
                    value={feeDescription}
                    onChange={(e) => setFeeDescription(e.target.value)}
                    placeholder="Drop-in fee per session"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Bring your own ball, beginner-friendly..."
                  rows={2}
                />
              </div>

              <Button
                onClick={saveSession}
                disabled={saving || !title.trim()}
                className="w-full"
              >
                {saving ? "Saving..." : editSession ? "Save Changes" : "Create Session"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {activeSessions.length > 0 && (
          <Button variant="outline" size="sm" onClick={exportPdf}>
            <Download className="h-4 w-4 mr-1" />
            Export PDF
          </Button>
        )}
      </div>

      {/* Active sessions */}
      {sessions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-2">No open gym sessions yet.</p>
            <p className="text-sm text-muted-foreground">
              Create sessions to schedule open gym time and court rentals between seasons.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {activeSessions.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {activeSessions.map(renderSessionCard)}
            </div>
          )}

          {/* Upcoming schedule overview */}
          {activeSessions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Upcoming Schedule
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(() => {
                  // Collect all upcoming dates across sessions
                  const allDates: { date: Date; session: OpenGymSession }[] = [];
                  for (const s of activeSessions) {
                    for (const d of getUpcomingDates(s, 8)) {
                      allDates.push({ date: d, session: s });
                    }
                  }
                  allDates.sort((a, b) => a.date.getTime() - b.date.getTime());

                  if (allDates.length === 0) {
                    return <p className="text-sm text-muted-foreground">No upcoming sessions</p>;
                  }

                  // Group by week
                  const weeks = new Map<string, { date: Date; session: OpenGymSession }[]>();
                  for (const entry of allDates) {
                    const weekStart = startOfWeek(entry.date);
                    const key = format(weekStart, "yyyy-MM-dd");
                    const arr = weeks.get(key) || [];
                    arr.push(entry);
                    weeks.set(key, arr);
                  }

                  return (
                    <div className="space-y-4">
                      {[...weeks.entries()].map(([weekKey, entries]) => {
                        const weekStart = new Date(weekKey + "T12:00:00");
                        return (
                          <div key={weekKey}>
                            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                              Week of {format(weekStart, "MMM d")}
                            </h4>
                            <div className="space-y-1.5">
                              {entries.map((entry, i) => {
                                const loc = entry.session.location_id
                                  ? locationsMap.get(entry.session.location_id)
                                  : null;
                                return (
                                  <div
                                    key={`${entry.session.id}-${i}`}
                                    className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 text-sm"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-muted-foreground w-20 shrink-0">
                                        {format(entry.date, "EEE, MMM d")}
                                      </span>
                                      <span className="font-medium">{entry.session.title}</span>
                                      {entry.session.sport && (
                                        <Badge variant="outline" className="text-[10px]">
                                          {entry.session.sport}
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="text-xs text-muted-foreground text-right">
                                      <span>{formatTime(entry.session.start_time)} – {formatTime(entry.session.end_time)}</span>
                                      {loc && <span className="ml-2">{loc.name}</span>}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {/* Inactive sessions */}
          {inactiveSessions.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Inactive Sessions</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {inactiveSessions.map(renderSessionCard)}
              </div>
            </div>
          )}
        </>
      )}

      {/* Delete confirmation */}
      <Dialog
        open={!!confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Session?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete this session and any RSVPs.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => confirmDelete && deleteSession(confirmDelete)}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
