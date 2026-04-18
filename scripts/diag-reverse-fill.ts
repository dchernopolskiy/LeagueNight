import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fillScheduleByWeek, schedulePreflight } from "../src/lib/scheduling/week-fill";
import { parseLocalDate } from "../src/lib/scheduling/date-utils";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.split("=", 2) as [string, string])
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const leagueId = "66832234-b0e5-4848-83bf-867acb870c5e";
  const [{ data: teams }, { data: divs }, { data: patterns }, { data: crossPlay }] =
    await Promise.all([
      supabase.from("teams").select("id, name, division_id, preferences").eq("league_id", leagueId),
      supabase.from("divisions").select("id, name").eq("league_id", leagueId),
      supabase.from("game_day_patterns").select("*").eq("league_id", leagueId),
      supabase.from("division_cross_play").select("*").eq("league_id", leagueId),
    ]);
  const p = patterns![0];
  const totalCourts = 7;
  const patternObj = {
    dayOfWeek: p.day_of_week,
    startTime: p.start_time.slice(0, 5),
    endTime: p.end_time ? p.end_time.slice(0, 5) : null,
    venue: null,
    courtCount: totalCourts,
    startsOn: parseLocalDate(p.starts_on),
    endsOn: null,
    durationMinutes: p.duration_minutes,
    skipDates: p.skip_dates,
  };
  const weekFillTeams = teams!.map((t: any) => ({
    id: t.id,
    name: t.name,
    division_id: t.division_id,
    preferences: t.preferences,
  }));
  const teamsMap = new Map(teams!.map((t: any) => [t.id, { id: t.id, name: t.name, preferences: t.preferences }]));

  const preflight = schedulePreflight(weekFillTeams, patternObj, {
    matchupFrequency: p.matchup_frequency,
    gamesPerSession: p.games_per_session,
  }, divs || []);
  console.log("preflight:", preflight);

  const result = fillScheduleByWeek({
    teams: weekFillTeams,
    pattern: patternObj,
    opts: {
      matchupFrequency: p.matchup_frequency,
      gamesPerSession: p.games_per_session,
      allowCrossPlay: p.mix_divisions,
      crossPlayRules: crossPlay || [],
      acceptTruncation: true,
    },
    teamsMap: teamsMap as any,
  });

  console.log("games scheduled:", result.games.length);
  console.log("targetWeeks:", result.targetWeeks);
  console.log("dropped pairs:", result.droppedPairs.length);
  for (const d of result.droppedPairs) {
    const a = teams!.find((t: any) => t.id === d.teamA);
    const b = teams!.find((t: any) => t.id === d.teamB);
    console.log("  ", a?.name, "vs", b?.name, "—", d.reason);
  }

  // Per-team games + byes
  const gp = new Map<string, number>();
  for (const g of result.games) {
    gp.set(g.home, (gp.get(g.home) || 0) + 1);
    gp.set(g.away, (gp.get(g.away) || 0) + 1);
  }
  const divName = new Map((divs || []).map((d: any) => [d.id, d.name]));
  const byDiv = new Map<string, { total: number; count: number; min: number; max: number }>();
  for (const t of teams || []) {
    const games = gp.get(t.id) || 0;
    const dn = divName.get((t as any).division_id) || "none";
    const cur = byDiv.get(dn) || { total: 0, count: 0, min: 99, max: 0 };
    cur.total += games;
    cur.count += 1;
    if (games < cur.min) cur.min = games;
    if (games > cur.max) cur.max = games;
    byDiv.set(dn, cur);
  }
  console.log("\nGames per team by division:");
  for (const [dn, s] of byDiv) {
    console.log(`  ${dn}: ${(s.total / s.count).toFixed(1)} avg (min ${s.min}, max ${s.max}, ${s.count} teams)`);
  }

  // By week counts
  const byWeek = new Map<number, number>();
  for (const g of result.games) {
    byWeek.set(g.weekNumber, (byWeek.get(g.weekNumber) || 0) + 1);
  }
  console.log("\nGames per week:", [...byWeek.entries()].sort().map(([w, n]) => `${w}=${n}`).join(", "));
  console.log("\nByes:", result.byes.length, "back-to-back:", result.byes.filter((b: any) => b.backToBack).length);

  // B+ pair coverage
  const bplusId = 'fa2a6c8d-ccd8-432a-a704-76c3352fb877';
  const bplus = new Set(teams!.filter((t: any) => t.division_id === bplusId).map((t: any) => t.id));
  const pairCount = new Map<string, number>();
  for (const g of result.games) {
    if (!bplus.has(g.home) || !bplus.has(g.away)) continue;
    const k = g.home < g.away ? `${g.home}|${g.away}` : `${g.away}|${g.home}`;
    pairCount.set(k, (pairCount.get(k) || 0) + 1);
  }
  const duplicates = [...pairCount.entries()].filter(([, n]) => n > 1);
  console.log(`\nB+ pairs played: ${pairCount.size} / 91 unique, ${duplicates.length} repeats`);
  for (const [k, n] of duplicates) {
    const [a, b] = k.split("|");
    const na = teams!.find((t: any) => t.id === a)?.name;
    const nb = teams!.find((t: any) => t.id === b)?.name;
    console.log(`  ${na} vs ${nb}: ${n} times`);
  }

  // B+ games where only ONE B+ team played (crossplay use)
  let bplusCross = 0;
  for (const g of result.games) {
    if (bplus.has(g.home) !== bplus.has(g.away)) bplusCross++;
  }
  console.log(`B+ crossplay games: ${bplusCross}`);

  // Per-week per-team games
  const perWeek = new Map<string, Map<number, number>>();
  for (const g of result.games) {
    for (const tid of [g.home, g.away]) {
      const m = perWeek.get(tid) || new Map();
      m.set(g.weekNumber, (m.get(g.weekNumber) || 0) + 1);
      perWeek.set(tid, m);
    }
  }
  console.log("\nA teams per-week games:");
  for (const t of teams!.filter((t: any) => divName.get(t.division_id) === 'REVERSE A MONDAYS')) {
    const m = perWeek.get(t.id) || new Map();
    console.log(`  ${t.name}: ${[1,2,3,4,5,6,7].map(w => m.get(w) || 0).join(' ')}`);
  }
  console.log("\nB teams per-week games:");
  for (const t of teams!.filter((t: any) => divName.get(t.division_id) === 'REVERSE B MONDAYS')) {
    const m = perWeek.get(t.id) || new Map();
    console.log(`  ${t.name}: ${[1,2,3,4,5,6,7].map(w => m.get(w) || 0).join(' ')}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
