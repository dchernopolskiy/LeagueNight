import type { PreferenceApplied, Team } from "@/lib/types";
import { formatYMD } from "./date-utils";
import { generateRoundRobin } from "./round-robin";

export interface WeekFillTeam {
  id: string;
  name: string;
  division_id: string | null;
  preferences?: Team["preferences"];
}

export interface WeekFillPattern {
  dayOfWeek: number;
  startTime: string; // "HH:mm"
  endTime?: string | null; // "HH:mm"
  venue: string | null;
  courtCount: number;
  startsOn: Date;
  endsOn?: Date | null;
  durationMinutes: number;
  skipDates?: string[]; // YYYY-MM-DD
}

export interface WeekFillOptions {
  matchupFrequency: number; // desired times each pair plays
  gamesPerSession: number; // games each team plays per night
  allowCrossPlay: boolean; // true when mixDivisions is on
  crossPlayRules?: Array<{ division_a_id: string; division_b_id: string }>;
  // When true, scheduler truncates biggest-division round-robin to fit available weeks.
  // When false, scheduler errors if endsOn forces too few weeks.
  acceptTruncation?: boolean;
  // Organizer's desired games-per-team. If larger than the biggest-division
  // round-robin requires, season length extends and the extra weeks are
  // filled with crossplay (when allowed) or repeat matchups.
  gamesPerTeam?: number;
}

export interface WeekFillScheduledGame {
  home: string;
  away: string;
  scheduledAt: Date;
  venue: string | null;
  court: string | null;
  weekNumber: number;
  preferenceApplied?: PreferenceApplied | null;
  schedulingNotes?: string | null;
}

export interface WeekFillResult {
  games: WeekFillScheduledGame[];
  byes: Array<{ teamId: string; date: Date; weekNumber: number; backToBack: boolean }>;
  notes: string[];
  droppedPairs: Array<{ teamA: string; teamB: string; reason: string }>;
  targetWeeks: number;
  availableWeeks: number;
}

export interface PreflightResult {
  biggestDivisionId: string | null;
  biggestDivisionSize: number;
  biggestDivisionName: string | null;
  fullRoundRobinRounds: number; // rounds needed for biggest div
  roundsPerWeek: number;
  minWeeksNeeded: number;
  availableWeeks: number; // Infinity if no endsOn
  fits: boolean;
  droppedPairCount: number; // only meaningful when !fits
  // Shortfall per team vs. the organizer's gamesPerTeam goal. Non-zero when
  // the calendar can't accommodate the goal even if the round-robin fits.
  gamesPerTeamShortfall: number;
  targetWeeks: number;
  matchupFrequency: number;
  gamesPerTeamTarget: number; // desired games-per-team after sizing
}

function buildGameDays(pattern: WeekFillPattern): Date[] {
  const [h, m] = pattern.startTime.split(":").map(Number);
  const skipSet = new Set(pattern.skipDates || []);
  const days: Date[] = [];

  // Advance startsOn to the first occurrence of dayOfWeek on or after startsOn.
  const first = new Date(pattern.startsOn);
  const diff = (pattern.dayOfWeek - first.getDay() + 7) % 7;
  first.setDate(first.getDate() + diff);
  first.setHours(h, m, 0, 0);

  // Without endsOn we can't bound the calendar; cap at 104 weeks (2 years).
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

function timeSlotsPerDay(pattern: WeekFillPattern): number {
  if (!pattern.endTime) return 1;
  const [sh, sm] = pattern.startTime.split(":").map(Number);
  const [eh, em] = pattern.endTime.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const available = endMin - startMin;
  if (available <= 0) return 1;
  return Math.max(1, Math.floor(available / pattern.durationMinutes) + (available % pattern.durationMinutes === 0 ? 0 : 1));
  // Note: a slot is valid if it STARTS before endMin; end-of-game can slightly
  // overrun endMin. Matches existing assignDatesWithPreferences behavior
  // (which uses `slotStartMinutes >= endMinutesFromMidnight` to break).
}

function teamsByDivision(teams: WeekFillTeam[]): Map<string, WeekFillTeam[]> {
  const map = new Map<string, WeekFillTeam[]>();
  for (const t of teams) {
    const key = t.division_id ?? "__none__";
    const arr = map.get(key) || [];
    arr.push(t);
    map.set(key, arr);
  }
  return map;
}

/**
 * Preflight: compute target weeks and whether the biggest division fits the
 * calendar. Does not generate games — pure math.
 */
export function schedulePreflight(
  teams: WeekFillTeam[],
  pattern: WeekFillPattern,
  opts: Pick<WeekFillOptions, "matchupFrequency" | "gamesPerSession"> & { gamesPerTeam?: number },
  divisionsMeta?: Array<{ id: string; name: string }>
): PreflightResult {
  const divMap = teamsByDivision(teams);
  let biggestId: string | null = null;
  let biggestSize = 0;
  for (const [divId, divTeams] of divMap) {
    if (divTeams.length > biggestSize) {
      biggestSize = divTeams.length;
      biggestId = divId;
    }
  }

  // Rounds needed = (n-1) * freq for even n; n * freq for odd n (includes BYE round).
  const baseRounds = biggestSize % 2 === 0 ? biggestSize - 1 : biggestSize;
  const fullRounds = baseRounds * opts.matchupFrequency;
  const roundRobinWeeks = Math.max(0, Math.ceil(fullRounds / Math.max(1, opts.gamesPerSession)));

  // Target weeks honors both (a) biggest-division round-robin and (b) the
  // organizer's games_per_team goal. Whichever needs more weeks wins.
  const gamesPerTeamGoal = opts.gamesPerTeam ?? 0;
  const weeksForGoal = gamesPerTeamGoal > 0
    ? Math.ceil(gamesPerTeamGoal / Math.max(1, opts.gamesPerSession))
    : 0;
  const minWeeks = Math.max(roundRobinWeeks, weeksForGoal);

  const gameDays = buildGameDays(pattern);
  const available = pattern.endsOn ? gameDays.length : Number.POSITIVE_INFINITY;

  const fits = available >= minWeeks;
  const targetWeeks = Math.min(minWeeks, available === Number.POSITIVE_INFINITY ? minWeeks : available);

  // Shortfall breakdown:
  //  - pairings dropped when the biggest-division round-robin doesn't fit
  //  - games-per-team shortfall when the calendar is shorter than the
  //    games_per_team goal (even if the round-robin would fit)
  const pairsPerRound = Math.floor(biggestSize / 2);
  const availableWeeksFinite = available === Number.POSITIVE_INFINITY ? minWeeks : available;
  const missingRoundRobinRounds = Math.max(
    0,
    roundRobinWeeks * opts.gamesPerSession - availableWeeksFinite * opts.gamesPerSession
  );
  const droppedPairs = missingRoundRobinRounds * pairsPerRound;
  const gamesPerTeamShortfall = Math.max(0, gamesPerTeamGoal - availableWeeksFinite * opts.gamesPerSession);

  const biggestName = biggestId && biggestId !== "__none__"
    ? divisionsMeta?.find((d) => d.id === biggestId)?.name ?? null
    : null;

  return {
    biggestDivisionId: biggestId === "__none__" ? null : biggestId,
    biggestDivisionSize: biggestSize,
    biggestDivisionName: biggestName,
    fullRoundRobinRounds: fullRounds,
    roundsPerWeek: opts.gamesPerSession,
    minWeeksNeeded: minWeeks,
    availableWeeks: available,
    fits,
    droppedPairCount: droppedPairs,
    gamesPerTeamShortfall,
    targetWeeks,
    matchupFrequency: opts.matchupFrequency,
    gamesPerTeamTarget: targetWeeks * opts.gamesPerSession,
  };
}

// ── Core fill algorithm ─────────────────────────────────────────────────────

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

interface PairInfo {
  teamA: string;
  teamB: string;
  targetCount: number; // desired total plays across season
  playedCount: number; // how many times played so far
  crossDiv: boolean;
  exhausted: boolean; // played == target
}

interface TeamState {
  id: string;
  divisionId: string | null;
  gamesPlayed: number; // season total
  lastPlayedWeek: number; // 0 = never
  consecutiveByes: number;
  totalByes: number;
  lastByeWeek: number; // 0 = never
}

export interface FillParams {
  teams: WeekFillTeam[];
  pattern: WeekFillPattern;
  opts: WeekFillOptions;
  teamsMap: Map<string, Pick<Team, "id" | "name" | "preferences">>;
  regenerateFromDate?: Date | null;
  existingMatchupCounts?: Map<string, number>;
  // Re-seed mode: team weight in [0,1]. When provided, scoring adds a
  // skill-alignment bonus (closer weights = higher score).
  teamWeights?: Map<string, number>;
}

/**
 * Fill the schedule week-by-week, choosing matchups that balance games-per-team,
 * prefer within-division pairs, avoid back-to-back BYEs, and spread repeat pairings.
 */
export function fillScheduleByWeek(params: FillParams): WeekFillResult {
  const { teams, pattern, opts, teamsMap, regenerateFromDate, existingMatchupCounts, teamWeights } = params;

  const divMap = teamsByDivision(teams);
  const divisions = Array.from(divMap.keys());

  // Preflight: figure out target weeks.
  const preflight = schedulePreflight(teams, pattern, {
    matchupFrequency: opts.matchupFrequency,
    gamesPerSession: opts.gamesPerSession,
    gamesPerTeam: opts.gamesPerTeam,
  });

  const allGameDays = buildGameDays(pattern);
  // Filter to only game days on/after regenerateFromDate when regenerating.
  const gameDays = regenerateFromDate
    ? allGameDays.filter((d) => d >= regenerateFromDate)
    : allGameDays;

  const targetWeeks = preflight.targetWeeks;

  // ── Build the pairing pool ────────────────────────────────────────────────

  const pairs = new Map<string, PairInfo>();

  function addPair(a: string, b: string, target: number, crossDiv: boolean) {
    const key = pairKey(a, b);
    const existing = pairs.get(key);
    if (existing) {
      existing.targetCount += target;
      return;
    }
    const priorPlayed = existingMatchupCounts?.get(key) ?? 0;
    pairs.set(key, {
      teamA: a < b ? a : b,
      teamB: a < b ? b : a,
      targetCount: target,
      playedCount: priorPlayed,
      crossDiv,
      exhausted: priorPlayed >= target,
    });
  }

  // Within-division pairs: required.
  for (const divTeams of divMap.values()) {
    for (let i = 0; i < divTeams.length; i++) {
      for (let j = i + 1; j < divTeams.length; j++) {
        addPair(divTeams[i].id, divTeams[j].id, opts.matchupFrequency, false);
      }
    }
  }

  // Cross-division pairs: filler. Only enumerated when allowed, used only if a
  // team needs games and within-div pool can't supply them.
  if (opts.allowCrossPlay) {
    const canCross = (a: string | null, b: string | null) => {
      if (!a || !b) return true;
      if (a === b) return true;
      if (!opts.crossPlayRules || opts.crossPlayRules.length === 0) return true;
      const [lo, hi] = a < b ? [a, b] : [b, a];
      return opts.crossPlayRules.some(
        (r) => r.division_a_id === lo && r.division_b_id === hi
      );
    };

    for (let i = 0; i < divisions.length; i++) {
      for (let j = i + 1; j < divisions.length; j++) {
        const dA = divisions[i];
        const dB = divisions[j];
        const divA = dA === "__none__" ? null : dA;
        const divB = dB === "__none__" ? null : dB;
        if (!canCross(divA, divB)) continue;
        const teamsA = divMap.get(dA) || [];
        const teamsB = divMap.get(dB) || [];
        for (const tA of teamsA) {
          for (const tB of teamsB) {
            // Target 0 means "available as filler but no required count".
            addPair(tA.id, tB.id, 0, true);
          }
        }
      }
    }
  }

  // ── Per-team state ────────────────────────────────────────────────────────

  const teamState = new Map<string, TeamState>();
  for (const t of teams) {
    teamState.set(t.id, {
      id: t.id,
      divisionId: t.division_id,
      gamesPlayed: 0,
      lastPlayedWeek: 0,
      consecutiveByes: 0,
      totalByes: 0,
      lastByeWeek: 0,
    });
  }

  // Target games per team: biggest division's full schedule = targetWeeks × gamesPerSession.
  // Smaller divs try to reach the same.
  const targetGamesPerTeam = targetWeeks * opts.gamesPerSession;

  // ── Slot structure ────────────────────────────────────────────────────────

  const slotsPerDay = timeSlotsPerDay(pattern);
  const courtCount = pattern.courtCount;
  const [sh, sm] = pattern.startTime.split(":").map(Number);

  function slotTime(dayDate: Date, slotIdx: number): Date {
    const t = new Date(dayDate);
    const timeOffset = Math.floor(slotIdx / courtCount) * pattern.durationMinutes;
    t.setHours(sh, sm, 0, 0);
    t.setMinutes(t.getMinutes() + timeOffset);
    return t;
  }

  function slotBucket(slotIdx: number): number {
    return Math.floor(slotIdx / courtCount);
  }

  // ── Scoring ───────────────────────────────────────────────────────────────

  const REPEAT_PENALTY = 50;
  const CROSS_DIV_PENALTY = 40;
  const BALANCE_BONUS = 10; // per game below target
  const WITHIN_DIV_NEEDED_BONUS = 30;
  const BYE_PREF_PENALTY = 1000;
  const CAME_OFF_BYE_BONUS = 80; // strong incentive: don't leave a team BYE'd two weeks running
  // Playing a team's two games in adjacent buckets (no 45-min gap) is a strong
  // nice-to-have. Stronger than CROSS_DIV_PENALTY so adjacency can pull a
  // cross-div filler in when within-div has nothing adjacent.
  const ADJACENT_BUCKET_BONUS = 60;
  const GAP_BUCKET_PENALTY = 25; // per bucket of gap between a team's games
  // Re-seed mode: prioritize 0.65 no-repeat vs 0.35 skill-alignment per design.
  // REPEAT_PENALTY is 50 → skill bonus max should be ~27 to hit 0.65/0.35 ratio
  // against a single prior play. Use 27 as the max for (1 - |wA - wB|).
  const SKILL_ALIGN_BONUS = 27;

  function scorePair(
    pair: PairInfo,
    week: number,
    slotTimeDate: Date,
    isEarly: boolean,
    isLate: boolean,
    currentBucket: number,
    lastBucketByTeam: Map<string, number>
  ): { score: number; applied: PreferenceApplied; notes: string[] } | null {
    const stateA = teamState.get(pair.teamA)!;
    const stateB = teamState.get(pair.teamB)!;
    const applied: PreferenceApplied = {};
    const notes: string[] = [];

    let score = 0;

    // Repeat penalty scales with prior plays.
    score -= REPEAT_PENALTY * pair.playedCount;

    // Adjacency within the same night: reward placing a team's second game in
    // the bucket right after its first. Penalize a gap.
    for (const tid of [pair.teamA, pair.teamB]) {
      const last = lastBucketByTeam.get(tid);
      if (last === undefined) continue;
      const gap = currentBucket - last;
      if (gap === 1) {
        score += ADJACENT_BUCKET_BONUS;
      } else if (gap > 1) {
        score -= GAP_BUCKET_PENALTY * (gap - 1);
      }
    }

    // Within-div + not yet at target = strong preference.
    if (!pair.crossDiv && pair.playedCount < pair.targetCount) {
      score += WITHIN_DIV_NEEDED_BONUS;
    }

    // Crossplay used only as filler: penalize when within-div still has work.
    if (pair.crossDiv) {
      score -= CROSS_DIV_PENALTY;
    }

    // Skill alignment (re-seed mode only): closer weights = better pairing.
    if (teamWeights) {
      const wA = teamWeights.get(pair.teamA);
      const wB = teamWeights.get(pair.teamB);
      if (wA !== undefined && wB !== undefined) {
        const alignment = 1 - Math.abs(wA - wB); // 0..1
        score += SKILL_ALIGN_BONUS * alignment;
      }
    }

    // Balance: prefer pairs where both teams are behind on games.
    const behindA = Math.max(0, targetGamesPerTeam - stateA.gamesPlayed);
    const behindB = Math.max(0, targetGamesPerTeam - stateB.gamesPlayed);
    score += BALANCE_BONUS * Math.min(behindA, behindB);

    // No back-to-back BYEs: strongly prefer pairing a team that BYE'd last week.
    if (stateA.lastByeWeek === week - 1 && stateA.lastByeWeek > 0) {
      score += CAME_OFF_BYE_BONUS;
    }
    if (stateB.lastByeWeek === week - 1 && stateB.lastByeWeek > 0) {
      score += CAME_OFF_BYE_BONUS;
    }
    // Also bias toward the team with the highest total-BYE count so BYEs rotate.
    score += (stateA.totalByes + stateB.totalByes) * 2;

    // Preferences (bye_dates, preferred_time, week_preferences).
    const teamA = teamsMap.get(pair.teamA);
    const teamB = teamsMap.get(pair.teamB);
    const slotYMD = formatYMD(slotTimeDate);

    for (const [team, side] of [
      [teamA, "home_team"] as const,
      [teamB, "away_team"] as const,
    ]) {
      if (!team?.preferences) continue;
      const pref = team.preferences;
      if (pref.bye_dates?.includes(slotYMD)) {
        score -= BYE_PREF_PENALTY;
        notes.push(`${team.name} has bye on this date`);
        continue;
      }
      const weekPref = pref.week_preferences?.[week];
      if (weekPref) {
        if ((weekPref === "early" && isEarly) || (weekPref === "late" && isLate)) {
          applied[side] = applied[side] || [];
          applied[side]!.push("week_specific_time");
          score += 15;
        } else {
          score -= 10;
        }
        continue;
      }
      if (pref.preferred_time === "early") {
        if (isEarly) {
          applied[side] = applied[side] || [];
          applied[side]!.push("preferred_time");
          score += 8;
        } else {
          score -= 3;
        }
      } else if (pref.preferred_time === "late") {
        if (isLate) {
          applied[side] = applied[side] || [];
          applied[side]!.push("preferred_time");
          score += 8;
        } else {
          score -= 3;
        }
      }
    }

    return { score, applied, notes };
  }

  // ── Seed: every division's round-robin is fixed upfront ──────────────────
  //
  // Greedy per-slot scoring can't guarantee a perfect within-division round
  // robin when slots are tight. The circle method does. So for *each* division
  // we pre-assign every pair to a specific week, spread evenly across the
  // season. The greedy loop then fills remaining slots around these seeds
  // (crossplay, repeats, or leftover partial sessions).
  //
  // When a division is smaller than the biggest, its round-robin has fewer
  // rounds than `targetWeeks`. Spreading those rounds across the full window
  // (instead of packing them into early weeks) is what prevents the A/B-div
  // "empty middle/late season" bug where small divisions exhaust within-div
  // pairs by week 3 and have nothing to play in weeks 4-7.
  //
  // We skip seeding when existingMatchupCounts already has prior plays, to
  // avoid double-counting; in that case fall back to pure greedy.

  // weekNumber -> list of seeded matchups [teamA, teamB]
  const seededByWeek = new Map<number, Array<{ a: string; b: string }>>();
  const shouldSeed =
    existingMatchupCounts === undefined || existingMatchupCounts.size === 0;

  if (shouldSeed && targetWeeks > 0) {
    for (const [divId, divTeams] of divMap) {
      // Skip the "no division" bucket only when other divisions exist —
      // otherwise divisionless teams have no round-robin at all. When every
      // team is divisionless, treat them as one pooled division.
      if (divId === "__none__" && divMap.size > 1) continue;
      if (divTeams.length < 2) continue;

      const teamIds = divTeams.map((t) => t.id);
      const matchups = generateRoundRobin(teamIds, opts.matchupFrequency);
      // Pack `gamesPerSession` rounds into one "week-bundle" (each bundle is
      // what a single game day covers). Bundles then spread across the season.
      const bundles = new Map<number, Array<{ a: string; b: string }>>();
      for (const m of matchups) {
        const bundle = Math.ceil(m.round / Math.max(1, opts.gamesPerSession));
        const arr = bundles.get(bundle) || [];
        arr.push({ a: m.home, b: m.away });
        bundles.set(bundle, arr);
      }

      const bundleList = [...bundles.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
      const bundleCount = bundleList.length;
      if (bundleCount === 0) continue;

      // Spread bundles across targetWeeks. Even distribution: bundle i → week
      // round((i + 0.5) * targetWeeks / bundleCount). Two divisions with
      // different sizes get their within-div games spread across the same
      // window instead of all clustering at the start.
      for (let i = 0; i < bundleCount; i++) {
        const week = Math.min(
          targetWeeks,
          Math.max(1, Math.round(((i + 0.5) * targetWeeks) / bundleCount))
        );
        const arr = seededByWeek.get(week) || [];
        arr.push(...bundleList[i]);
        seededByWeek.set(week, arr);
      }
    }
  }


  // ── Week-by-week fill ─────────────────────────────────────────────────────

  const resultGames: WeekFillScheduledGame[] = [];
  const byeRecords: WeekFillResult["byes"] = [];
  const weekNotes: string[] = [];

  const weeksToFill = Math.min(targetWeeks, gameDays.length);

  for (let wIdx = 0; wIdx < weeksToFill; wIdx++) {
    const dayDate = gameDays[wIdx];
    const weekNumber = wIdx + 1;

    // Per-week tracking
    const gamesThisWeek = new Map<string, number>(); // teamId -> count this week
    const slotTeams = new Map<number, Set<string>>(); // slotBucket -> teams playing in that time bucket
    const usedSlots = new Set<number>(); // slot indices used (court + time combined)
    const lastBucketByTeam = new Map<string, number>(); // teamId -> most recent bucket played this week
    for (const t of teams) gamesThisWeek.set(t.id, 0);

    const totalSlots = slotsPerDay * courtCount;
    const midBucket = Math.floor(slotsPerDay / 2);

    // Build candidate pool for this week: pairs whose teams both still need games.
    function isTeamEligible(teamId: string): boolean {
      const st = teamState.get(teamId)!;
      if ((gamesThisWeek.get(teamId) || 0) >= opts.gamesPerSession) return false;
      if (st.gamesPlayed >= targetGamesPerTeam) return false;
      return true;
    }

    // Seed phase: place pre-assigned within-division matchups for this week
    // into the best available slots using the same preference scoring as the
    // greedy fill (respecting bucket constraints).
    const seededPairs = seededByWeek.get(weekNumber) || [];
    for (const seed of seededPairs) {
      let bestSlotIdx: number | null = null;
      let bestScore = Number.NEGATIVE_INFINITY;
      let bestMeta: { applied: PreferenceApplied; notes: string[] } | null = null;
      const key = pairKey(seed.a, seed.b);
      const pair = pairs.get(key);
      if (!pair) continue;

      for (let slotIdx = 0; slotIdx < totalSlots; slotIdx++) {
        if (usedSlots.has(slotIdx)) continue;
        const bucket = slotBucket(slotIdx);
        const teamsInBucket = slotTeams.get(bucket) || new Set<string>();
        if (teamsInBucket.has(seed.a) || teamsInBucket.has(seed.b)) continue;
        if ((gamesThisWeek.get(seed.a) || 0) >= opts.gamesPerSession) continue;
        if ((gamesThisWeek.get(seed.b) || 0) >= opts.gamesPerSession) continue;
        const slotDate = slotTime(dayDate, slotIdx);
        const isEarly = bucket < midBucket || slotsPerDay === 1;
        const isLate = bucket >= midBucket;
        const scored = scorePair(
          pair,
          weekNumber,
          slotDate,
          isEarly,
          isLate,
          bucket,
          lastBucketByTeam
        );
        if (!scored) continue;
        if (scored.score > bestScore) {
          bestScore = scored.score;
          bestSlotIdx = slotIdx;
          bestMeta = { applied: scored.applied, notes: scored.notes };
        }
      }

      if (bestSlotIdx === null || !bestMeta) continue;

      const bucket = slotBucket(bestSlotIdx);
      const teamsInBucket = slotTeams.get(bucket) || new Set<string>();
      const slotDate = slotTime(dayDate, bestSlotIdx);
      const courtNum = (bestSlotIdx % courtCount) + 1;

      resultGames.push({
        home: seed.a,
        away: seed.b,
        scheduledAt: slotDate,
        venue: pattern.venue,
        court: courtCount > 1 ? `Court ${courtNum}` : null,
        weekNumber,
        preferenceApplied: Object.keys(bestMeta.applied).length > 0 ? bestMeta.applied : null,
        schedulingNotes: bestMeta.notes.length > 0 ? bestMeta.notes.join("; ") : null,
      });

      pair.playedCount += 1;
      pair.exhausted = pair.playedCount >= pair.targetCount;
      teamState.get(seed.a)!.gamesPlayed += 1;
      teamState.get(seed.b)!.gamesPlayed += 1;
      teamState.get(seed.a)!.lastPlayedWeek = weekNumber;
      teamState.get(seed.b)!.lastPlayedWeek = weekNumber;
      gamesThisWeek.set(seed.a, (gamesThisWeek.get(seed.a) || 0) + 1);
      gamesThisWeek.set(seed.b, (gamesThisWeek.get(seed.b) || 0) + 1);
      teamsInBucket.add(seed.a);
      teamsInBucket.add(seed.b);
      slotTeams.set(bucket, teamsInBucket);
      usedSlots.add(bestSlotIdx);
      lastBucketByTeam.set(seed.a, bucket);
      lastBucketByTeam.set(seed.b, bucket);
    }

    // Iterate slots in time order (bucket by bucket, court by court within bucket).
    for (let slotIdx = 0; slotIdx < totalSlots; slotIdx++) {
      if (usedSlots.has(slotIdx)) continue;
      const bucket = slotBucket(slotIdx);
      const teamsInBucket = slotTeams.get(bucket) || new Set<string>();
      const isEarly = bucket < midBucket || slotsPerDay === 1;
      const isLate = bucket >= midBucket;
      const slotDate = slotTime(dayDate, slotIdx);

      // Rank all eligible pairs for this slot.
      let bestKey: string | null = null;
      let bestScore = Number.NEGATIVE_INFINITY;
      let bestMeta: { applied: PreferenceApplied; notes: string[] } | null = null;
      for (const [key, pair] of pairs) {
        if (!isTeamEligible(pair.teamA) || !isTeamEligible(pair.teamB)) continue;
        if (teamsInBucket.has(pair.teamA) || teamsInBucket.has(pair.teamB)) continue;

        // Within-division pairs are seeded in advance (circle method). Greedy
        // only picks a within-div pair as a *repeat* (playedCount > 0), and
        // only when the team needs more games than its division's round-robin
        // provides (gamesPerTeam > round-robin total). Even then, repeats are
        // heavily penalized in scorePair so crossplay wins when available.
        if (!pair.crossDiv && pair.playedCount === 0) continue;

        const scored = scorePair(pair, weekNumber, slotDate, isEarly, isLate, bucket, lastBucketByTeam);
        if (!scored) continue;
        if (scored.score > bestScore) {
          bestScore = scored.score;
          bestKey = key;
          bestMeta = { applied: scored.applied, notes: scored.notes };
        }
      }

      if (!bestKey || !bestMeta) continue;

      const pair = pairs.get(bestKey)!;
      const courtNum = (slotIdx % courtCount) + 1;
      resultGames.push({
        home: pair.teamA, // home/away arbitrary; can alternate later
        away: pair.teamB,
        scheduledAt: slotDate,
        venue: pattern.venue,
        court: courtCount > 1 ? `Court ${courtNum}` : null,
        weekNumber,
        preferenceApplied: Object.keys(bestMeta.applied).length > 0 ? bestMeta.applied : null,
        schedulingNotes: bestMeta.notes.length > 0 ? bestMeta.notes.join("; ") : null,
      });

      // Update state
      pair.playedCount += 1;
      pair.exhausted = pair.playedCount >= pair.targetCount;
      teamState.get(pair.teamA)!.gamesPlayed += 1;
      teamState.get(pair.teamB)!.gamesPlayed += 1;
      teamState.get(pair.teamA)!.lastPlayedWeek = weekNumber;
      teamState.get(pair.teamB)!.lastPlayedWeek = weekNumber;
      gamesThisWeek.set(pair.teamA, (gamesThisWeek.get(pair.teamA) || 0) + 1);
      gamesThisWeek.set(pair.teamB, (gamesThisWeek.get(pair.teamB) || 0) + 1);
      teamsInBucket.add(pair.teamA);
      teamsInBucket.add(pair.teamB);
      slotTeams.set(bucket, teamsInBucket);
      usedSlots.add(slotIdx);
      lastBucketByTeam.set(pair.teamA, bucket);
      lastBucketByTeam.set(pair.teamB, bucket);
    }

    // Record BYEs: teams that played fewer than gamesPerSession this week.
    // Distinguish back-to-back (consecutive) BYEs.
    for (const t of teams) {
      const played = gamesThisWeek.get(t.id) || 0;
      const st = teamState.get(t.id)!;
      if (played < opts.gamesPerSession) {
        const backToBack = st.lastByeWeek === weekNumber - 1 && weekNumber > 1;
        byeRecords.push({ teamId: t.id, date: dayDate, weekNumber, backToBack });
        if (backToBack) {
          st.consecutiveByes += 1;
          weekNotes.push(`Week ${weekNumber}: ${teamsMap.get(t.id)?.name || t.id} has back-to-back BYE`);
        } else {
          st.consecutiveByes = 1;
        }
        st.totalByes += 1;
        st.lastByeWeek = weekNumber;
      }
    }
  }


  // ── BYE repair pass ───────────────────────────────────────────────────────
  //
  // Greedy fill can leave a team with back-to-back BYEs. We try to break each
  // streak by swapping an existing game's participant for the BYE'd team when
  // the result is a legal pair. This may introduce a cross-div repeat for the
  // displaced team, but user-stated preference is "drop a cross-div pairing to
  // avoid back-to-back BYEs." No new games are created; only swaps.

  const byesByTeamWeek = new Map<string, Set<number>>();
  for (const b of byeRecords) {
    const s = byesByTeamWeek.get(b.teamId) || new Set<number>();
    s.add(b.weekNumber);
    byesByTeamWeek.set(b.teamId, s);
  }

  function hasByeInWeek(teamId: string, week: number): boolean {
    return byesByTeamWeek.get(teamId)?.has(week) || false;
  }

  const repairLog: string[] = [];

  // Collect back-to-back BYE cases (team, weekNumber). Repair week-by-week so
  // earlier fixes can unblock later ones.
  const backToBackCases: Array<{ teamId: string; week: number }> = [];
  for (const b of byeRecords) {
    if (b.backToBack) backToBackCases.push({ teamId: b.teamId, week: b.weekNumber });
  }
  backToBackCases.sort((a, b) => a.week - b.week);

  for (const bb of backToBackCases) {
    const { teamId: T, week: W } = bb;
    // Still BYE'd? (earlier repair may have already placed T)
    if (!hasByeInWeek(T, W)) continue;

    // Candidate games in week W we could swap into.
    const weekGames = resultGames
      .map((g, idx) => ({ g, idx }))
      .filter(({ g }) => g.weekNumber === W);

    let swapped = false;
    for (const { g, idx } of weekGames) {
      // Can't insert T if T already plays this exact time bucket.
      const bucket = g.scheduledAt.getTime();
      const tAlreadyInBucket = resultGames.some(
        (other) =>
          other.weekNumber === W &&
          other.scheduledAt.getTime() === bucket &&
          (other.home === T || other.away === T)
      );
      if (tAlreadyInBucket) continue;

      // Try replacing home then away with T.
      for (const replaceSide of ["home", "away"] as const) {
        const keepSide = replaceSide === "home" ? "away" : "home";
        const displaced = g[replaceSide];
        const partner = g[keepSide];
        if (displaced === T || partner === T) continue;

        // (T, partner) must be a legal pair.
        const key = pairKey(T, partner);
        if (!pairs.has(key)) continue;

        // Displacing would give the displaced team one fewer game — only OK
        // when that doesn't create a new back-to-back BYE for them.
        const displacedGamesInWeekW = resultGames.filter(
          (o, oIdx) =>
            oIdx !== idx &&
            o.weekNumber === W &&
            (o.home === displaced || o.away === displaced)
        ).length;
        // After swap, displaced plays `displacedGamesInWeekW` in week W. If 0,
        // the displaced team gets a new BYE — check week W-1 and W+1.
        if (displacedGamesInWeekW === 0) {
          const adjByeBefore = hasByeInWeek(displaced, W - 1);
          const adjByeAfter = hasByeInWeek(displaced, W + 1);
          if (adjByeBefore || adjByeAfter) continue;
        }

        // Perform swap.
        resultGames[idx] = {
          ...g,
          [replaceSide]: T,
        } as WeekFillScheduledGame;

        // Update BYE records.
        const tBye = byesByTeamWeek.get(T);
        tBye?.delete(W);
        if (displacedGamesInWeekW === 0) {
          const dSet = byesByTeamWeek.get(displaced) || new Set<number>();
          dSet.add(W);
          byesByTeamWeek.set(displaced, dSet);
        }

        // Update pair playedCount: old pair loses one, new pair gains one.
        const oldPair = pairs.get(pairKey(g.home, g.away));
        if (oldPair) {
          oldPair.playedCount = Math.max(0, oldPair.playedCount - 1);
          oldPair.exhausted = oldPair.playedCount >= oldPair.targetCount;
        }
        const newPair = pairs.get(key);
        if (newPair) {
          newPair.playedCount += 1;
          newPair.exhausted = newPair.playedCount >= newPair.targetCount;
        }

        repairLog.push(
          `Week ${W}: swapped ${teamsMap.get(displaced)?.name || displaced} → ${teamsMap.get(T)?.name || T} to avoid back-to-back BYE`
        );
        swapped = true;
        break;
      }
      if (swapped) break;
    }
  }

  // Rebuild byeRecords from the updated games so downstream consumers see the
  // repaired state (with `backToBack` flags recomputed).
  const repairedByes: WeekFillResult["byes"] = [];
  const lastByeByTeam = new Map<string, number>();
  const playedByTeamWeek = new Map<string, Map<number, number>>();
  for (const g of resultGames) {
    for (const tid of [g.home, g.away]) {
      const m = playedByTeamWeek.get(tid) || new Map<number, number>();
      m.set(g.weekNumber, (m.get(g.weekNumber) || 0) + 1);
      playedByTeamWeek.set(tid, m);
    }
  }
  for (let w = 1; w <= weeksToFill; w++) {
    const dayDate = gameDays[w - 1];
    for (const t of teams) {
      const played = playedByTeamWeek.get(t.id)?.get(w) || 0;
      if (played < opts.gamesPerSession) {
        const prev = lastByeByTeam.get(t.id);
        const backToBack = prev === w - 1 && w > 1;
        repairedByes.push({ teamId: t.id, date: dayDate, weekNumber: w, backToBack });
        lastByeByTeam.set(t.id, w);
      }
    }
  }

  // ── Simulated annealing post-pass ─────────────────────────────────────────
  //
  // The greedy + repair pass is locally good but misses globally-better
  // arrangements. SA does random bucket-swaps (move a game from slot X to
  // slot Y on the same night, swapping with whatever was at Y), accepts
  // improvements always and worsenings with probability e^(-Δ/T). Swaps never
  // change games-per-team counts, so they preserve the repair invariants.
  //
  // The swap move operates on time buckets within one night, which is exactly
  // what we need to fix the "45-min gap between a team's two games" case.

  const saLog = annealSchedule({
    games: resultGames,
    teams,
    gamesPerSession: opts.gamesPerSession,
    iterations: Math.min(2000, resultGames.length * 20),
    seed: 0x5a_5a_5a_5a,
  });

  // Dropped pairs report
  const droppedPairs: WeekFillResult["droppedPairs"] = [];
  for (const p of pairs.values()) {
    if (p.crossDiv) continue; // filler — no drop if unused
    if (p.playedCount < p.targetCount) {
      droppedPairs.push({
        teamA: p.teamA,
        teamB: p.teamB,
        reason: `Pair played ${p.playedCount} of ${p.targetCount} times (ran out of weeks)`,
      });
    }
  }

  // Rebuild BYE records one more time: SA may have moved games between buckets
  // but never changes which team plays which week, so the BYE structure is
  // stable. Keep the post-repair records.
  void saLog;

  return {
    games: resultGames,
    byes: repairedByes,
    notes: [...weekNotes, ...repairLog],
    droppedPairs,
    targetWeeks,
    availableWeeks: allGameDays.length,
  };
}

// ── Simulated annealing ─────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d_2b_79_f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface AnnealParams {
  games: WeekFillScheduledGame[];
  teams: WeekFillTeam[];
  gamesPerSession: number;
  iterations: number;
  seed: number;
}

/**
 * Mutate `games` in place, swapping within-night bucket assignments to
 * minimize a gap-penalty + time-preference-conflict objective. Returns a
 * short log of accepted moves (empty in prod; useful for tests).
 */
function annealSchedule(params: AnnealParams): string[] {
  const { games, iterations, seed } = params;
  if (games.length < 2 || iterations <= 0) return [];

  const rng = mulberry32(seed);

  // Group game indices by date (night). SA swaps within a night only — swapping
  // across nights would affect per-week BYE structure.
  const gamesByNight = new Map<string, number[]>();
  for (let i = 0; i < games.length; i++) {
    const key = formatYMD(games[i].scheduledAt);
    const arr = gamesByNight.get(key) || [];
    arr.push(i);
    gamesByNight.set(key, arr);
  }
  const nights = [...gamesByNight.values()].filter((arr) => arr.length >= 2);
  if (nights.length === 0) return [];

  // Objective: sum over teams of (max_bucket − min_bucket − gamesCount + 1),
  // i.e. count of "empty buckets between a team's games" per night. Zero when
  // a team's games are perfectly adjacent.
  function nightGapPenalty(indices: number[]): number {
    const byTeam = new Map<string, number[]>();
    for (const i of indices) {
      const g = games[i];
      const bucket = g.scheduledAt.getTime();
      for (const tid of [g.home, g.away]) {
        const arr = byTeam.get(tid) || [];
        arr.push(bucket);
        byTeam.set(tid, arr);
      }
    }
    let penalty = 0;
    for (const buckets of byTeam.values()) {
      if (buckets.length < 2) continue;
      buckets.sort((a, b) => a - b);
      // Sum consecutive gaps beyond the minimum (1 bucket = adjacent).
      for (let k = 1; k < buckets.length; k++) {
        const gap = buckets[k] - buckets[k - 1];
        if (gap > 0) penalty += Math.floor(gap / 60_000 / 15); // 15-min units
      }
    }
    return penalty;
  }

  // Swap the scheduledAt (and court) of two games on the same night. The swap
  // is always legal structurally (each team still plays the same games), but
  // we must reject swaps that would double-book a team in one bucket.
  function tryApplySwap(indices: number[], i: number, j: number): boolean {
    if (i === j) return false;
    const gi = games[indices[i]];
    const gj = games[indices[j]];
    if (gi.scheduledAt.getTime() === gj.scheduledAt.getTime()) return false;

    // Check: after swap, no team appears twice in the same bucket.
    const teamsAtBucket = new Map<number, Set<string>>();
    for (let k = 0; k < indices.length; k++) {
      const g = games[indices[k]];
      let b = g.scheduledAt.getTime();
      if (k === i) b = gj.scheduledAt.getTime();
      else if (k === j) b = gi.scheduledAt.getTime();
      const set = teamsAtBucket.get(b) || new Set<string>();
      if (set.has(g.home) || set.has(g.away)) return false;
      set.add(g.home);
      set.add(g.away);
      teamsAtBucket.set(b, set);
    }
    return true;
  }

  function doSwap(indices: number[], i: number, j: number): void {
    const gi = games[indices[i]];
    const gj = games[indices[j]];
    const tmpAt = gi.scheduledAt;
    const tmpCourt = gi.court;
    games[indices[i]] = { ...gi, scheduledAt: gj.scheduledAt, court: gj.court };
    games[indices[j]] = { ...gj, scheduledAt: tmpAt, court: tmpCourt };
  }

  const log: string[] = [];
  let temperature = 1.0;
  const cooling = 0.999;

  let currentPenalty = 0;
  for (const indices of nights) currentPenalty += nightGapPenalty(indices);

  for (let iter = 0; iter < iterations; iter++) {
    const nightIdx = Math.floor(rng() * nights.length);
    const indices = nights[nightIdx];
    const i = Math.floor(rng() * indices.length);
    const j = Math.floor(rng() * indices.length);

    const beforeNight = nightGapPenalty(indices);
    if (!tryApplySwap(indices, i, j)) {
      temperature *= cooling;
      continue;
    }
    doSwap(indices, i, j);
    const afterNight = nightGapPenalty(indices);
    const delta = afterNight - beforeNight;

    if (delta <= 0) {
      currentPenalty += delta;
    } else {
      const accept = Math.exp(-delta / Math.max(0.01, temperature));
      if (rng() < accept) {
        currentPenalty += delta;
      } else {
        // Revert.
        doSwap(indices, i, j);
      }
    }
    temperature *= cooling;
  }

  if (currentPenalty >= 0) {
    log.push(`SA final gap-penalty: ${currentPenalty}`);
  }
  return log;
}
