import type {
  FillParams,
  WeekFillPattern,
  WeekFillResult,
  WeekFillScheduledGame,
  WeekFillTeam,
} from "./week-fill";
import { schedulePreflight } from "./week-fill";
import { formatYMD } from "./date-utils";
import {
  type LocationCourtSlot,
} from "./location-assignment";
import {
  buildMatchupSelectionInputFromWeekFill,
  solveMatchupSelection,
  type MatchupSelectionAssignment,
} from "./solver/matchup-selection";
import {
  solveSlotAssignment,
  type SlotAssignmentGame,
  type SlotAssignmentTeamPreference,
} from "./solver/slot-assignment";
import type { PreferenceApplied } from "@/lib/types";

export interface SolveScheduleLocationOptions {
  courtSlots: LocationCourtSlot[];
  unavailByDate: Map<string, Set<string>>;
  teamDivisionIds?: Map<string, string | null>;
}

export interface SolveScheduleResult extends WeekFillResult {
  locationAssignmentDroppedCount?: number;
  locationSplitCount?: number;
}

/**
 * Two-stage ILP scheduler. Matchup selection assigns pairs to weeks (HiGHS MIP),
 * then slot assignment places each week's games to (bucket, court, location) when venue
 * court slots are provided.
 */
export async function solveSchedule(
  params: FillParams,
  locationOptions?: SolveScheduleLocationOptions
): Promise<SolveScheduleResult> {
  const { teams, pattern, opts } = params;

  const preflight = schedulePreflight(teams, pattern, {
    matchupFrequency: opts.matchupFrequency,
    gamesPerSession: opts.gamesPerSession,
    gamesPerTeam: opts.gamesPerTeam,
  });
  const targetWeeks = preflight.targetWeeks;
  const availableWeeks = preflight.availableWeeks === Number.POSITIVE_INFINITY
    ? targetWeeks
    : preflight.availableWeeks;

  const allGameDays = buildGameDaysLocal(pattern);
  const regenerateFromDate = params.regenerateFromDate;
  const gameDays = (regenerateFromDate
    ? allGameDays.filter((d) => d >= regenerateFromDate)
    : allGameDays
  ).slice(0, targetWeeks);
  const slotsPerDay = timeSlotsPerDayLocal(pattern);
  const slotsPerWeek = slotsPerDay * pattern.courtCount;

  const forbiddenWeeksByTeam = buildForbiddenWeeks(teams, gameDays);

  // ── Matchup selection: pair → week ────────────────────────────────────────
  const matchupSelectionInput = buildMatchupSelectionInputFromWeekFill(
    teams,
    pattern,
    opts,
    targetWeeks,
    slotsPerWeek,
    {
      existingMatchupCounts: params.existingMatchupCounts,
      teamWeights: params.teamWeights,
      forbiddenWeeksByTeam,
    }
  );
  const matchupSelection = await solveMatchupSelection(matchupSelectionInput);
  if (matchupSelection.status !== "Optimal") {
    throw new Error(
      `Matchup selection solver returned status=${matchupSelection.status}`
    );
  }

  // Group matchup-selection assignments by week.
  const assignmentsByWeek = new Map<number, MatchupSelectionAssignment[]>();
  for (const a of matchupSelection.assignments) {
    const arr = assignmentsByWeek.get(a.week) || [];
    arr.push(a);
    assignmentsByWeek.set(a.week, arr);
  }

  // ── Slot assignment: per-week slot/court placement ────────────────────────
  const games: WeekFillScheduledGame[] = [];
  const pairTeams = new Map<string, { teamA: string; teamB: string }>();
  for (const p of matchupSelectionInput.pairs) {
    pairTeams.set(p.key, { teamA: p.teamA, teamB: p.teamB });
  }

  const teamsById = new Map(teams.map((t) => [t.id, t]));

  const [sh, sm] = pattern.startTime.split(":").map(Number);
  let slotAssignmentObjectiveTotal = 0;
  let slotAssignmentWeeksSolved = 0;
  for (let weekIdx = 0; weekIdx < gameDays.length; weekIdx++) {
    const weekNumber = weekIdx + 1;
    const dayDate = gameDays[weekIdx];
    const weekAssignments = assignmentsByWeek.get(weekNumber) || [];
    if (weekAssignments.length === 0) continue;

    const scheduledWeekGames: SlotAssignmentGame[] = weekAssignments.map((a, idx) => {
      const teamsForPair = pairTeams.get(a.pairKey)!;
      return {
        id: `w${weekNumber}_${idx}`,
        pairKey: a.pairKey,
        teamA: teamsForPair.teamA,
        teamB: teamsForPair.teamB,
      };
    });

    const teamPreferences = buildWeekPreferences(
      teamsById,
      scheduledWeekGames,
      weekNumber
    );
    const weekCourtSlots = locationOptions?.courtSlots.length
      ? filterWeekCourtSlots(
          locationOptions.courtSlots,
          locationOptions.unavailByDate,
          dayDate
        )
      : undefined;

    const slotAssignment = await solveSlotAssignment({
      games: scheduledWeekGames,
      buckets: slotsPerDay,
      courtsPerBucket: pattern.courtCount,
      courtSlots: weekCourtSlots,
      teamPreferences,
    });
    if (slotAssignment.status !== "Optimal") {
      throw new Error(
        `Slot assignment solver returned status=${slotAssignment.status} for week ${weekNumber}`
      );
    }
    slotAssignmentObjectiveTotal += slotAssignment.objective;
    slotAssignmentWeeksSolved++;

    // Emit games at their solved (bucket, court).
    for (const slot of slotAssignment.slots) {
      const g = scheduledWeekGames.find((x) => x.id === slot.gameId);
      if (!g) continue;
      const scheduledAt = new Date(dayDate);
      scheduledAt.setHours(sh, sm, 0, 0);
      scheduledAt.setMinutes(
        scheduledAt.getMinutes() + slot.bucket * pattern.durationMinutes
      );
      const applied: PreferenceApplied = {};
      for (const hit of slot.preferenceHits) {
        const side: "home_team" | "away_team" =
          hit.teamId === g.teamA ? "home_team" : "away_team";
        const existing = applied[side] || [];
        if (!existing.includes(hit.source)) existing.push(hit.source);
        applied[side] = existing;
      }
      applyPreferredDayHit(applied, teamsById.get(g.teamA), "home_team", scheduledAt);
      applyPreferredDayHit(applied, teamsById.get(g.teamB), "away_team", scheduledAt);
      const schedulingNotes = buildSchedulingNotes(
        teamsById,
        [g.teamA, g.teamB],
        scheduledAt
      );
      games.push({
        home: g.teamA,
        away: g.teamB,
        scheduledAt,
        venue: slot.locationName ?? pattern.venue,
        locationId: slot.locationId ?? null,
        court: pattern.courtCount > 1 ? `Court ${slot.court}` : null,
        weekNumber,
        preferenceApplied:
          Object.keys(applied).length > 0 ? applied : null,
        schedulingNotes,
      });
    }
  }

  // ── BYE tracking ──────────────────────────────────────────────────────────
  const byes = computeByes(teams, games, gameDays);

  const notes: string[] = [];
  if (matchupSelection.notes.length > 0) notes.push(...matchupSelection.notes);
  notes.push(
    `Solver: Matchup selection objective ${matchupSelection.objective.toFixed(0)}`
  );
  notes.push(
    `Solver: Slot assignment objective ${slotAssignmentObjectiveTotal.toFixed(0)} across ${slotAssignmentWeeksSolved} week${slotAssignmentWeeksSolved === 1 ? "" : "s"}`
  );
  notes.push(
    `Solver: scheduled ${games.length} game${games.length === 1 ? "" : "s"} across ${targetWeeks} target week${targetWeeks === 1 ? "" : "s"}`
  );

  const locationAssignmentDroppedCount = 0;
  const locationSplitCount = countSameNightLocationSplits(games);

  return {
    games,
    byes,
    notes,
    droppedPairs: matchupSelection.droppedPairs.map((d) => ({
      teamA: d.teamA,
      teamB: d.teamB,
      reason:
        d.missed === 1
          ? "not enough weeks to fit this matchup"
          : `not enough weeks to fit ${d.missed} plays of this matchup`,
    })),
    targetWeeks,
    availableWeeks,
    locationAssignmentDroppedCount,
    locationSplitCount,
  };
}

// Maps each team's `bye_dates` (YYYY-MM-DD strings) onto 1-indexed week
// numbers in the scheduled calendar. Dates outside the schedule range are
// silently dropped — the solver only cares about forbidden weeks inside the
// window.
function buildForbiddenWeeks(
  teams: WeekFillTeam[],
  gameDays: Date[]
): Map<string, Set<number>> {
  const weekByDate = new Map<string, number>();
  for (let i = 0; i < gameDays.length; i++) {
    weekByDate.set(formatYMD(gameDays[i]), i + 1);
  }
  const result = new Map<string, Set<number>>();
  for (const t of teams) {
    const byes = t.preferences?.bye_dates;
    if (!byes || byes.length === 0) continue;
    const forbidden = new Set<number>();
    for (const d of byes) {
      const w = weekByDate.get(d);
      if (w) forbidden.add(w);
    }
    if (forbidden.size > 0) result.set(t.id, forbidden);
  }
  return result;
}

// Builds per-week preference entries for the teams playing this week.
// `week_preferences[weekNumber]` dominates `preferred_time` — only the stronger
// signal is forwarded to Phase 2 (matching greedy's exclusive-choice behavior).
function buildWeekPreferences(
  teamsById: Map<string, WeekFillTeam>,
  games: SlotAssignmentGame[],
  weekNumber: number
): SlotAssignmentTeamPreference[] {
  const result: SlotAssignmentTeamPreference[] = [];
  const seen = new Set<string>();
  for (const g of games) {
    for (const teamId of [g.teamA, g.teamB]) {
      if (seen.has(teamId)) continue;
      seen.add(teamId);
      const t = teamsById.get(teamId);
      const pref = t?.preferences;
      if (!pref) continue;
      const weekPref = pref.week_preferences?.[String(weekNumber)];
      if (weekPref === "early" || weekPref === "late") {
        result.push({ teamId, prefer: weekPref, source: "week_specific_time" });
        continue;
      }
      if (pref.preferred_time === "early" || pref.preferred_time === "late") {
        result.push({
          teamId,
          prefer: pref.preferred_time,
          source: "preferred_time",
        });
      }
    }
  }
  return result;
}

function buildSchedulingNotes(
  teamsById: Map<string, WeekFillTeam>,
  teamIds: string[],
  scheduledAt: Date
): string | null {
  const ymd = formatYMD(scheduledAt);
  const notes: string[] = [];
  for (const teamId of teamIds) {
    const team = teamsById.get(teamId);
    if (!team?.preferences?.bye_dates?.includes(ymd)) continue;
    notes.push(`${team.name} has bye on this date`);
  }
  return notes.length > 0 ? notes.join("; ") : null;
}

function applyPreferredDayHit(
  applied: PreferenceApplied,
  team: WeekFillTeam | undefined,
  side: "home_team" | "away_team",
  scheduledAt: Date
) {
  const preferredDays = team?.preferences?.preferred_days;
  if (!preferredDays?.length) return;
  const dayName = DAY_NAMES[scheduledAt.getDay()];
  if (!preferredDays.includes(dayName)) return;
  const existing = applied[side] || [];
  if (!existing.includes("preferred_day")) {
    existing.push("preferred_day");
    applied[side] = existing;
  }
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function filterWeekCourtSlots(
  courtSlots: LocationCourtSlot[],
  unavailByDate: Map<string, Set<string>>,
  dayDate: Date
): LocationCourtSlot[] {
  const unavailableLocationIds = unavailByDate.get(formatYMD(dayDate)) || new Set<string>();
  const availableSlots = courtSlots.filter(
    (slot) => !unavailableLocationIds.has(slot.locationId)
  );
  return availableSlots.length > 0 ? availableSlots : courtSlots;
}

function countSameNightLocationSplits(games: WeekFillScheduledGame[]): number {
  const locationsByTeamDate = new Map<string, Set<string>>();
  for (const game of games) {
    if (!game.locationId) continue;
    const date = formatYMD(game.scheduledAt);
    for (const teamId of [game.home, game.away]) {
      const key = `${date}:${teamId}`;
      const locations = locationsByTeamDate.get(key) || new Set<string>();
      locations.add(game.locationId);
      locationsByTeamDate.set(key, locations);
    }
  }
  let count = 0;
  for (const locations of locationsByTeamDate.values()) {
    if (locations.size > 1) count++;
  }
  return count;
}

// ── Local helpers (duplicated from week-fill.ts to avoid export churn) ──────

function buildGameDaysLocal(pattern: WeekFillPattern): Date[] {
  const [h, m] = pattern.startTime.split(":").map(Number);
  const skipSet = new Set(pattern.skipDates || []);
  const days: Date[] = [];
  const first = new Date(pattern.startsOn);
  const diff = (pattern.dayOfWeek - first.getDay() + 7) % 7;
  first.setDate(first.getDate() + diff);
  first.setHours(h, m, 0, 0);
  const hardCap = 104;
  const end = pattern.endsOn ? new Date(pattern.endsOn) : null;
  if (end) end.setHours(23, 59, 59, 999);
  const cur = new Date(first);
  let guard = 0;
  while (guard++ < hardCap) {
    if (end && cur > end) break;
    if (!skipSet.has(formatYMD(cur))) {
      days.push(new Date(cur));
    }
    cur.setDate(cur.getDate() + 7);
  }
  return days;
}

function timeSlotsPerDayLocal(pattern: WeekFillPattern): number {
  if (!pattern.endTime) return 1;
  const [sh, sm] = pattern.startTime.split(":").map(Number);
  const [eh, em] = pattern.endTime.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const available = endMin - startMin;
  if (available <= 0) return 1;
  return Math.max(
    1,
    Math.floor(available / pattern.durationMinutes) +
      (available % pattern.durationMinutes === 0 ? 0 : 1)
  );
}

function computeByes(
  teams: WeekFillTeam[],
  games: WeekFillScheduledGame[],
  gameDays: Date[]
): WeekFillResult["byes"] {
  const byes: WeekFillResult["byes"] = [];
  const playsByTeamWeek = new Map<string, Set<number>>();
  for (const g of games) {
    for (const t of [g.home, g.away]) {
      const s = playsByTeamWeek.get(t) || new Set<number>();
      s.add(g.weekNumber);
      playsByTeamWeek.set(t, s);
    }
  }
  const prevByeWeek = new Map<string, number>();
  for (let i = 0; i < gameDays.length; i++) {
    const week = i + 1;
    for (const t of teams) {
      const plays = playsByTeamWeek.get(t.id);
      if (plays && plays.has(week)) continue;
      const prev = prevByeWeek.get(t.id);
      const backToBack = prev === week - 1;
      byes.push({ teamId: t.id, date: gameDays[i], weekNumber: week, backToBack });
      prevByeWeek.set(t.id, week);
    }
  }
  return byes;
}
