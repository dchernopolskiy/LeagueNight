import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/supabase/helpers";
import { schedulePreflight } from "@/lib/scheduling/week-fill";
import { parseLocalDate } from "@/lib/scheduling/date-utils";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    leagueId,
    patternId,
    gamesPerSession = 1,
    matchupFrequency = 1,
    skipDates = [],
    locationIds = [],
  } = body;

  const supabase = createAdminClient();

  // Authorization
  const { data: league } = await supabase
    .from("leagues")
    .select("id")
    .eq("id", leagueId)
    .eq("organizer_id", profile.id)
    .single();

  if (!league) {
    const { data: staffEntry } = await supabase
      .from("league_staff")
      .select("id")
      .eq("league_id", leagueId)
      .eq("profile_id", profile.id)
      .single();
    if (!staffEntry) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }
  }

  const { data: pattern } = await supabase
    .from("game_day_patterns")
    .select("*")
    .eq("id", patternId)
    .eq("league_id", leagueId)
    .single();

  if (!pattern) {
    return NextResponse.json({ error: "Game day pattern not found" }, { status: 404 });
  }

  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, division_id, preferences")
    .eq("league_id", leagueId);

  if (!teams || teams.length < 2) {
    return NextResponse.json({ error: "Need at least 2 teams" }, { status: 400 });
  }

  const { data: divisions } = await supabase
    .from("divisions")
    .select("id, name")
    .eq("league_id", leagueId);

  const effectiveLocationIds: string[] =
    locationIds.length > 0 ? locationIds : pattern.location_ids || [];

  // Total courts across selected locations
  let totalCourts = pattern.court_count || 1;
  if (effectiveLocationIds.length > 0) {
    const { data: locs } = await supabase
      .from("locations")
      .select("id, court_count")
      .in("id", effectiveLocationIds);
    if (locs && locs.length > 0) {
      totalCourts = locs.reduce((s, l) => s + (l.court_count || 0), 0);
    }
  }

  // Merged skip dates (including full-unavailable dates) — same logic as generate route.
  const mergedSkipDates = new Set<string>(skipDates);
  if (effectiveLocationIds.length > 0) {
    const { data: unavail } = await supabase
      .from("location_unavailability")
      .select("location_id, unavailable_date")
      .in("location_id", effectiveLocationIds);
    const byDate = new Map<string, Set<string>>();
    for (const u of unavail || []) {
      const s = byDate.get(u.unavailable_date) || new Set<string>();
      s.add(u.location_id);
      byDate.set(u.unavailable_date, s);
    }
    for (const [date, locIds] of byDate) {
      if (effectiveLocationIds.every((id) => locIds.has(id))) {
        mergedSkipDates.add(date);
      }
    }
  }

  const preflight = schedulePreflight(
    teams.map((t) => ({
      id: t.id,
      name: t.name,
      division_id: t.division_id,
      preferences: t.preferences,
    })),
    {
      dayOfWeek: pattern.day_of_week,
      startTime: pattern.start_time.slice(0, 5),
      endTime: pattern.end_time ? pattern.end_time.slice(0, 5) : null,
      venue: null,
      courtCount: totalCourts,
      startsOn: parseLocalDate(pattern.starts_on),
      endsOn: pattern.ends_on ? parseLocalDate(pattern.ends_on) : null,
      durationMinutes: pattern.duration_minutes || 60,
      skipDates: Array.from(mergedSkipDates),
    },
    { matchupFrequency, gamesPerSession },
    divisions || []
  );

  return NextResponse.json(preflight);
}
