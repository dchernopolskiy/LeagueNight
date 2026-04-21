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
  buildPhase1InputFromWeekFill,
  solvePhase1,
  type Phase1Assignment,
} from "./solver/phase1";
import {
  solvePhase2,
  type Phase2Game,
  type Phase2TeamPreference,
} from "./solver/phase2";
import type { PreferenceApplied } from "@/lib/types";

/**
 * Two-phase ILP scheduler. Phase 1 assigns pairs to weeks (HiGHS MIP),
 * Phase 2 assigns each week's games to (bucket, court). Multi-venue
 * distribution remains a post-pass in location-assignment.ts; this function
 * emits games with `venue: pattern.venue` (single-venue default), matching
 * the legacy greedy output shape.
 */
export async function solveSchedule(params: FillParams): Promise<WeekFillResult> {
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

  // ── Phase 1: pair → week ──────────────────────────────────────────────────
  const phase1Input = buildPhase1InputFromWeekFill(
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
  const phase1 = await solvePhase1(phase1Input);
  if (phase1.status !== "Optimal") {
    throw new Error(`Phase 1 solver returned status=${phase1.status}`);
  }

  // Group Phase 1 assignments by week.
  const assignmentsByWeek = new Map<number, Phase1Assignment[]>();
  for (const a of phase1.assignments) {
    const arr = assignmentsByWeek.get(a.week) || [];
    arr.push(a);
    assignmentsByWeek.set(a.week, arr);
  }

  // ── Phase 2: per-week slot/court assignment ───────────────────────────────
  const games: WeekFillScheduledGame[] = [];
  const pairTeams = new Map<string, { teamA: string; teamB: string }>();
  for (const p of phase1Input.pairs) {
    pairTeams.set(p.key, { teamA: p.teamA, teamB: p.teamB });
  }

  const teamsById = new Map(teams.map((t) => [t.id, t]));

  const [sh, sm] = pattern.startTime.split(":").map(Number);
  let phase2ObjectiveTotal = 0;
  let phase2WeeksSolved = 0;
  for (let weekIdx = 0; weekIdx < gameDays.length; weekIdx++) {
    const weekNumber = weekIdx + 1;
    const dayDate = gameDays[weekIdx];
    const weekAssignments = assignmentsByWeek.get(weekNumber) || [];
    if (weekAssignments.length === 0) continue;

    const phase2Games: Phase2Game[] = weekAssignments.map((a, idx) => {
      const teamsForPair = pairTeams.get(a.pairKey)!;
      return {
        id: `w${weekNumber}_${idx}`,
        pairKey: a.pairKey,
        teamA: teamsForPair.teamA,
        teamB: teamsForPair.teamB,
      };
    });

    const teamPreferences = buildWeekPreferences(teamsById, phase2Games, weekNumber);

    const phase2 = await solvePhase2({
      games: phase2Games,
      buckets: slotsPerDay,
      courtsPerBucket: pattern.courtCount,
      teamPreferences,
    });
    if (phase2.status !== "Optimal") {
      throw new Error(
        `Phase 2 solver returned status=${phase2.status} for week ${weekNumber}`
      );
    }
    phase2ObjectiveTotal += phase2.objective;
    phase2WeeksSolved++;

    // Emit games at their solved (bucket, court).
    for (const slot of phase2.slots) {
      const g = phase2Games.find((x) => x.id === slot.gameId);
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
      const schedulingNotes = buildSchedulingNotes(
        teamsById,
        [g.teamA, g.teamB],
        scheduledAt
      );
      games.push({
        home: g.teamA,
        away: g.teamB,
        scheduledAt,
        venue: pattern.venue,
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
  if (phase1.notes.length > 0) notes.push(...phase1.notes);
  notes.push(`Solver: Phase 1 objective ${phase1.objective.toFixed(0)}`);
  notes.push(
    `Solver: Phase 2 objective ${phase2ObjectiveTotal.toFixed(0)} across ${phase2WeeksSolved} week${phase2WeeksSolved === 1 ? "" : "s"}`
  );
  notes.push(
    `Solver: scheduled ${games.length} game${games.length === 1 ? "" : "s"} across ${targetWeeks} target week${targetWeeks === 1 ? "" : "s"}`
  );

  return {
    games,
    byes,
    notes,
    droppedPairs: phase1.droppedPairs.map((d) => ({
      teamA: d.teamA,
      teamB: d.teamB,
      reason:
        d.missed === 1
          ? "not enough weeks to fit this matchup"
          : `not enough weeks to fit ${d.missed} plays of this matchup`,
    })),
    targetWeeks,
    availableWeeks,
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
  games: Phase2Game[],
  weekNumber: number
): Phase2TeamPreference[] {
  const result: Phase2TeamPreference[] = [];
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
