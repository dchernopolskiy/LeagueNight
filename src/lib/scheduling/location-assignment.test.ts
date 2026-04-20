import { describe, expect, it } from "vitest";
import {
  assignGamesToLocationCourtSlots,
  type LocationAssignableGame,
  type LocationCourtSlot,
} from "./location-assignment";

const baseDate = new Date("2026-01-05T19:15:00");

function game(
  home: string,
  away: string,
  minutesAfterStart: number
): LocationAssignableGame {
  const scheduledAt = new Date(baseDate);
  scheduledAt.setMinutes(scheduledAt.getMinutes() + minutesAfterStart);
  return {
    home,
    away,
    scheduledAt,
    venue: null,
    court: null,
    weekNumber: 1,
  };
}

describe("location assignment", () => {
  it("keeps a connected same-night team component at one location when capacity fits", () => {
    const slots: LocationCourtSlot[] = [
      { locationId: "reeves", courtNum: 1, locationName: "Reeves", totalCourts: 2 },
      { locationId: "reeves", courtNum: 2, locationName: "Reeves", totalCourts: 2 },
      { locationId: "marshall", courtNum: 1, locationName: "Marshall", totalCourts: 1 },
    ];
    const games = [
      game("sasa", "team-a", 0),
      game("crunchwrap", "team-b", 0),
      game("sasa", "crunchwrap", 45),
    ];

    const assigned = assignGamesToLocationCourtSlots(
      games,
      slots,
      new Map(),
      new Map([
        ["sasa", "A"],
        ["crunchwrap", "A"],
        ["team-a", "A"],
        ["team-b", "A"],
      ])
    );

    expect(assigned).toHaveLength(3);
    expect(new Set(assigned.map((g) => g.locationId))).toEqual(new Set(["reeves"]));
    const locationsByTeam = new Map<string, Set<string>>();
    for (const assignedGame of assigned) {
      for (const teamId of [assignedGame.home, assignedGame.away]) {
        const locations = locationsByTeam.get(teamId) || new Set<string>();
        locations.add(assignedGame.locationId);
        locationsByTeam.set(teamId, locations);
      }
    }
    for (const locations of locationsByTeam.values()) {
      expect(locations.size).toBe(1);
    }
  });
});
