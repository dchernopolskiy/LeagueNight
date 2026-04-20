import {
  fillScheduleByWeek,
  type FillParams,
  type WeekFillResult,
} from "@/lib/scheduling/week-fill";
import { solveSchedule } from "@/lib/scheduling/solver";

export type SchedulerMode = "greedy" | "solver";

/**
 * Thin dispatcher so fixture tests can execute against either engine. The
 * greedy branch wraps fillScheduleByWeek. The solver branch wires into
 * solveSchedule once Phase 1/2 ILP models land; until then solveSchedule
 * throws so any solver fixture fails loudly rather than silently skipping.
 */
export async function runScheduler(
  mode: SchedulerMode,
  params: FillParams
): Promise<WeekFillResult> {
  if (mode === "greedy") {
    return fillScheduleByWeek(params);
  }
  if (mode === "solver") {
    return solveSchedule(params);
  }
  throw new Error(`unknown scheduler mode: ${mode satisfies never}`);
}
