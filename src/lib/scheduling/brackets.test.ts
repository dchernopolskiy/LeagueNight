import { describe, expect, it } from "vitest";
import { generateBracket } from "./brackets";

function makeStandings(teamCount: number) {
  return Array.from({ length: teamCount }, (_, index) => ({
    id: `standing-${index + 1}`,
    league_id: "league-1",
    team_id: `team-${index + 1}`,
    games_played: 0,
    wins: 0,
    losses: 0,
    points_for: 0,
    points_against: 0,
    rank: index + 1,
    created_at: "",
    updated_at: "",
  }));
}

function makeTeams(teamCount: number) {
  return Array.from({ length: teamCount }, (_, index) => ({
    id: `team-${index + 1}`,
    league_id: "league-1",
    division_id: null,
    name: `Team ${index + 1}`,
    created_at: "",
    updated_at: "",
  }));
}

describe("generateBracket", () => {
  it("auto-advances single-elimination byes into round 2", () => {
    const { slots, totalRounds } = generateBracket({
      standings: makeStandings(6),
      teams: makeTeams(6),
      numTeams: 6,
      format: "single_elimination",
    });

    expect(totalRounds).toBe(3);

    const round2 = slots.filter((slot) => slot.round === 2);
    expect(round2.map((slot) => slot.team_id)).toEqual([
      "team-1",
      null,
      "team-2",
      null,
    ]);
  });

  it("wires 6-team double-elimination byes without sending phantom losers", () => {
    const { slots } = generateBracket({
      standings: makeStandings(6),
      teams: makeTeams(6),
      numTeams: 6,
      format: "double_elimination",
    });

    const winnersRound1 = slots.filter((slot) => slot.round === 1);
    const byePairs = [
      [winnersRound1[0], winnersRound1[1]],
      [winnersRound1[4], winnersRound1[5]],
    ];

    for (const [top, bottom] of byePairs) {
      expect([top.team_id, bottom.team_id].filter(Boolean)).toHaveLength(1);
      expect(top.loser_to).toBeNull();
      expect(bottom.loser_to).toBeNull();
    }

    const winnersRound2 = slots.filter((slot) => slot.round === 2);
    expect(winnersRound2.map((slot) => slot.team_id)).toEqual([
      "team-1",
      null,
      "team-2",
      null,
    ]);
  });
});
