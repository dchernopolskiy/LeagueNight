import {
  fillScheduleByWeek,
  type FillParams,
  type WeekFillResult,
} from "@/lib/scheduling/week-fill";

export type SchedulerMode = "greedy";

/**
 * Thin dispatcher so fixture tests can execute against the greedy engine.
 */
export async function runScheduler(
  mode: SchedulerMode,
  params: FillParams
): Promise<WeekFillResult> {
  if (mode === "greedy") {
    return fillScheduleByWeek(params);
  }
  throw new Error(`unknown scheduler mode: ${mode satisfies never}`);
}
