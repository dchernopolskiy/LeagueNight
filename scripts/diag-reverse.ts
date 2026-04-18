import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.split("=", 2) as [string, string])
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data: leagues } = await supabase.from("leagues").select("id, name").ilike("name", "%Reverse%Mon%");
  console.log("Leagues:", leagues);
  if (!leagues?.length) return;
  const leagueId = leagues[0].id;
  const [{ data: teams }, { data: divs }, { data: patterns }, { data: games }] = await Promise.all([
    supabase.from("teams").select("id, name, division_id").eq("league_id", leagueId),
    supabase.from("divisions").select("id, name").eq("league_id", leagueId),
    supabase.from("game_day_patterns").select("*").eq("league_id", leagueId),
    supabase.from("games").select("week_number").eq("league_id", leagueId).eq("is_playoff", false).eq("status", "scheduled"),
  ]);
  const divMap = new Map((divs || []).map((d: any) => [d.id, d.name]));
  const byDiv = new Map<string, number>();
  for (const t of teams || []) {
    const name = divMap.get(t.division_id) || "none";
    byDiv.set(name, (byDiv.get(name) || 0) + 1);
  }
  console.log("Teams per division:", Object.fromEntries(byDiv));
  for (const p of patterns || []) {
    console.log("Pattern:", {
      day_of_week: p.day_of_week,
      start_time: p.start_time,
      end_time: p.end_time,
      duration_minutes: p.duration_minutes,
      court_count: p.court_count,
      location_ids: p.location_ids,
      games_per_session: p.games_per_session,
      matchup_frequency: p.matchup_frequency,
      mix_divisions: p.mix_divisions,
      starts_on: p.starts_on,
      ends_on: p.ends_on,
      skip_dates: p.skip_dates,
    });
  }
  const weeks = new Set((games || []).map((g: any) => g.week_number));
  console.log("Weeks with games:", [...weeks].sort((a, b) => a - b), "total games:", games?.length);

  const withPrefs = (teams || []).filter((t: any) => t.preferences && Object.keys(t.preferences).length > 0);
  console.log(`Teams with preferences: ${withPrefs.length}`);
  for (const t of withPrefs.slice(0, 20)) {
    console.log(`  ${t.name}: ${JSON.stringify(t.preferences)}`);
  }

  if (patterns?.[0]?.location_ids?.length) {
    const { data: locs } = await supabase
      .from("locations")
      .select("id, name, court_count")
      .in("id", patterns[0].location_ids);
    console.log("Locations:", locs);
    const { data: un } = await supabase
      .from("location_unavailability")
      .select("*")
      .in("location_id", patterns[0].location_ids);
    console.log("Unavailability rows:", un);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
