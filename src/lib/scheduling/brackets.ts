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
      loser_to: null,
    });

    slots.push({
      round: 1,
      position: bottomPos,
      team_id: bottomStanding?.team_id ?? null,
      seed: bottomSeed <= numTeams ? bottomSeed : null,
      game_id: null,
      winner_to: totalRounds > 1 ? `W-2-${nextRoundPos}` : null,
      loser_to: null,
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
        loser_to: null,
      });

      slots.push({
        round,
        position: bottomPos,
        team_id: null,
        seed: null,
        game_id: null,
        winner_to: winnerTo,
        loser_to: null,
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
//
// Structure for 4 teams (bracketSize=4, wbRounds=2):
//   WB R1 (2 matches) → WB R2 (1 match = WB Final)
//   LB R1 (1 match: losers of WB R1) → LB R2 (1 match: LB R1 winner vs loser of WB R2)
//   Grand Final (WB winner vs LB winner)
//
// loser_to on WB slots routes losers into the correct LB round.
// Odd LB rounds receive drop-downs from WB; even LB rounds are pure LB.
// ---------------------------------------------------------------------------

function generateDoubleElimination(
  standings: Standing[],
  teams: Team[],
  numTeams: number
): { slots: SlotData[]; totalRounds: number } {
  const bracketSize = nextPowerOf2(numTeams);
  const wbRounds = Math.log2(bracketSize);

  // LB has 2*(wbRounds-1) rounds for bracket sizes >=4
  // For 4 teams: 2 LB rounds. For 8 teams: 4 LB rounds.
  const lbRounds = Math.max(1, 2 * (wbRounds - 1));

  const slots: SlotData[] = [];
  const seededTeams = standings.slice(0, numTeams);
  const order = seedOrder(bracketSize);

  // We use a simple round numbering: WB rounds 1..wbRounds, then LB rounds
  // start at wbRounds+1, then Grand Final is last.
  const lbFirstRound = wbRounds + 1;
  const gfRound = lbFirstRound + lbRounds;

  // --- Winners Bracket Round 1 ---
  const firstRoundMatchups = bracketSize / 2;
  for (let i = 0; i < firstRoundMatchups; i++) {
    const topSeed = order[i * 2];
    const bottomSeed = order[i * 2 + 1];

    const topStanding = topSeed <= numTeams ? seededTeams[topSeed - 1] : null;
    const bottomStanding =
      bottomSeed <= numTeams ? seededTeams[bottomSeed - 1] : null;

    // Losers of WB R1 go to LB R1 (the first LB round)
    // LB R1 has bracketSize/4 matchups; WB R1 matchup i feeds LB R1 matchup floor(i/2)
    const loserTo = `L-${lbFirstRound}-${i}`;

    slots.push({
      round: 1,
      position: i * 2,
      team_id: topStanding?.team_id ?? null,
      seed: topSeed <= numTeams ? topSeed : null,
      game_id: null,
      winner_to: `W-2-${i}`,
      loser_to: loserTo,

    });

    slots.push({
      round: 1,
      position: i * 2 + 1,
      team_id: bottomStanding?.team_id ?? null,
      seed: bottomSeed <= numTeams ? bottomSeed : null,
      game_id: null,
      winner_to: `W-2-${i}`,
      loser_to: loserTo,

    });
  }

  // --- Winners Bracket Rounds 2..wbRounds ---
  for (let round = 2; round <= wbRounds; round++) {
    const matchupsInRound = bracketSize / Math.pow(2, round);
    // Which LB round do losers from this WB round drop into?
    // WB R2 losers → LB R2 (the second LB round), WB R3 losers → LB R4, etc.
    // Pattern: WB round R losers go to LB round 2*(R-1)
    const lbTargetRound = lbFirstRound + 2 * (round - 1) - 1;

    for (let i = 0; i < matchupsInRound; i++) {
      const nextRoundPos = Math.floor(i / 2);
      const winnerTo =
        round < wbRounds
          ? `W-${round + 1}-${nextRoundPos}`
          : `GF-${gfRound}-0`;

      const loserTo =
        lbTargetRound < gfRound ? `L-${lbTargetRound}-${i}` : null;

      slots.push({
        round,
        position: i * 2,
        team_id: null,
        seed: null,
        game_id: null,
        winner_to: winnerTo,
        loser_to: loserTo,
  
      });

      slots.push({
        round,
        position: i * 2 + 1,
        team_id: null,
        seed: null,
        game_id: null,
        winner_to: winnerTo,
        loser_to: loserTo,
  
      });
    }
  }

  // --- Losers Bracket ---
  // LB round structure (for bracketSize=4, wbRounds=2):
  //   LB R1: 1 match (WB R1 losers play each other)
  //   LB R2: 1 match (LB R1 winner vs WB R2 loser = LB Final)
  //
  // For bracketSize=8, wbRounds=3:
  //   LB R1: 2 matches (WB R1 losers)
  //   LB R2: 2 matches (LB R1 winners vs WB R2 losers)
  //   LB R3: 1 match (LB R2 winners play each other)
  //   LB R4: 1 match (LB R3 winner vs WB R3 loser = LB Final)
  //
  // Odd LB rounds: survivors play each other (halves the field)
  // Even LB rounds: survivors face WB drop-downs (field stays same)

  for (let lbRound = 1; lbRound <= lbRounds; lbRound++) {
    const actualRound = lbFirstRound + lbRound - 1;

    let matchupsInRound: number;
    if (lbRound === 1) {
      // First LB round: WB R1 losers pair up
      matchupsInRound = firstRoundMatchups; // Each WB R1 matchup sends one loser
    } else {
      // Odd LB rounds (3, 5, ...): halve previous round
      // Even LB rounds (2, 4, ...): same count as previous (absorbing WB drop-downs)
      if (lbRound % 2 === 0) {
        // Even: same matchup count as previous odd round (absorb WB dropdowns)
        matchupsInRound = Math.max(1, Math.ceil(firstRoundMatchups / Math.pow(2, Math.floor(lbRound / 2))));
      } else {
        // Odd: halve previous even round
        matchupsInRound = Math.max(1, Math.ceil(firstRoundMatchups / Math.pow(2, Math.floor(lbRound / 2))));
      }
    }

    for (let i = 0; i < matchupsInRound; i++) {
      const winnerTo =
        lbRound < lbRounds
          ? `L-${actualRound + 1}-${lbRound % 2 === 1 ? i : Math.floor(i / 2)}`
          : `GF-${gfRound}-0`;

      slots.push({
        round: actualRound,
        position: i * 2,
        team_id: null,
        seed: null,
        game_id: null,
        winner_to: winnerTo,
        loser_to: null, // losers bracket losers are eliminated

      });

      slots.push({
        round: actualRound,
        position: i * 2 + 1,
        team_id: null,
        seed: null,
        game_id: null,
        winner_to: winnerTo,
        loser_to: null,

      });
    }
  }

  // --- Grand Final ---
  slots.push({
    round: gfRound,
    position: 0,
    team_id: null,
    seed: null,
    game_id: null,
    winner_to: null,
    loser_to: null,

  });

  slots.push({
    round: gfRound,
    position: 1,
    team_id: null,
    seed: null,
    game_id: null,
    winner_to: null,
    loser_to: null,

  });

  // --- Handle byes in WB R1 ---
  // If one side of a WB R1 matchup has no team, auto-advance to WB R2
  // (no loser is generated for a bye)
  const wbR1Slots = slots.filter((s) => s.round === 1);
  const wbR2Slots = slots.filter((s) => s.round === 2);
  for (let i = 0; i < firstRoundMatchups; i++) {
    const topSlot = wbR1Slots[i * 2];
    const bottomSlot = wbR1Slots[i * 2 + 1];
    const topHas = topSlot.team_id !== null;
    const bottomHas = bottomSlot.team_id !== null;

    if (topHas && !bottomHas) {
      // Top team gets a bye — advance to WB R2
      if (wbR2Slots[i]) {
        wbR2Slots[i].team_id = topSlot.team_id;
        wbR2Slots[i].seed = topSlot.seed;
      }
    } else if (!topHas && bottomHas) {
      if (wbR2Slots[i]) {
        wbR2Slots[i].team_id = bottomSlot.team_id;
        wbR2Slots[i].seed = bottomSlot.seed;
      }
    }
  }

  return { slots, totalRounds: gfRound };
}
