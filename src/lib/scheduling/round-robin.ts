import type { PreferenceApplied } from "@/lib/types";

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

  for (let cycle = 0; cycle < frequency; cycle++) {
    const cycleTeams = [...teams]; // fresh rotation for each cycle
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
  teamsMap: Map<string, any>, // Team with preferences
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
      const courtNum = slotIndex % courtCount;
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

    // Score each matchup against each slot
    type ScoredAssignment = {
      matchupIdx: number;
      slotIdx: number;
      score: number;
      applied: PreferenceApplied;
      notes: string[];
    };

    const scoredAssignments: ScoredAssignment[] = [];

    for (let m = 0; m < dayMatchups.length; m++) {
      const matchup = dayMatchups[m];
      const homeTeam = teamsMap.get(matchup.home);
      const awayTeam = teamsMap.get(matchup.away);

      if (!homeTeam || !awayTeam) continue;

      for (let s = 0; s < availableSlots.length; s++) {
        const slot = availableSlots[s];
        const isEarly = s < midpoint || availableSlots.length === 1;
        const isLate = s >= midpoint;

        let score = 0;
        const applied: PreferenceApplied = {};
        const notes: string[] = [];

        // Check home team preferences
        const homePref = homeTeam.preferences;
        if (homePref) {
          // Bye dates (block this slot)
          if (homePref.bye_dates?.includes(formatDateYMD(slot.time))) {
            score -= 100;
            notes.push(`${homeTeam.name} has bye on this date`);
          } else {
            // Week-specific time preference (highest priority)
            if (homePref.week_preferences && homePref.week_preferences[weekNum]) {
              const weekPref = homePref.week_preferences[weekNum];
              if (weekPref === "early" && isEarly) {
                score += 15;
                applied.home_team = applied.home_team || [];
                applied.home_team.push("week_specific_time");
              } else if (weekPref === "late" && isLate) {
                score += 15;
                applied.home_team = applied.home_team || [];
                applied.home_team.push("week_specific_time");
              } else {
                score -= 10;
              }
            }
            // General time preference
            else if (homePref.preferred_time) {
              if (homePref.preferred_time === "early" && isEarly) {
                score += 8;
                applied.home_team = applied.home_team || [];
                applied.home_team.push("preferred_time");
              } else if (homePref.preferred_time === "late" && isLate) {
                score += 8;
                applied.home_team = applied.home_team || [];
                applied.home_team.push("preferred_time");
              } else {
                score -= 3;
              }
            }
          }
        }

        // Check away team preferences
        const awayPref = awayTeam.preferences;
        if (awayPref) {
          // Bye dates
          if (awayPref.bye_dates?.includes(formatDateYMD(slot.time))) {
            score -= 100;
            notes.push(`${awayTeam.name} has bye on this date`);
          } else {
            // Week-specific time preference
            if (awayPref.week_preferences && awayPref.week_preferences[weekNum]) {
              const weekPref = awayPref.week_preferences[weekNum];
              if (weekPref === "early" && isEarly) {
                score += 15;
                applied.away_team = applied.away_team || [];
                applied.away_team.push("week_specific_time");
              } else if (weekPref === "late" && isLate) {
                score += 15;
                applied.away_team = applied.away_team || [];
                applied.away_team.push("week_specific_time");
              } else {
                score -= 10;
              }
            }
            // General time preference
            else if (awayPref.preferred_time) {
              if (awayPref.preferred_time === "early" && isEarly) {
                score += 8;
                applied.away_team = applied.away_team || [];
                applied.away_team.push("preferred_time");
              } else if (awayPref.preferred_time === "late" && isLate) {
                score += 8;
                applied.away_team = applied.away_team || [];
                applied.away_team.push("preferred_time");
              } else {
                score -= 3;
              }
            }
          }
        }

        // Only consider valid assignments (no bye conflicts)
        if (score >= -50) {
          scoredAssignments.push({ matchupIdx: m, slotIdx: s, score, applied, notes });
        }
      }
    }

    // Sort by score (greedy assignment)
    scoredAssignments.sort((a, b) => b.score - a.score);

    const assignedMatchups = new Set<number>();
    const usedSlots = new Set<number>();
    // Track which teams are playing at which time (to prevent double-booking)
    const teamsAtTime = new Map<string, Set<string>>(); // time -> set of team IDs

    // Greedy assignment
    for (const assignment of scoredAssignments) {
      if (assignedMatchups.has(assignment.matchupIdx)) continue;
      if (usedSlots.has(assignment.slotIdx)) continue;

      const matchup = dayMatchups[assignment.matchupIdx];
      const slot = availableSlots[assignment.slotIdx];
      const timeKey = slot.time.toISOString();

      // Check if either team is already playing at this time
      const teamsAtThisTime = teamsAtTime.get(timeKey) || new Set<string>();
      if (teamsAtThisTime.has(matchup.home) || teamsAtThisTime.has(matchup.away)) {
        continue; // Skip this assignment - team conflict
      }

      const courtNum = slot.slotIndex % courtCount;

      result.push({
        home: matchup.home,
        away: matchup.away,
        scheduledAt: slot.time,
        venue,
        court: courtCount > 1 ? `Court ${courtNum + 1}` : null,
        weekNumber: weekNum,
        preferenceApplied: Object.keys(assignment.applied).length > 0 ? assignment.applied : null,
        schedulingNotes: assignment.notes.length > 0 ? assignment.notes.join("; ") : null,
      });

      assignedMatchups.add(assignment.matchupIdx);
      usedSlots.add(assignment.slotIdx);

      // Mark both teams as busy at this time
      teamsAtThisTime.add(matchup.home);
      teamsAtThisTime.add(matchup.away);
      teamsAtTime.set(timeKey, teamsAtThisTime);
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
