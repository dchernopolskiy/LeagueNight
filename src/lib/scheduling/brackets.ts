import type { Standing, Team, BracketSlot } from "@/lib/types";

type SlotData = Omit<BracketSlot, "id" | "bracket_id" | "created_at">;

/**
 * Standard bracket seeding order for powers of 2.
 * For N teams the first round matchups are arranged so that
 * seed 1 meets seed N, seed 2 meets seed N-1, etc., but
 * distributed across the bracket so winners don't meet until
 * later rounds.
 */
function seedOrder(numTeams: number): number[] {
  if (numTeams === 1) return [1];
  if (numTeams === 2) return [1, 2];

  const half = seedOrder(numTeams / 2);
  const result: number[] = [];
  for (const seed of half) {
    result.push(seed);
    result.push(numTeams + 1 - seed);
  }
  return result;
}

/** Round up to the next power of 2 */
function nextPowerOf2(n: number): number {
  return Math.pow(2, Math.ceil(Math.log2(n)));
}

export function generateBracket(options: {
  standings: Standing[];
  teams: Team[];
  numTeams: number;
  format: "single_elimination" | "double_elimination";
}): { slots: SlotData[]; totalRounds: number } {
  const { standings, teams, numTeams, format } = options;

  if (format === "single_elimination") {
    return generateSingleElimination(standings, teams, numTeams);
  }

  return generateDoubleElimination(standings, teams, numTeams);
}

// ---------------------------------------------------------------------------
// Single Elimination (supports non-power-of-2 with byes)
// ---------------------------------------------------------------------------

function generateSingleElimination(
  standings: Standing[],
  teams: Team[],
  numTeams: number
): { slots: SlotData[]; totalRounds: number } {
  // Round up to the next power of 2 for bracket structure
  const bracketSize = nextPowerOf2(numTeams);
  const totalRounds = Math.log2(bracketSize);
  const slots: SlotData[] = [];

  const seededTeams = standings.slice(0, numTeams);
  const order = seedOrder(bracketSize);

  // Round 1: create matchup slots in pairs
  const firstRoundMatchups = bracketSize / 2;
  for (let i = 0; i < firstRoundMatchups; i++) {
    const topSeed = order[i * 2];
    const bottomSeed = order[i * 2 + 1];

    // Seeds > numTeams are byes (no team assigned)
    const topStanding = topSeed <= numTeams ? seededTeams[topSeed - 1] : null;
    const bottomStanding =
      bottomSeed <= numTeams ? seededTeams[bottomSeed - 1] : null;

    const topPos = i * 2;
    const bottomPos = i * 2 + 1;
    const nextRoundPos = i;

    slots.push({
      round: 1,
      position: topPos,
      team_id: topStanding?.team_id ?? null,
      seed: topSeed <= numTeams ? topSeed : null,
      game_id: null,
      winner_to: totalRounds > 1 ? `W-2-${nextRoundPos}` : null,
    });

    slots.push({
      round: 1,
      position: bottomPos,
      team_id: bottomStanding?.team_id ?? null,
      seed: bottomSeed <= numTeams ? bottomSeed : null,
      game_id: null,
      winner_to: totalRounds > 1 ? `W-2-${nextRoundPos}` : null,
    });
  }

  // Subsequent rounds: empty slots that get filled as winners advance
  for (let round = 2; round <= totalRounds; round++) {
    const matchupsInRound = bracketSize / Math.pow(2, round);
    for (let i = 0; i < matchupsInRound; i++) {
      const topPos = i * 2;
      const bottomPos = i * 2 + 1;
      const nextRoundPos = Math.floor(i / 2);
      const winnerTo =
        round < totalRounds ? `W-${round + 1}-${nextRoundPos}` : null;

      slots.push({
        round,
        position: topPos,
        team_id: null,
        seed: null,
        game_id: null,
        winner_to: winnerTo,
      });

      slots.push({
        round,
        position: bottomPos,
        team_id: null,
        seed: null,
        game_id: null,
        winner_to: winnerTo,
      });
    }
  }

  // For byes: auto-advance teams into round 2 slots
  // A bye exists when one side of a round-1 matchup has no team
  for (let i = 0; i < firstRoundMatchups; i++) {
    const topSlot = slots[i * 2];
    const bottomSlot = slots[i * 2 + 1];

    const topHasTeam = topSlot.team_id !== null;
    const bottomHasTeam = bottomSlot.team_id !== null;

    if (topHasTeam && !bottomHasTeam && totalRounds > 1) {
      // Top team gets a bye — advance them to round 2
      const r2SlotPos = i; // position index in round 2
      const r2Slots = slots.filter((s) => s.round === 2);
      // Find the slot the bye winner should go to
      const targetSlotIdx = r2SlotPos % 2 === 0 ? r2SlotPos : r2SlotPos;
      if (r2Slots[targetSlotIdx]) {
        r2Slots[targetSlotIdx].team_id = topSlot.team_id;
        r2Slots[targetSlotIdx].seed = topSlot.seed;
      }
    } else if (!topHasTeam && bottomHasTeam && totalRounds > 1) {
      const r2SlotPos = i;
      const r2Slots = slots.filter((s) => s.round === 2);
      if (r2Slots[r2SlotPos]) {
        r2Slots[r2SlotPos].team_id = bottomSlot.team_id;
        r2Slots[r2SlotPos].seed = bottomSlot.seed;
      }
    }
  }

  return { slots, totalRounds };
}

// ---------------------------------------------------------------------------
// Double Elimination (supports non-power-of-2 with byes)
// ---------------------------------------------------------------------------

function generateDoubleElimination(
  standings: Standing[],
  teams: Team[],
  numTeams: number
): { slots: SlotData[]; totalRounds: number } {
  const bracketSize = nextPowerOf2(numTeams);
  const wbRounds = Math.log2(bracketSize);
  const lbRounds = 2 * (wbRounds - 1);
  const totalRounds = wbRounds + lbRounds + 1;

  const slots: SlotData[] = [];
  const seededTeams = standings.slice(0, numTeams);
  const order = seedOrder(bracketSize);

  // --- Winners Bracket Round 1 ---
  const firstRoundMatchups = bracketSize / 2;
  for (let i = 0; i < firstRoundMatchups; i++) {
    const topSeed = order[i * 2];
    const bottomSeed = order[i * 2 + 1];

    const topStanding = topSeed <= numTeams ? seededTeams[topSeed - 1] : null;
    const bottomStanding =
      bottomSeed <= numTeams ? seededTeams[bottomSeed - 1] : null;

    const topPos = i * 2;
    const bottomPos = i * 2 + 1;
    const nextRoundPos = i;

    slots.push({
      round: 1,
      position: topPos,
      team_id: topStanding?.team_id ?? null,
      seed: topSeed <= numTeams ? topSeed : null,
      game_id: null,
      winner_to: `W-2-${nextRoundPos}`,
    });

    slots.push({
      round: 1,
      position: bottomPos,
      team_id: bottomStanding?.team_id ?? null,
      seed: bottomSeed <= numTeams ? bottomSeed : null,
      game_id: null,
      winner_to: `W-2-${nextRoundPos}`,
    });
  }

  // --- Winners Bracket Rounds 2..wbRounds ---
  for (let round = 2; round <= wbRounds; round++) {
    const matchupsInRound = bracketSize / Math.pow(2, round);
    for (let i = 0; i < matchupsInRound; i++) {
      const topPos = i * 2;
      const bottomPos = i * 2 + 1;
      const nextRoundPos = Math.floor(i / 2);

      const winnerTo =
        round < wbRounds
          ? `W-${round + 1}-${nextRoundPos}`
          : `GF-${totalRounds}-0`;

      slots.push({
        round,
        position: topPos,
        team_id: null,
        seed: null,
        game_id: null,
        winner_to: winnerTo,
      });

      slots.push({
        round,
        position: bottomPos,
        team_id: null,
        seed: null,
        game_id: null,
        winner_to: winnerTo,
      });
    }
  }

  // --- Losers Bracket ---
  const lbStartRound = wbRounds + 1;
  for (let lbRound = 1; lbRound <= lbRounds; lbRound++) {
    const actualRound = lbStartRound + lbRound - 1;
    const matchupsInRound = Math.max(
      1,
      bracketSize / Math.pow(2, Math.ceil(lbRound / 2) + 1)
    );

    for (let i = 0; i < matchupsInRound; i++) {
      const topPos = i * 2;
      const bottomPos = i * 2 + 1;

      const winnerTo =
        lbRound < lbRounds
          ? `L-${actualRound + 1}-${Math.floor(i / 2)}`
          : `GF-${totalRounds}-0`;

      slots.push({
        round: actualRound,
        position: topPos,
        team_id: null,
        seed: null,
        game_id: null,
        winner_to: winnerTo,
      });

      slots.push({
        round: actualRound,
        position: bottomPos,
        team_id: null,
        seed: null,
        game_id: null,
        winner_to: winnerTo,
      });
    }
  }

  // --- Grand Final ---
  slots.push({
    round: totalRounds,
    position: 0,
    team_id: null,
    seed: null,
    game_id: null,
    winner_to: null,
  });

  slots.push({
    round: totalRounds,
    position: 1,
    team_id: null,
    seed: null,
    game_id: null,
    winner_to: null,
  });

  return { slots, totalRounds };
}
