import type { FillParams, WeekFillResult } from "./week-fill";

/**
 * ILP-based scheduler (two-phase). Phase 1 solves matchup-to-week assignment,
 * Phase 2 solves game-to-slot/location/court. Greedy remains the fallback
 * until this is fully tested.
 *
 * Not yet implemented — throws to make solver-mode test failures obvious
 * rather than silent.
 */
export async function solveSchedule(_params: FillParams): Promise<WeekFillResult> {
  throw new Error("solveSchedule not implemented yet");
}
