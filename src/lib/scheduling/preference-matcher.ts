/**
 * Preference Matcher - Assigns games to time slots based on team preferences
 *
 * This module is responsible for:
 * 1. Evaluating team preferences against available time slots
 * 2. Scoring potential assignments based on preference satisfaction
 * 3. Tracking which preferences were applied to each game
 */

import { format, parse, getDay } from "date-fns";
import type { Team, TeamPreferences, PreferenceApplied } from "@/lib/types";

export interface TimeSlot {
  date: Date;
  time: string; // HH:MM format
  weekNumber: number;
  isEarly: boolean; // First half of available slots that day
  isLate: boolean;  // Second half of available slots that day
}

export interface MatchupWithSlot {
  homeTeamId: string;
  awayTeamId: string;
  slot: TimeSlot;
  preferenceScore: number;
  appliedPreferences: PreferenceApplied;
  notes: string[];
}

interface TeamWithPreferences extends Team {
  preferences: TeamPreferences;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Scores how well a time slot matches team preferences
 * Higher score = better match
 */
export function scoreSlotForTeam(
  team: TeamWithPreferences,
  slot: TimeSlot,
  isHomeTeam: boolean
): { score: number; applied: string[]; notes: string[] } {
  let score = 0;
  const applied: string[] = [];
  const notes: string[] = [];
  const prefs = team.preferences;

  if (!prefs) {
    return { score: 0, applied: [], notes: [] };
  }

  // Check bye dates (negative score if violates)
  if (prefs.bye_dates && prefs.bye_dates.length > 0) {
    const dateStr = format(slot.date, "yyyy-MM-dd");
    if (prefs.bye_dates.includes(dateStr)) {
      score -= 100; // Major penalty for scheduling on bye date
      notes.push(`${team.name} requested bye on ${dateStr}`);
      return { score, applied, notes }; // Don't schedule here
    }
  }

  // Check preferred days (moderate bonus)
  if (prefs.preferred_days && prefs.preferred_days.length > 0) {
    const dayName = DAY_NAMES[getDay(slot.date)];
    if (prefs.preferred_days.includes(dayName)) {
      score += 10;
      applied.push("preferred_day");
      notes.push(`${team.name} prefers ${dayName}s`);
    } else {
      score -= 5; // Small penalty for non-preferred day
    }
  }

  // Check week-specific preferences (highest priority)
  if (prefs.week_preferences && prefs.week_preferences[slot.weekNumber]) {
    const weekPref = prefs.week_preferences[slot.weekNumber];
    if (weekPref === "early" && slot.isEarly) {
      score += 15;
      applied.push("week_specific_time");
      notes.push(`${team.name} requested early game in week ${slot.weekNumber}`);
    } else if (weekPref === "late" && slot.isLate) {
      score += 15;
      applied.push("week_specific_time");
      notes.push(`${team.name} requested late game in week ${slot.weekNumber}`);
    } else if (weekPref === "early" && !slot.isEarly) {
      score -= 10;
      notes.push(`${team.name} requested early game in week ${slot.weekNumber} but slot is late`);
    } else if (weekPref === "late" && !slot.isLate) {
      score -= 10;
      notes.push(`${team.name} requested late game in week ${slot.weekNumber} but slot is early`);
    }
  }
  // Check general time preferences (lower priority than week-specific)
  else if (prefs.preferred_time) {
    if (prefs.preferred_time === "early" && slot.isEarly) {
      score += 8;
      applied.push("preferred_time");
      notes.push(`${team.name} prefers early games`);
    } else if (prefs.preferred_time === "late" && slot.isLate) {
      score += 8;
      applied.push("preferred_time");
      notes.push(`${team.name} prefers late games`);
    } else if (prefs.preferred_time === "early" && !slot.isEarly) {
      score -= 3;
    } else if (prefs.preferred_time === "late" && !slot.isLate) {
      score -= 3;
    }
  }

  return { score, applied, notes };
}

/**
 * Scores a matchup for a specific time slot
 * Combines preferences for both teams
 */
export function scoreMatchupForSlot(
  homeTeam: TeamWithPreferences,
  awayTeam: TeamWithPreferences,
  slot: TimeSlot
): { score: number; applied: PreferenceApplied; notes: string[] } {
  const homeResult = scoreSlotForTeam(homeTeam, slot, true);
  const awayResult = scoreSlotForTeam(awayTeam, slot, false);

  const totalScore = homeResult.score + awayResult.score;
  const applied: PreferenceApplied = {};
  const allNotes = [...homeResult.notes, ...awayResult.notes];

  if (homeResult.applied.length > 0) {
    applied.home_team = homeResult.applied;
  }
  if (awayResult.applied.length > 0) {
    applied.away_team = awayResult.applied;
  }

  return { score: totalScore, applied, notes: allNotes };
}

/**
 * Assigns matchups to time slots using greedy algorithm with backtracking
 * Tries to maximize preference satisfaction
 */
export function assignMatchupsToSlots(
  matchups: Array<{ home: string; away: string }>,
  slots: TimeSlot[],
  teamsMap: Map<string, TeamWithPreferences>
): MatchupWithSlot[] {
  const result: MatchupWithSlot[] = [];
  const usedSlots = new Set<number>();

  // Build a scoring matrix: matchup x slot
  const scores: Array<{
    matchupIdx: number;
    slotIdx: number;
    score: number;
    applied: PreferenceApplied;
    notes: string[];
  }> = [];

  for (let m = 0; m < matchups.length; m++) {
    const matchup = matchups[m];
    const homeTeam = teamsMap.get(matchup.home);
    const awayTeam = teamsMap.get(matchup.away);

    if (!homeTeam || !awayTeam) continue;

    for (let s = 0; s < slots.length; s++) {
      const { score, applied, notes } = scoreMatchupForSlot(homeTeam, awayTeam, slots[s]);

      // Only consider slots with non-negative scores (avoid bye dates)
      if (score >= 0) {
        scores.push({ matchupIdx: m, slotIdx: s, score, applied, notes });
      }
    }
  }

  // Sort by score descending (greedy: assign best matches first)
  scores.sort((a, b) => b.score - a.score);

  const assignedMatchups = new Set<number>();

  // Greedy assignment
  for (const entry of scores) {
    if (assignedMatchups.has(entry.matchupIdx)) continue;
    if (usedSlots.has(entry.slotIdx)) continue;

    const matchup = matchups[entry.matchupIdx];
    const slot = slots[entry.slotIdx];

    result.push({
      homeTeamId: matchup.home,
      awayTeamId: matchup.away,
      slot,
      preferenceScore: entry.score,
      appliedPreferences: entry.applied,
      notes: entry.notes,
    });

    assignedMatchups.add(entry.matchupIdx);
    usedSlots.add(entry.slotIdx);

    // Stop if all matchups assigned
    if (assignedMatchups.size === matchups.length) break;
  }

  // Handle unassigned matchups (fallback: assign to remaining slots with no preference tracking)
  for (let m = 0; m < matchups.length; m++) {
    if (assignedMatchups.has(m)) continue;

    // Find first available slot
    for (let s = 0; s < slots.length; s++) {
      if (!usedSlots.has(s)) {
        result.push({
          homeTeamId: matchups[m].home,
          awayTeamId: matchups[m].away,
          slot: slots[s],
          preferenceScore: 0,
          appliedPreferences: {},
          notes: ["No preferences applied (fallback assignment)"],
        });
        usedSlots.add(s);
        assignedMatchups.add(m);
        break;
      }
    }
  }

  return result;
}

/**
 * Determines if a time slot is "early" or "late" within its day
 * based on the position in the day's schedule
 */
export function categorizeTimeSlots(
  slotsOnSameDay: TimeSlot[]
): { early: Set<number>; late: Set<number> } {
  const sorted = [...slotsOnSameDay].sort((a, b) => a.time.localeCompare(b.time));
  const midpoint = Math.floor(sorted.length / 2);

  const early = new Set<number>();
  const late = new Set<number>();

  sorted.forEach((slot, idx) => {
    if (idx < midpoint || sorted.length === 1) {
      slot.isEarly = true;
      slot.isLate = false;
    } else {
      slot.isEarly = false;
      slot.isLate = true;
    }
  });

  return { early, late };
}
