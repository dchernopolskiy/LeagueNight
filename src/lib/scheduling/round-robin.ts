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
