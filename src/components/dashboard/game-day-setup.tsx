"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  ChevronUp,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type { GameDayPattern, Location, LocationUnavailability } from "@/lib/types";

// ── Constants ────────────────────────────────────────────────────────────────

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DURATION_OPTIONS = [30, 45, 60, 75, 90, 120];

// ── Holiday helpers ──────────────────────────────────────────────────────────

function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  const diff = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + diff + (n - 1) * 7);
}
function lastWeekday(year: number, month: number, weekday: number): Date {
  const last = new Date(year, month + 1, 0);
  const diff = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month, last.getDate() - diff);
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function getUSHolidays(startDate: string, endDate: string): { date: string; label: string }[] {
  const start = new Date(startDate + "T00:00:00");
  const end = endDate ? new Date(endDate + "T00:00:00") : new Date(start.getFullYear() + 1, 0, 1);
  const result: { date: string; label: string }[] = [];
  for (let year = start.getFullYear(); year <= end.getFullYear(); year++) {
    const named: [Date, string][] = [
      [new Date(year, 0, 1), "New Year's Day"],
      [nthWeekday(year, 0, 1, 3), "MLK Day"],
      [nthWeekday(year, 1, 1, 3), "Presidents' Day"],
      [lastWeekday(year, 4, 1), "Memorial Day"],
      [new Date(year, 6, 4), "Independence Day"],
      [nthWeekday(year, 8, 1, 1), "Labor Day"],
      [nthWeekday(year, 10, 4, 4), "Thanksgiving"],
      [new Date(year, 11, 25), "Christmas"],
    ];
    for (const [d, label] of named) {
      const s = ymd(d);
      if (d >= start && d <= end) result.push({ date: s, label });
    }
  }
  return result;
}

// ── Estimate helper ──────────────────────────────────────────────────────────

function estimateGamesPerTeam(
  teamCount: number,
  matchupFrequency: number,
  gamesPerSession: number
): number {
  if (teamCount < 2) return 0;
  return (teamCount - 1) * matchupFrequency * gamesPerSession;
}

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  leagueId: string;
  organizerId: string;
  patterns: GameDayPattern[];
  locations: Location[];
  locationUnavail: LocationUnavailability[];
  teamCount: number;
  canManage: boolean;
  generating: boolean;
  onPatternsChange: (patterns: GameDayPattern[]) => void;
  onLocationsChange: (locations: Location[]) => void;
  onGenerate: (
    patternId: string,
    opts: {
      gamesPerTeam: number;
      gamesPerSession: number;
      matchupFrequency: number;
      mixDivisions: boolean;
      skipDates: string[];
      regenerateFrom?: string;
      locationIds: string[];
    }
  ) => Promise<void>;
}

// ── Default form state ───────────────────────────────────────────────────────

function emptyForm() {
  return {
    days: [] as number[],
    startTime: "19:00",
    endTime: "",
    duration: "60",
    startsOn: "",
    endsOn: "",
    locationIds: [] as string[],
    gamesPerSession: "1",
    matchupFrequency: "1",
    mixDivisions: false,
    skipDates: [] as string[],
    regenerateFrom: "",
  };
}

type FormState = ReturnType<typeof emptyForm>;

// ── Main component ───────────────────────────────────────────────────────────

export function GameDaySetupPanel({
  leagueId,
  organizerId,
  patterns,
  locations,
  locationUnavail,
  teamCount,
  canManage,
  generating,
  onPatternsChange,
  onLocationsChange,
  onGenerate,
}: Props) {
  const [showForm, setShowForm] = useState(patterns.length === 0);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  // Inline "Add location" state
  const [showAddLoc, setShowAddLoc] = useState(false);
  const [newLocName, setNewLocName] = useState("");
  const [newLocCourts, setNewLocCourts] = useState("1");
  const [addingLoc, setAddingLoc] = useState(false);

  // Confirm delete group
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<string | null>(null);
  const [confirmGenerate, setConfirmGenerate] = useState<string | null>(null);

  const locationsMap = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);

  // ── Group patterns by group_id ─────────────────────────────────────────────
  // A "group" is all patterns sharing the same group_id (created together, e.g. Mon+Wed).
  // Patterns without a group_id are their own singleton group.
  const patternGroups = useMemo(() => {
    const groups = new Map<string, GameDayPattern[]>();
    for (const p of patterns) {
      const key = p.group_id || p.id;
      const arr = groups.get(key) || [];
      arr.push(p);
      groups.set(key, arr);
    }
    // Sort each group by day_of_week
    for (const [, arr] of groups) arr.sort((a, b) => a.day_of_week - b.day_of_week);
    return [...groups.entries()].sort(([, a], [, b]) => a[0].day_of_week - b[0].day_of_week);
  }, [patterns]);

  // ── Suggested holidays within current date range ───────────────────────────
  const suggestedHolidays = useMemo(() => {
    if (!form.startsOn) return [];
    const end = form.endsOn || `${new Date().getFullYear() + 1}-12-31`;
    const all = getUSHolidays(form.startsOn, end);
    return all.filter((h) => !form.skipDates.includes(h.date));
  }, [form.startsOn, form.endsOn, form.skipDates]);

  // ── Form helpers ────────────────────────────────────────────────────────────

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleDay(day: number) {
    setField("days", form.days.includes(day) ? form.days.filter((d) => d !== day) : [...form.days, day].sort());
  }

  function toggleLocation(id: string) {
    setField("locationIds", form.locationIds.includes(id)
      ? form.locationIds.filter((l) => l !== id)
      : [...form.locationIds, id]);
  }

  function addSkipDate(date: string) {
    if (date && !form.skipDates.includes(date)) {
      setField("skipDates", [...form.skipDates, date].sort());
    }
  }

  function removeSkipDate(date: string) {
    setField("skipDates", form.skipDates.filter((d) => d !== date));
  }

  function addSkipRange(rangeStart: string, rangeEnd: string) {
    if (!rangeStart || !rangeEnd) return;
    const start = new Date(rangeStart + "T00:00:00");
    const end = new Date(rangeEnd + "T00:00:00");
    const dates: string[] = [];
    const cur = new Date(start);
    while (cur <= end) {
      dates.push(ymd(cur));
      cur.setDate(cur.getDate() + 1);
    }
    const merged = Array.from(new Set([...form.skipDates, ...dates])).sort();
    setField("skipDates", merged);
  }

  function openAddForm() {
    setEditingGroupId(null);
    setForm(emptyForm());
    setShowForm(true);
  }

  function openEditGroup(groupKey: string, groupPatterns: GameDayPattern[]) {
    const first = groupPatterns[0];
    setEditingGroupId(groupKey);
    setForm({
      days: groupPatterns.map((p) => p.day_of_week),
      startTime: first.start_time.slice(0, 5),
      endTime: first.end_time ? first.end_time.slice(0, 5) : "",
      duration: (first.duration_minutes || 60).toString(),
      startsOn: first.starts_on,
      endsOn: first.ends_on || "",
      locationIds: first.location_ids || [],
      gamesPerSession: (first.games_per_session || 1).toString(),
      matchupFrequency: (first.matchup_frequency || 1).toString(),
      mixDivisions: first.mix_divisions || false,
      skipDates: first.skip_dates || [],
      regenerateFrom: "",
    });
    setShowForm(true);
  }

  // ── Inline add location ─────────────────────────────────────────────────────

  async function handleAddLocation() {
    if (!newLocName.trim()) return;
    setAddingLoc(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("locations")
      .insert({
        organizer_id: organizerId,
        name: newLocName.trim(),
        court_count: parseInt(newLocCourts) || 1,
        address: null,
        notes: null,
        tags: [],
      })
      .select()
      .single();

    if (!error && data) {
      const newLoc = data as Location;
      onLocationsChange([...locations, newLoc]);
      setField("locationIds", [...form.locationIds, newLoc.id]);
    }
    setNewLocName("");
    setNewLocCourts("1");
    setShowAddLoc(false);
    setAddingLoc(false);
  }

  // ── Save pattern(s) ─────────────────────────────────────────────────────────

  async function savePatterns(andGenerate = false) {
    if (form.days.length === 0 || !form.startsOn) return;
    setSaving(true);
    const supabase = createClient();

    // Group ID: shared across all patterns created in this save
    const groupId = editingGroupId
      ? (patterns.find((p) => p.group_id === editingGroupId || p.id === editingGroupId)?.group_id || crypto.randomUUID())
      : crypto.randomUUID();

    const courtCount = form.locationIds.reduce((sum, id) => {
      const loc = locationsMap.get(id);
      return sum + (loc?.court_count || 0);
    }, 0) || 1;

    // If editing an existing group: delete its patterns first
    if (editingGroupId) {
      const groupPatternIds = patterns
        .filter((p) => (p.group_id || p.id) === editingGroupId)
        .map((p) => p.id);
      if (groupPatternIds.length > 0) {
        await supabase.from("game_day_patterns").delete().in("id", groupPatternIds);
      }
    }

    // Create one pattern per selected day
    const inserts = form.days.map((day) => ({
      league_id: leagueId,
      day_of_week: day,
      days_of_week: form.days,
      group_id: groupId,
      start_time: form.startTime,
      end_time: form.endTime || null,
      duration_minutes: parseInt(form.duration),
      court_count: courtCount,
      venue: null,
      starts_on: form.startsOn,
      ends_on: form.endsOn || null,
      location_ids: form.locationIds,
      games_per_team: estimateGamesPerTeam(teamCount, parseInt(form.matchupFrequency), parseInt(form.gamesPerSession)),
      games_per_session: parseInt(form.gamesPerSession),
      matchup_frequency: parseInt(form.matchupFrequency),
      mix_divisions: form.mixDivisions,
      skip_dates: form.skipDates,
    }));

    const { data: newPatterns, error } = await supabase
      .from("game_day_patterns")
      .insert(inserts)
      .select();

    if (!error && newPatterns) {
      const cleaned = patterns.filter((p) => (p.group_id || p.id) !== editingGroupId);
      const updated = [...cleaned, ...(newPatterns as GameDayPattern[])];
      onPatternsChange(updated);

      if (andGenerate) {
        // Generate for each new pattern
        for (const p of newPatterns as GameDayPattern[]) {
          await onGenerate(p.id, {
            gamesPerTeam: p.games_per_team,
            gamesPerSession: p.games_per_session,
            matchupFrequency: p.matchup_frequency,
            mixDivisions: p.mix_divisions,
            skipDates: p.skip_dates,
            locationIds: p.location_ids,
          });
        }
      }
    }

    setSaving(false);
    setShowForm(false);
    setEditingGroupId(null);
    setForm(emptyForm());
  }

  // ── Delete group ─────────────────────────────────────────────────────────────

  async function deleteGroup(groupKey: string) {
    const supabase = createClient();
    const groupPatternIds = patterns
      .filter((p) => (p.group_id || p.id) === groupKey)
      .map((p) => p.id);
    if (groupPatternIds.length > 0) {
      await supabase.from("game_day_patterns").delete().in("id", groupPatternIds);
    }
    onPatternsChange(patterns.filter((p) => (p.group_id || p.id) !== groupKey));
    setConfirmDeleteGroup(null);
  }

  // ── Generate for existing pattern group ───────────────────────────────────────

  async function generateGroup(groupKey: string) {
    const groupPatterns = patterns.filter((p) => (p.group_id || p.id) === groupKey);
    const hasGames = await checkHasGames();

    if (hasGames) {
      setConfirmGenerate(groupKey);
      return;
    }

    for (const p of groupPatterns) {
      await onGenerate(p.id, {
        gamesPerTeam: p.games_per_team,
        gamesPerSession: p.games_per_session,
        matchupFrequency: p.matchup_frequency,
        mixDivisions: p.mix_divisions,
        skipDates: p.skip_dates,
        regenerateFrom: form.regenerateFrom || undefined,
        locationIds: p.location_ids,
      });
    }
  }

  async function confirmAndGenerate(groupKey: string) {
    setConfirmGenerate(null);
    const groupPatterns = patterns.filter((p) => (p.group_id || p.id) === groupKey);
    for (const p of groupPatterns) {
      await onGenerate(p.id, {
        gamesPerTeam: p.games_per_team,
        gamesPerSession: p.games_per_session,
        matchupFrequency: p.matchup_frequency,
        mixDivisions: p.mix_divisions,
        skipDates: p.skip_dates,
        regenerateFrom: form.regenerateFrom || undefined,
        locationIds: p.location_ids,
      });
    }
  }

  async function checkHasGames(): Promise<boolean> {
    const supabase = createClient();
    const { data } = await supabase
      .from("games")
      .select("id")
      .eq("league_id", leagueId)
      .eq("is_playoff", false)
      .eq("status", "scheduled")
      .limit(1);
    return (data?.length ?? 0) > 0;
  }

  // ── Render: day pills ─────────────────────────────────────────────────────────

  function DayPills() {
    return (
      <div>
        <Label className="text-sm mb-2 block">Game days <span className="text-destructive">*</span></Label>
        <div className="flex gap-1.5 flex-wrap">
          {DAY_LABELS.map((label, i) => {
            const active = form.days.includes(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => toggleDay(i)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors
                  ${active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                  }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        {form.days.length > 0 && (
          <p className="text-xs text-muted-foreground mt-1.5">
            {form.days.map((d) => DAY_FULL[d]).join(" & ")}
          </p>
        )}
      </div>
    );
  }

  // ── Render: location section ──────────────────────────────────────────────────

  function LocationSection() {
    return (
      <div className="space-y-2">
        <Label className="text-sm">Locations</Label>
        {locations.length === 0 && !showAddLoc && (
          <p className="text-xs text-muted-foreground">No locations yet. Add one below.</p>
        )}
        {locations.length > 0 && (
          <div className="space-y-1.5">
            {locations.map((loc) => {
              const checked = form.locationIds.includes(loc.id);
              return (
                <label key={loc.id} className="flex items-center gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleLocation(loc.id)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <span className={`text-sm flex-1 ${checked ? "font-medium" : "text-muted-foreground group-hover:text-foreground"}`}>
                    {loc.name}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {loc.court_count} {loc.court_count === 1 ? "court" : "courts"}
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {/* Inline add location */}
        {showAddLoc ? (
          <div className="border rounded-lg p-3 space-y-2 bg-muted/20">
            <p className="text-xs font-medium text-muted-foreground">New location</p>
            <div className="flex gap-2">
              <Input
                placeholder="Location name"
                value={newLocName}
                onChange={(e) => setNewLocName(e.target.value)}
                className="h-8 text-sm flex-1"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleAddLocation()}
              />
              <Input
                type="number"
                min={1}
                max={20}
                value={newLocCourts}
                onChange={(e) => setNewLocCourts(e.target.value)}
                className="h-8 text-sm w-20"
                placeholder="Courts"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={handleAddLocation} disabled={addingLoc || !newLocName.trim()}>
                {addingLoc ? "Adding..." : "Add location"}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setShowAddLoc(false); setNewLocName(""); setNewLocCourts("1"); }}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs text-primary hover:underline"
            onClick={() => setShowAddLoc(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Add location
          </button>
        )}

        {form.locationIds.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Total courts:{" "}
            <span className="font-medium">
              {form.locationIds.reduce((sum, id) => sum + (locationsMap.get(id)?.court_count || 0), 0)}
            </span>
          </p>
        )}
      </div>
    );
  }

  // ── Render: skip dates ────────────────────────────────────────────────────────

  function SkipDatesSection() {
    const [newSkip, setNewSkip] = useState("");
    const [rangeStart, setRangeStart] = useState("");
    const [rangeEnd, setRangeEnd] = useState("");
    const [showRange, setShowRange] = useState(false);

    // Group skip dates by month
    const byMonth = useMemo(() => {
      const map = new Map<string, string[]>();
      for (const d of form.skipDates) {
        const key = d.slice(0, 7); // "2026-04"
        const arr = map.get(key) || [];
        arr.push(d);
        map.set(key, arr);
      }
      return [...map.entries()].sort();
    }, [form.skipDates]);

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Skip dates</Label>
          {form.skipDates.length > 0 && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-destructive"
              onClick={() => setField("skipDates", [])}
            >
              Clear all
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Games won't be scheduled on these dates (holidays, bye weeks, etc.)
        </p>

        {/* Add controls */}
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={newSkip}
              onChange={(e) => setNewSkip(e.target.value)}
              className="h-7 text-xs w-36"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => { addSkipDate(newSkip); setNewSkip(""); }}
              disabled={!newSkip}
            >
              Add date
            </Button>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setShowRange(!showRange)}
          >
            Add week/range
          </Button>
        </div>

        {/* Range picker */}
        {showRange && (
          <div className="flex items-center gap-1.5 flex-wrap border rounded-lg p-2 bg-muted/20">
            <Input
              type="date"
              value={rangeStart}
              onChange={(e) => setRangeStart(e.target.value)}
              className="h-7 text-xs w-36"
              placeholder="From"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={rangeEnd}
              onChange={(e) => setRangeEnd(e.target.value)}
              className="h-7 text-xs w-36"
              placeholder="To"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => { addSkipRange(rangeStart, rangeEnd); setRangeStart(""); setRangeEnd(""); setShowRange(false); }}
              disabled={!rangeStart || !rangeEnd}
            >
              Skip range
            </Button>
          </div>
        )}

        {/* Holiday suggestions */}
        {suggestedHolidays.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">Suggested holidays in your date range:</p>
            <div className="flex flex-wrap gap-1.5">
              {suggestedHolidays.map((h) => (
                <button
                  key={h.date}
                  type="button"
                  onClick={() => addSkipDate(h.date)}
                  className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                >
                  <Plus className="h-2.5 w-2.5" />
                  {h.label} ({h.date})
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Added skip dates grouped by month */}
        {byMonth.length > 0 && (
          <div className="space-y-2">
            {byMonth.map(([month, dates]) => {
              const [yr, mo] = month.split("-");
              const label = new Date(`${month}-01`).toLocaleString("default", { month: "long", year: "numeric" });
              return (
                <div key={month}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {dates.map((d) => (
                      <Badge key={d} variant="secondary" className="gap-1 text-xs">
                        {new Date(d + "T00:00:00").toLocaleDateString("default", { month: "short", day: "numeric" })}
                        <button
                          type="button"
                          onClick={() => removeSkipDate(d)}
                          className="hover:text-destructive ml-0.5"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Render: pattern group card ────────────────────────────────────────────────

  function PatternGroupCard({ groupKey, groupPatterns }: { groupKey: string; groupPatterns: GameDayPattern[] }) {
    const [showRegenFrom, setShowRegenFrom] = useState(false);
    const [regenFrom, setRegenFrom] = useState("");
    const first = groupPatterns[0];
    const dayLabels = groupPatterns.map((p) => DAY_FULL[p.day_of_week]).join(" & ");
    const locNames = (first.location_ids || []).map((id) => locationsMap.get(id)?.name).filter(Boolean).join(", ") || first.venue || "No location";
    const timeRange = `${first.start_time.slice(0, 5)}${first.end_time ? `–${first.end_time.slice(0, 5)}` : ""}`;
    const estimated = estimateGamesPerTeam(teamCount, first.matchup_frequency, first.games_per_session);

    // Unavailability warnings
    const locIds = first.location_ids || [];
    const warnings = locationUnavail.filter(
      (u) => locIds.includes(u.location_id) && u.unavailable_date >= first.starts_on && (!first.ends_on || u.unavailable_date <= first.ends_on)
    );

    return (
      <div className="border rounded-lg p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {/* Day + time headline */}
            <p className="font-medium text-sm">
              {dayLabels} · {timeRange}
            </p>
            {/* Details row */}
            <p className="text-xs text-muted-foreground mt-0.5">
              <MapPin className="inline h-3 w-3 mr-0.5" />
              {locNames}
              {" · "}{first.duration_minutes || 60} min games
              {" · "}{first.court_count > 1 ? `${first.court_count} courts` : "1 court"}
            </p>
            <p className="text-xs text-muted-foreground">
              <Calendar className="inline h-3 w-3 mr-0.5" />
              {first.starts_on}{first.ends_on ? ` → ${first.ends_on}` : ""}
              {" · "}~{estimated} games/team
            </p>
            {first.skip_dates.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {first.skip_dates.length} skip date{first.skip_dates.length > 1 ? "s" : ""}
              </p>
            )}
          </div>

          {canManage && (
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground"
                onClick={() => openEditGroup(groupKey, groupPatterns)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmDeleteGroup(groupKey)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>

        {/* Unavailability warnings */}
        {warnings.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {warnings.slice(0, 3).map((u) => (
              <Badge key={u.id} variant="secondary" className="text-xs text-amber-600 bg-amber-50 border-amber-200">
                <AlertTriangle className="h-3 w-3 mr-0.5" />
                {u.unavailable_date} unavailable
              </Badge>
            ))}
            {warnings.length > 3 && (
              <Badge variant="secondary" className="text-xs text-amber-600">+{warnings.length - 3} more</Badge>
            )}
          </div>
        )}

        {/* Generate controls */}
        {canManage && (
          <div className="flex items-center gap-2 flex-wrap pt-1 border-t">
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={generating || teamCount < 2}
              onClick={() => generateGroup(groupKey)}
            >
              <Zap className="h-3 w-3 mr-1" />
              {generating ? "Generating…" : "Generate"}
            </Button>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              onClick={() => setShowRegenFrom(!showRegenFrom)}
            >
              <RefreshCw className="h-3 w-3" />
              Regenerate from…
            </button>
            {showRegenFrom && (
              <div className="flex items-center gap-1.5 w-full">
                <Input
                  type="date"
                  value={regenFrom}
                  onChange={(e) => setRegenFrom(e.target.value)}
                  className="h-7 text-xs w-36"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={!regenFrom || generating}
                  onClick={async () => {
                    for (const p of groupPatterns) {
                      await onGenerate(p.id, {
                        gamesPerTeam: p.games_per_team,
                        gamesPerSession: p.games_per_session,
                        matchupFrequency: p.matchup_frequency,
                        mixDivisions: p.mix_divisions,
                        skipDates: p.skip_dates,
                        regenerateFrom: regenFrom,
                        locationIds: p.location_ids,
                      });
                    }
                    setRegenFrom("");
                    setShowRegenFrom(false);
                  }}
                >
                  Apply
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Render: inline form ───────────────────────────────────────────────────────

  const formValid = form.days.length > 0 && !!form.startsOn && !!form.startTime;
  const estimatedGames = estimateGamesPerTeam(teamCount, parseInt(form.matchupFrequency) || 1, parseInt(form.gamesPerSession) || 1);

  // ── Main render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Pattern group cards */}
      {patternGroups.map(([groupKey, groupPatterns]) => (
        <PatternGroupCard key={groupKey} groupKey={groupKey} groupPatterns={groupPatterns} />
      ))}

      {/* Add / Edit form */}
      {showForm ? (
        <div className="border rounded-xl p-4 space-y-5 bg-card shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">
              {editingGroupId ? "Edit Game Day" : "New Game Day"}
            </h3>
            {patterns.length > 0 && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => { setShowForm(false); setEditingGroupId(null); }}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* 1 — Days */}
          <DayPills />

          {/* 2 — Time */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Start time <span className="text-destructive">*</span></Label>
              <Input
                type="time"
                value={form.startTime}
                onChange={(e) => setField("startTime", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">End time <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                type="time"
                value={form.endTime}
                onChange={(e) => setField("endTime", e.target.value)}
                placeholder="e.g. 21:00"
              />
              <p className="text-[10px] text-muted-foreground leading-tight">No new games start after this</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Game duration</Label>
              <Select value={form.duration} onValueChange={(v) => v && setField("duration", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_OPTIONS.map((m) => (
                    <SelectItem key={m} value={m.toString()}>{m} min</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 3 — Season dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">First game date <span className="text-destructive">*</span></Label>
              <Input
                type="date"
                value={form.startsOn}
                onChange={(e) => setField("startsOn", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Last game date <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                type="date"
                value={form.endsOn}
                onChange={(e) => setField("endsOn", e.target.value)}
              />
            </div>
          </div>

          {/* 4 — Locations */}
          <LocationSection />

          {/* 5 — Scheduling */}
          <div className="space-y-3 border rounded-lg p-3 bg-muted/20">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Scheduling</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Games per session</Label>
                <Select value={form.gamesPerSession} onValueChange={(v) => v && setField("gamesPerSession", v)}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4].map((n) => (
                      <SelectItem key={n} value={n.toString()}>{n} game{n > 1 ? "s" : ""} per night</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">How many games does each team play per game day?</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Play each opponent</Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={form.matchupFrequency}
                    onChange={(e) => setField("matchupFrequency", e.target.value)}
                    className="h-8 w-16 text-center"
                  />
                  <span className="text-xs text-muted-foreground">time{parseInt(form.matchupFrequency) !== 1 ? "s" : ""}</span>
                </div>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.mixDivisions}
                onChange={(e) => setField("mixDivisions", e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <span className="text-xs text-muted-foreground">Allow cross-division matchups</span>
            </label>
            {teamCount >= 2 && (
              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                With {teamCount} teams → each team plays ~<strong>{estimatedGames}</strong> game{estimatedGames !== 1 ? "s" : ""} per day pattern
              </p>
            )}
          </div>

          {/* 6 — Skip dates */}
          <SkipDatesSection />

          {/* 7 — Save / Generate */}
          <div className="flex gap-2 pt-1">
            <Button
              className="flex-1"
              disabled={!formValid || saving}
              onClick={() => savePatterns(true)}
            >
              <Zap className="h-4 w-4 mr-1.5" />
              {saving ? "Saving…" : editingGroupId ? "Save & Regenerate" : "Save & Generate"}
            </Button>
            <Button
              variant="outline"
              disabled={!formValid || saving}
              onClick={() => savePatterns(false)}
            >
              Save only
            </Button>
            {(patterns.length > 0 || editingGroupId) && (
              <Button
                variant="ghost"
                onClick={() => { setShowForm(false); setEditingGroupId(null); }}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      ) : (
        canManage && (
          <Button variant="outline" size="sm" onClick={openAddForm}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add Game Day
          </Button>
        )
      )}

      {/* Confirm: delete group */}
      <Dialog open={!!confirmDeleteGroup} onOpenChange={(open) => !open && setConfirmDeleteGroup(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Delete Game Day?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes the game day pattern. Previously generated games are not affected.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmDeleteGroup(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => confirmDeleteGroup && deleteGroup(confirmDeleteGroup)}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm: overwrite schedule */}
      <Dialog open={!!confirmGenerate} onOpenChange={(open) => !open && setConfirmGenerate(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Regenerate Schedule?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This replaces all currently scheduled (unplayed) games. Completed results are kept.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmGenerate(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => confirmGenerate && confirmAndGenerate(confirmGenerate)}>
              Replace Schedule
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
