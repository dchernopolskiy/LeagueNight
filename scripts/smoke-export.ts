import { generateSchedulePdf } from "../src/lib/export/schedule-pdf";
import { exportLeagueScheduleXlsx } from "../src/lib/export/data-export";

const league: any = { id: "x", name: "Test / League", season_name: "S", season_start: null, season_end: null };
const teams: any[] = [
  { id: "t1", name: "A", color: null, captain_player_id: null },
  { id: "t2", name: "B", color: null, captain_player_id: null },
];
const games: any[] = [
  {
    id: "g1",
    home_team_id: "t1",
    away_team_id: "t2",
    scheduled_at: new Date().toISOString(),
    venue: "V",
    court: null,
    status: "scheduled",
    week_number: 1,
    home_score: null,
    away_score: null,
    is_playoff: false,
  },
];

try {
  const doc = generateSchedulePdf({ league, teams, players: [], games });
  console.log("PDF OK, pages:", doc.getNumberOfPages());
} catch (e: any) {
  console.error("PDF ERROR:", e?.message, e?.stack);
}

try {
  // Will call XLSX.writeFile which needs document/fs — likely throws in node.
  exportLeagueScheduleXlsx({ league, teams, games, filename: "/tmp/smoke.xlsx" });
  console.log("XLSX OK");
} catch (e: any) {
  console.error("XLSX ERROR:", e?.message);
}
