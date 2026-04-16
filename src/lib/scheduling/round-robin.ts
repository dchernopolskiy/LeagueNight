import type { PreferenceApplied, Team } from "@/lib/types";

export interface Matchup {
  home: string;
  away: string;
  round: number;
}

/**
 * Generate a round-robin schedule for a list of team IDs.
 * Uses the "circle method" — fixes one team and rotates the rest.
 * If odd number of teams, adds a BYE placeholder.
 *
 * @param frequency - how many times each pair plays (1 = single round-robin, 2 = double, etc.)
 */
export function generateRoundRobin(
  teamIds: string[],
  frequency: number = 1
): Matchup[] {
  const teams = [...teamIds];
  const hasBye = teams.length % 2 !== 0;
  if (hasBye) teams.push("BYE");

  const n = teams.length;
  const rounds = n - 1;
  const allMatchups: Matchup[] = [];

  // Continue rotation across cycles (don't reset cycleTeams each cycle).
  // Otherwise, with an odd team count, the same team always draws the BYE
  // during every cycle → that team plays `frequency` fewer games than others.
  const cycleTeams = [...teams];

  for (let cycle = 0; cycle < frequency; cycle++) {
    const roundOffset = cycle * rounds;

    for (let round = 0; round < rounds; round++) {
      for (let i = 0; i < n / 2; i++) {
        const home = cycleTeams[i];
        const away = cycleTeams[n - 1 - i];

        if (home === "BYE" || away === "BYE") continue;

        // Alternate home/away by round + cycle to balance
        if ((round + cycle) % 2 === 0) {
          allMatchups.push({ home, away, round: roundOffset + round + 1 });
        } else {
          allMatchups.push({
            home: away,
            away: home,
            round: roundOffset + round + 1,
          });
        }
      }

      // Rotate: fix cycleTeams[0], rotate rest clockwise
      const last = cycleTeams.pop()!;
      cycleTeams.splice(1, 0, last);
    }
  }

  return allMatchups;
}

export interface ScheduleSlot {
  date: Date;
  venue: string | null;
  court: string | null;
}

/**
 * Map matchups to calendar dates given a recurring game day pattern.
 * Distributes games across available courts per week.
 *
 * @param gamesPerTeamPerDay - how many games each team plays per game day (e.g. 2 for volleyball)
 *   When > 1, multiple rounds are packed into the same day.
 */
export function assignDates(
  matchups: Matchup[],
  pattern: {
    dayOfWeek: number;
    startTime: string;
    endTime?: string | null;
    venue: string | null;
    courtCount: number;
    startsOn: Date;
    durationMinutes: number;
    skipDates?: string[];
  },
  gamesPerTeamPerDay: number = 1
): {
  home: string;
  away: string;
  scheduledAt: Date;
  venue: string | null;
  court: string | null;
  weekNumber: number;
}[] {
  const { dayOfWeek, startTime, endTime, venue, courtCount, startsOn, durationMinutes, skipDates } =
    pattern;

  const skipSet = new Set(skipDates || []);

  // Group matchups by round
  const rounds = new Map<number, Matchup[]>();
  for (const m of matchups) {
    const arr = rounds.get(m.round) || [];
    arr.push(m);
    rounds.set(m.round, arr);
  }

  const [hours, minutes] = startTime.split(":").map(Number);

  // Parse end time into total minutes from midnight for easy comparison
  let endMinutesFromMidnight: number | null = null;
  if (endTime) {
    const [eh, em] = endTime.split(":").map(Number);
    endMinutesFromMidnight = eh * 60 + em;
  }

  function nextGameDay(from: Date): Date {
    const d = new Date(from);
    const diff = (dayOfWeek - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + (diff === 0 && d >= from ? 0 : diff || 7));
    d.setHours(hours, minutes, 0, 0);
    return d;
  }

  const result: {
    home: string;
    away: string;
    scheduledAt: Date;
    venue: string | null;
    court: string | null;
    weekNumber: number;
  }[] = [];

  let currentDate = nextGameDay(startsOn);
  const sortedRounds = [...rounds.keys()].sort((a, b) => a - b);

  function formatDateYMD(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // Pack `gamesPerTeamPerDay` rounds into each game day
  let weekNum = 1;
  for (let ri = 0; ri < sortedRounds.length; ri += gamesPerTeamPerDay) {
    // Skip dates that match the skip list
    while (skipSet.has(formatDateYMD(currentDate))) {
      currentDate = new Date(currentDate);
      currentDate.setDate(currentDate.getDate() + 7);
      weekNum++;
    }

    const dayRounds = sortedRounds.slice(ri, ri + gamesPerTeamPerDay);

    // Combine all matchups for this game day
    const dayMatchups: Matchup[] = [];
    for (const roundNum of dayRounds) {
      dayMatchups.push(...(rounds.get(roundNum) || []));
    }

    // Spread across time slots, stopping if we'd exceed end_time
    let slotIndex = 0;
    for (const matchup of dayMatchups) {
      const courtNum = slotIndex % courtCount;
      const timeSlotOffset =
        Math.floor(slotIndex / courtCount) * durationMinutes;

      // Check if this game slot would start at or after end_time
      if (endMinutesFromMidnight !== null) {
        const slotStartMinutes = hours * 60 + minutes + timeSlotOffset;
        if (slotStartMinutes >= endMinutesFromMidnight) break;
      }

      const gameTime = new Date(currentDate);
      gameTime.setMinutes(gameTime.getMinutes() + timeSlotOffset);

      result.push({
        home: matchup.home,
        away: matchup.away,
        scheduledAt: gameTime,
        venue,
        court: courtCount > 1 ? `Court ${courtNum + 1}` : null,
        weekNumber: weekNum,
      });

      slotIndex++;
    }

    weekNum++;
    currentDate = new Date(currentDate);
    currentDate.setDate(currentDate.getDate() + 7);
  }

  return result;
}

/**
 * Enhanced version of assignDates that respects team preferences
 * Returns games with preference tracking metadata
 */
export function assignDatesWithPreferences(
  matchups: Matchup[],
  pattern: {
    dayOfWeek: number;
    startTime: string;
    endTime?: string | null;
    venue: string | null;
    courtCount: number;
    startsOn: Date;
    durationMinutes: number;
    skipDates?: string[];
  },
  teamsMap: Map<string, Pick<Team, "id" | "name" | "preferences">>,
  gamesPerTeamPerDay: number = 1
): {
  home: string;
  away: string;
  scheduledAt: Date;
  venue: string | null;
  court: string | null;
  weekNumber: number;
  preferenceApplied?: PreferenceApplied | null;
  schedulingNotes?: string | null;
}[] {
  const { dayOfWeek, startTime, endTime, venue, courtCount, startsOn, durationMinutes, skipDates } =
    pattern;

  const skipSet = new Set(skipDates || []);
  const [hours, minutes] = startTime.split(":").map(Number);

  // Parse end time
  let endMinutesFromMidnight: number | null = null;
  if (endTime) {
    const [eh, em] = endTime.split(":").map(Number);
    endMinutesFromMidnight = eh * 60 + em;
  }

  function nextGameDay(from: Date): Date {
    const d = new Date(from);
    const diff = (dayOfWeek - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + (diff === 0 && d >= from ? 0 : diff || 7));
    d.setHours(hours, minutes, 0, 0);
    return d;
  }

  function formatDateYMD(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // Group matchups by round
  const rounds = new Map<number, Matchup[]>();
  for (const m of matchups) {
    const arr = rounds.get(m.round) || [];
    arr.push(m);
    rounds.set(m.round, arr);
  }

  const result: {
    home: string;
    away: string;
    scheduledAt: Date;
    venue: string | null;
    court: string | null;
    weekNumber: number;
    preferenceApplied?: PreferenceApplied | null;
    schedulingNotes?: string | null;
  }[] = [];

  let currentDate = nextGameDay(startsOn);
  const sortedRounds = [...rounds.keys()].sort((a, b) => a - b);
  let weekNum = 1;

  // Process each game day
  for (let ri = 0; ri < sortedRounds.length; ri += gamesPerTeamPerDay) {
    // Skip dates
    while (skipSet.has(formatDateYMD(currentDate))) {
      currentDate = new Date(currentDate);
      currentDate.setDate(currentDate.getDate() + 7);
      weekNum++;
    }

    const dayRounds = sortedRounds.slice(ri, ri + gamesPerTeamPerDay);
    const dayMatchups: Matchup[] = [];
    for (const roundNum of dayRounds) {
      dayMatchups.push(...(rounds.get(roundNum) || []));
    }

    // Build available time slots for this day
    const availableSlots: Array<{ time: Date; slotIndex: number }> = [];
    let slotIndex = 0;

    while (true) {
      const timeSlotOffset = Math.floor(slotIndex / courtCount) * durationMinutes;

      // Check if slot exceeds end_time
      if (endMinutesFromMidnight !== null) {
        const slotStartMinutes = hours * 60 + minutes + timeSlotOffset;
        if (slotStartMinutes >= endMinutesFromMidnight) break;
      }

      const gameTime = new Date(currentDate);
      gameTime.setMinutes(gameTime.getMinutes() + timeSlotOffset);
      availableSlots.push({ time: gameTime, slotIndex });
      slotIndex++;

      // Stop when we have enough slots for all matchups
      if (availableSlots.length >= dayMatchups.length) break;
    }

    // Categorize slots as early/late
    const midpoint = Math.floor(availableSlots.length / 2);
    const slotMeta = availableSlots.map((slot, slotIdx) => ({
      slot,
      slotIdx,
      timeKey: slot.time.toISOString(),
      isEarly: slotIdx < midpoint || availableSlots.length === 1,
      isLate: slotIdx >= midpoint,
    }));

    type SlotCandidate = {
      slotIdx: number;
      score: number;
      applied: PreferenceApplied;
      notes: string[];
    };
    type MatchupCandidateSet = {
      matchupIdx: number;
      candidates: SlotCandidate[];
      bestScore: number;
    };

    function scoreTeamPreference(
      team: Pick<Team, "name" | "preferences">,
      slotDate: Date,
      isEarly: boolean,
      isLate: boolean,
      side: "home_team" | "away_team",
      applied: PreferenceApplied,
      notes: string[]
    ): number {
      const pref = team.preferences;
      if (!pref) return 0;

      const slotDateYMD = formatDateYMD(slotDate);
      if (pref.bye_dates?.includes(slotDateYMD)) {
        notes.push(`${team.name} has bye on this date`);
        return -100;
      }

      if (pref.week_preferences && pref.week_preferences[weekNum]) {
        const weekPref = pref.week_preferences[weekNum];
        if (weekPref === "early" && isEarly) {
          applied[side] = applied[side] || [];
          applied[side].push("week_specific_time");
          return 15;
        }
        if (weekPref === "late" && isLate) {
          applied[side] = applied[side] || [];
          applied[side].push("week_specific_time");
          return 15;
        }
        return -10;
      }

      if (pref.preferred_time === "early") {
        if (isEarly) {
          applied[side] = applied[side] || [];
          applied[side].push("preferred_time");
          return 8;
        }
        return -3;
      }

      if (pref.preferred_time === "late") {
        if (isLate) {
          applied[side] = applied[side] || [];
          applied[side].push("preferred_time");
          return 8;
        }
        return -3;
      }

      return 0;
    }

    const matchupCandidates: MatchupCandidateSet[] = [];

    for (let matchupIdx = 0; matchupIdx < dayMatchups.length; matchupIdx++) {
      const matchup = dayMatchups[matchupIdx];
      const homeTeam = teamsMap.get(matchup.home);
      const awayTeam = teamsMap.get(matchup.away);

      if (!homeTeam || !awayTeam) continue;

      const candidates: SlotCandidate[] = [];

      for (const meta of slotMeta) {
        const applied: PreferenceApplied = {};
        const notes: string[] = [];
        let score = 0;

        score += scoreTeamPreference(
          homeTeam,
          meta.slot.time,
          meta.isEarly,
          meta.isLate,
          "home_team",
          applied,
          notes
        );
        score += scoreTeamPreference(
          awayTeam,
          meta.slot.time,
          meta.isEarly,
          meta.isLate,
          "away_team",
          applied,
          notes
        );

        if (score >= -50) {
          candidates.push({
            slotIdx: meta.slotIdx,
            score,
            applied,
            notes,
          });
        }
      }

      candidates.sort((a, b) => b.score - a.score);
      matchupCandidates.push({
        matchupIdx,
        candidates,
        bestScore: candidates[0]?.score ?? Number.NEGATIVE_INFINITY,
      });
    }

    matchupCandidates.sort((a, b) => {
      if (a.candidates.length !== b.candidates.length) {
        return a.candidates.length - b.candidates.length;
      }
      return b.bestScore - a.bestScore;
    });

    const assignedMatchups = new Set<number>();
    const usedSlots = new Set<number>();
    // Track which teams are playing at which time (to prevent double-booking)
    const teamsAtTime = new Map<string, Set<string>>(); // time -> set of team IDs

    // Greedy assignment, but operate matchup-by-matchup rather than sorting one
    // giant cross-product list of every matchup/slot combination.
    for (const candidateSet of matchupCandidates) {
      const matchup = dayMatchups[candidateSet.matchupIdx];

      for (const candidate of candidateSet.candidates) {
        if (usedSlots.has(candidate.slotIdx)) continue;

        const slot = availableSlots[candidate.slotIdx];
        const timeKey = slot.time.toISOString();
        const teamsAtThisTime = teamsAtTime.get(timeKey) || new Set<string>();
        if (teamsAtThisTime.has(matchup.home) || teamsAtThisTime.has(matchup.away)) {
          continue;
        }

        const courtNum = slot.slotIndex % courtCount;
        result.push({
          home: matchup.home,
          away: matchup.away,
          scheduledAt: slot.time,
          venue,
          court: courtCount > 1 ? `Court ${courtNum + 1}` : null,
          weekNumber: weekNum,
          preferenceApplied: Object.keys(candidate.applied).length > 0 ? candidate.applied : null,
          schedulingNotes: candidate.notes.length > 0 ? candidate.notes.join("; ") : null,
        });

        assignedMatchups.add(candidateSet.matchupIdx);
        usedSlots.add(candidate.slotIdx);
        teamsAtThisTime.add(matchup.home);
        teamsAtThisTime.add(matchup.away);
        teamsAtTime.set(timeKey, teamsAtThisTime);
        break;
      }
    }

    // Fallback for unassigned matchups
    for (let m = 0; m < dayMatchups.length; m++) {
      if (assignedMatchups.has(m)) continue;

      const matchup = dayMatchups[m];

      // Find first available slot without team conflicts
      for (let s = 0; s < availableSlots.length; s++) {
        if (usedSlots.has(s)) continue;

        const slot = availableSlots[s];
        const timeKey = slot.time.toISOString();
        const teamsAtThisTime = teamsAtTime.get(timeKey) || new Set<string>();

        // Check for team conflict
        if (teamsAtThisTime.has(matchup.home) || teamsAtThisTime.has(matchup.away)) {
          continue; // Team already playing at this time
        }

        const courtNum = slot.slotIndex % courtCount;

        result.push({
          home: matchup.home,
          away: matchup.away,
          scheduledAt: slot.time,
          venue,
          court: courtCount > 1 ? `Court ${courtNum + 1}` : null,
          weekNumber: weekNum,
          preferenceApplied: null,
          schedulingNotes: "Fallback assignment (no slot scored positively)",
        });

        usedSlots.add(s);
        assignedMatchups.add(m);

        // Mark teams as busy
        teamsAtThisTime.add(matchup.home);
        teamsAtThisTime.add(matchup.away);
        teamsAtTime.set(timeKey, teamsAtThisTime);
        break;
      }
    }

    weekNum++;
    currentDate = new Date(currentDate);
    currentDate.setDate(currentDate.getDate() + 7);
  }

  return result;
}
