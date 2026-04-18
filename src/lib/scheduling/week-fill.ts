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
  targetWeeks: number;
  matchupFrequency: number;
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
  opts: Pick<WeekFillOptions, "matchupFrequency" | "gamesPerSession">,
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
  const minWeeks = Math.max(0, Math.ceil(fullRounds / Math.max(1, opts.gamesPerSession)));

  const gameDays = buildGameDays(pattern);
  const available = pattern.endsOn ? gameDays.length : Number.POSITIVE_INFINITY;

  const fits = available >= minWeeks;
  const targetWeeks = Math.min(minWeeks, available === Number.POSITIVE_INFINITY ? minWeeks : available);

  // Dropped-pair estimate: rounds we can't fit × pairs-per-round (n/2 for even, (n-1)/2 for odd).
  const pairsPerRound = Math.floor(biggestSize / 2);
  const missingRounds = Math.max(0, minWeeks * opts.gamesPerSession - available * opts.gamesPerSession);
  const droppedPairs = fits ? 0 : missingRounds * pairsPerRound;

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
    targetWeeks,
    matchupFrequency: opts.matchupFrequency,
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
  // Re-seed mode: prioritize 0.65 no-repeat vs 0.35 skill-alignment per design.
  // REPEAT_PENALTY is 50 → skill bonus max should be ~27 to hit 0.65/0.35 ratio
  // against a single prior play. Use 27 as the max for (1 - |wA - wB|).
  const SKILL_ALIGN_BONUS = 27;

  function scorePair(
    pair: PairInfo,
    week: number,
    slotTimeDate: Date,
    isEarly: boolean,
    isLate: boolean
  ): { score: number; applied: PreferenceApplied; notes: string[] } | null {
    const stateA = teamState.get(pair.teamA)!;
    const stateB = teamState.get(pair.teamB)!;
    const applied: PreferenceApplied = {};
    const notes: string[] = [];

    let score = 0;

    // Repeat penalty scales with prior plays.
    score -= REPEAT_PENALTY * pair.playedCount;

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

  // ── Seed: biggest division's round-robin is fixed upfront ────────────────
  //
  // Greedy per-slot scoring can't guarantee a perfect within-division round
  // robin when slots are tight. The circle method does. So for the biggest
  // division we pre-assign every pair to a specific week. The greedy loop
  // then fills remaining slots around these seeds.
  //
  // We skip seeding when existingMatchupCounts already has prior plays, to
  // avoid double-counting; in that case fall back to pure greedy.

  let biggestDivId: string | null = null;
  let biggestSize = 0;
  for (const [divId, divTeams] of divMap) {
    if (divTeams.length > biggestSize) {
      biggestSize = divTeams.length;
      biggestDivId = divId;
    }
  }

  // weekNumber -> list of seeded matchups [teamA, teamB]
  const seededByWeek = new Map<number, Array<{ a: string; b: string }>>();
  const shouldSeed =
    biggestDivId !== null &&
    biggestSize >= 4 &&
    (existingMatchupCounts === undefined || existingMatchupCounts.size === 0);

  if (shouldSeed && biggestDivId) {
    const biggestTeams = (divMap.get(biggestDivId) || []).map((t) => t.id);
    const matchups = generateRoundRobin(biggestTeams, opts.matchupFrequency);
    // Pack `gamesPerSession` rounds into each week (matches round-robin.assignDates).
    for (const m of matchups) {
      const week = Math.ceil(m.round / Math.max(1, opts.gamesPerSession));
      const arr = seededByWeek.get(week) || [];
      arr.push({ a: m.home, b: m.away });
      seededByWeek.set(week, arr);
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

    // Seed phase: place biggest-division round-robin matchups for this week
    // into the earliest available slots (respecting bucket constraints).
    const seededPairs = seededByWeek.get(weekNumber) || [];
    for (const seed of seededPairs) {
      for (let slotIdx = 0; slotIdx < totalSlots; slotIdx++) {
        if (usedSlots.has(slotIdx)) continue;
        const bucket = slotBucket(slotIdx);
        const teamsInBucket = slotTeams.get(bucket) || new Set<string>();
        if (teamsInBucket.has(seed.a) || teamsInBucket.has(seed.b)) continue;
        if ((gamesThisWeek.get(seed.a) || 0) >= opts.gamesPerSession) break;
        if ((gamesThisWeek.get(seed.b) || 0) >= opts.gamesPerSession) break;
        const slotDate = slotTime(dayDate, slotIdx);
        const courtNum = (slotIdx % courtCount) + 1;
        const key = pairKey(seed.a, seed.b);
        const pair = pairs.get(key);
        if (!pair) break;

        resultGames.push({
          home: seed.a,
          away: seed.b,
          scheduledAt: slotDate,
          venue: pattern.venue,
          court: courtCount > 1 ? `Court ${courtNum}` : null,
          weekNumber,
          preferenceApplied: null,
          schedulingNotes: null,
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
        usedSlots.add(slotIdx);
        break;
      }
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

        // Within-division pairs: never play beyond the requested matchup frequency.
        // Without this, the greedy scorer picks repeat pairs when every fresh pair
        // is blocked in that slot (leading to pairs that never meet each other).
        if (!pair.crossDiv && pair.playedCount >= pair.targetCount) continue;

        // Skip crossplay when both teams still have within-div work available.
        if (pair.crossDiv) {
          const aHasWithinDivWork = hasUnfinishedWithinDiv(pair.teamA);
          const bHasWithinDivWork = hasUnfinishedWithinDiv(pair.teamB);
          if (aHasWithinDivWork && bHasWithinDivWork) continue;
        }

        const scored = scorePair(pair, weekNumber, slotDate, isEarly, isLate);
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

  function hasUnfinishedWithinDiv(teamId: string): boolean {
    for (const p of pairs.values()) {
      if (p.crossDiv) continue;
      if (p.exhausted) continue;
      if (p.teamA === teamId || p.teamB === teamId) return true;
    }
    return false;
  }

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

  return {
    games: resultGames,
    byes: byeRecords,
    notes: weekNotes,
    droppedPairs,
    targetWeeks,
    availableWeeks: allGameDays.length,
  };
}
