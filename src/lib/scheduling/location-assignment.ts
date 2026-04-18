import type { PreferenceApplied } from "@/lib/types";
import { formatYMD } from "./date-utils";

export interface LocationCourtSlot {
  locationId: string;
  courtNum: number;
  locationName: string;
  totalCourts: number;
}

export interface LocationAssignableGame {
  home: string;
  away: string;
  scheduledAt: Date;
  venue: string | null;
  court: string | null;
  weekNumber: number;
  preferenceApplied?: PreferenceApplied | null;
  schedulingNotes?: string | null;
}

export interface LocationAssignedGame extends LocationAssignableGame {
  locationId: string;
  locationName: string;
  courtNum: number;
  totalCourts: number;
}

interface ComponentInfo {
  id: number;
  teamIds: Set<string>;
  games: LocationAssignableGame[];
  requiredByTime: Map<number, number>;
  earliestTime: number;
}

export function assignGamesToLocationCourtSlots(
  games: LocationAssignableGame[],
  courtSlots: LocationCourtSlot[],
  unavailByDate: Map<string, Set<string>>,
  teamDivisionIds: Map<string, string | null> = new Map()
): LocationAssignedGame[] {
  const gamesByDate = new Map<string, LocationAssignableGame[]>();
  for (const game of games) {
    const key = formatYMD(game.scheduledAt);
    const dateGames = gamesByDate.get(key) || [];
    dateGames.push(game);
    gamesByDate.set(key, dateGames);
  }

  const assigned: LocationAssignedGame[] = [];
  for (const [dateStr, dateGames] of gamesByDate) {
    const unavailableLocationIds = unavailByDate.get(dateStr) || new Set<string>();
    const availableSlots = courtSlots.filter((slot) => !unavailableLocationIds.has(slot.locationId));
    const slotsToUse = availableSlots.length > 0 ? availableSlots : courtSlots;
    assigned.push(...assignDateGames(dateGames, slotsToUse, teamDivisionIds));
  }

  return assigned;
}

function assignDateGames(
  dateGames: LocationAssignableGame[],
  slotsToUse: LocationCourtSlot[],
  teamDivisionIds: Map<string, string | null>
): LocationAssignedGame[] {
  const locationIds = unique(slotsToUse.map((slot) => slot.locationId));
  const slotsByLocation = new Map<string, LocationCourtSlot[]>();
  for (const slot of slotsToUse) {
    const slots = slotsByLocation.get(slot.locationId) || [];
    slots.push(slot);
    slotsByLocation.set(slot.locationId, slots);
  }
  for (const slots of slotsByLocation.values()) {
    slots.sort((a, b) => a.courtNum - b.courtNum);
  }

  const gamesByComponent = buildComponents(dateGames);
  const sortedComponents = [...gamesByComponent].sort((a, b) => {
    const requiredDiff = maxRequiredCourts(b) - maxRequiredCourts(a);
    if (requiredDiff !== 0) return requiredDiff;
    const sizeDiff = b.games.length - a.games.length;
    if (sizeDiff !== 0) return sizeDiff;
    return a.earliestTime - b.earliestTime;
  });

  const componentLocation = new Map<number, string>();
  const locationLoadByTime = new Map<string, Map<number, number>>();
  const locationTotalGames = new Map<string, number>();
  const divisionLocation = new Map<string, string>();

  for (const locationId of locationIds) {
    locationLoadByTime.set(locationId, new Map());
    locationTotalGames.set(locationId, 0);
  }

  for (const component of sortedComponents) {
    let bestLocationId: string | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const locationId of locationIds) {
      const capacity = slotsByLocation.get(locationId)?.length || 0;
      const loads = locationLoadByTime.get(locationId)!;
      let fits = true;
      for (const [time, required] of component.requiredByTime) {
        if ((loads.get(time) || 0) + required > capacity) {
          fits = false;
          break;
        }
      }
      if (!fits) continue;

      let score = 0;
      const componentDivisions = divisionsForComponent(component, teamDivisionIds);
      for (const divisionId of componentDivisions) {
        if (divisionLocation.get(divisionId) === locationId) score += 100;
      }
      score -= locationTotalGames.get(locationId) || 0;
      score -= capacity * 0.01;

      if (score > bestScore) {
        bestScore = score;
        bestLocationId = locationId;
      }
    }

    if (!bestLocationId) continue;

    componentLocation.set(component.id, bestLocationId);
    const loads = locationLoadByTime.get(bestLocationId)!;
    for (const [time, required] of component.requiredByTime) {
      loads.set(time, (loads.get(time) || 0) + required);
    }
    locationTotalGames.set(bestLocationId, (locationTotalGames.get(bestLocationId) || 0) + component.games.length);
    for (const divisionId of divisionsForComponent(component, teamDivisionIds)) {
      if (!divisionLocation.has(divisionId)) {
        divisionLocation.set(divisionId, bestLocationId);
      }
    }
  }

  const result: LocationAssignedGame[] = [];
  const assignedOriginals = new Set<LocationAssignableGame>();
  const usedCourtKeysByTime = new Map<number, Set<string>>();
  const teamLocation = new Map<string, string>();

  const componentByGame = new Map<LocationAssignableGame, ComponentInfo>();
  for (const component of gamesByComponent) {
    for (const game of component.games) {
      componentByGame.set(game, component);
    }
  }

  const sortedGames = [...dateGames].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  for (const game of sortedGames) {
    const component = componentByGame.get(game);
    const locationId = component ? componentLocation.get(component.id) : undefined;
    if (!locationId) continue;

    const slot = firstAvailableSlot(slotsByLocation.get(locationId) || [], game.scheduledAt.getTime(), usedCourtKeysByTime);
    if (!slot) continue;
    result.push(toAssignedGame(game, slot));
    assignedOriginals.add(game);
    markAssigned(game, slot, usedCourtKeysByTime, teamLocation);
  }

  for (const game of sortedGames) {
    if (assignedOriginals.has(game)) continue;

    const slot = bestFallbackSlot(
      game,
      slotsToUse,
      usedCourtKeysByTime,
      teamLocation,
      divisionLocation,
      teamDivisionIds
    );
    if (!slot) continue;
    result.push(toAssignedGame(game, slot));
    assignedOriginals.add(game);
    markAssigned(game, slot, usedCourtKeysByTime, teamLocation);
  }

  return result;
}

function buildComponents(games: LocationAssignableGame[]): ComponentInfo[] {
  const parent = new Map<string, string>();

  function find(teamId: string): string {
    if (!parent.has(teamId)) parent.set(teamId, teamId);
    const current = parent.get(teamId)!;
    if (current === teamId) return current;
    const root = find(current);
    parent.set(teamId, root);
    return root;
  }

  function union(a: string, b: string) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  }

  for (const game of games) {
    union(game.home, game.away);
  }

  const componentsByRoot = new Map<string, ComponentInfo>();
  let nextId = 1;
  for (const game of games) {
    const root = find(game.home);
    let component = componentsByRoot.get(root);
    if (!component) {
      component = {
        id: nextId++,
        teamIds: new Set<string>(),
        games: [],
        requiredByTime: new Map<number, number>(),
        earliestTime: game.scheduledAt.getTime(),
      };
      componentsByRoot.set(root, component);
    }
    const time = game.scheduledAt.getTime();
    component.teamIds.add(game.home);
    component.teamIds.add(game.away);
    component.games.push(game);
    component.requiredByTime.set(time, (component.requiredByTime.get(time) || 0) + 1);
    component.earliestTime = Math.min(component.earliestTime, time);
  }

  return [...componentsByRoot.values()];
}

function bestFallbackSlot(
  game: LocationAssignableGame,
  slotsToUse: LocationCourtSlot[],
  usedCourtKeysByTime: Map<number, Set<string>>,
  teamLocation: Map<string, string>,
  divisionLocation: Map<string, string>,
  teamDivisionIds: Map<string, string | null>
): LocationCourtSlot | null {
  let bestSlot: LocationCourtSlot | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  const time = game.scheduledAt.getTime();

  for (const slot of slotsToUse) {
    if (isSlotUsed(slot, time, usedCourtKeysByTime)) continue;

    let score = 0;
    const homeLocation = teamLocation.get(game.home);
    const awayLocation = teamLocation.get(game.away);
    if (homeLocation === slot.locationId) score += 1000;
    if (awayLocation === slot.locationId) score += 1000;
    if (homeLocation && homeLocation !== slot.locationId) score -= 500;
    if (awayLocation && awayLocation !== slot.locationId) score -= 500;

    const homeDivision = teamDivisionIds.get(game.home);
    const awayDivision = teamDivisionIds.get(game.away);
    if (homeDivision && homeDivision === awayDivision && divisionLocation.get(homeDivision) === slot.locationId) {
      score += 100;
    }

    score -= slot.courtNum * 0.01;

    if (score > bestScore) {
      bestScore = score;
      bestSlot = slot;
    }
  }

  return bestSlot;
}

function toAssignedGame(game: LocationAssignableGame, slot: LocationCourtSlot): LocationAssignedGame {
  return {
    ...game,
    locationId: slot.locationId,
    locationName: slot.locationName,
    courtNum: slot.courtNum,
    totalCourts: slot.totalCourts,
  };
}

function markAssigned(
  game: LocationAssignableGame,
  slot: LocationCourtSlot,
  usedCourtKeysByTime: Map<number, Set<string>>,
  teamLocation: Map<string, string>
) {
  const time = game.scheduledAt.getTime();
  const usedKeys = usedCourtKeysByTime.get(time) || new Set<string>();
  usedKeys.add(slotKey(slot));
  usedCourtKeysByTime.set(time, usedKeys);
  teamLocation.set(game.home, slot.locationId);
  teamLocation.set(game.away, slot.locationId);
}

function firstAvailableSlot(
  slots: LocationCourtSlot[],
  time: number,
  usedCourtKeysByTime: Map<number, Set<string>>
): LocationCourtSlot | null {
  for (const slot of slots) {
    if (!isSlotUsed(slot, time, usedCourtKeysByTime)) return slot;
  }
  return null;
}

function isSlotUsed(
  slot: LocationCourtSlot,
  time: number,
  usedCourtKeysByTime: Map<number, Set<string>>
): boolean {
  return usedCourtKeysByTime.get(time)?.has(slotKey(slot)) || false;
}

function slotKey(slot: LocationCourtSlot): string {
  return `${slot.locationId}:${slot.courtNum}`;
}

function maxRequiredCourts(component: ComponentInfo): number {
  return Math.max(...component.requiredByTime.values());
}

function divisionsForComponent(
  component: ComponentInfo,
  teamDivisionIds: Map<string, string | null>
): Set<string> {
  const divisions = new Set<string>();
  for (const teamId of component.teamIds) {
    const divisionId = teamDivisionIds.get(teamId);
    if (divisionId) divisions.add(divisionId);
  }
  return divisions;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
