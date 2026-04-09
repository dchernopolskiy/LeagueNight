import pg from "pg";

const client = new pg.Client({
  connectionString: process.argv[2],
  ssl: { rejectUnauthorized: false },
});

const tables = [
  "profiles", "leagues", "teams", "players", "game_day_patterns",
  "games", "rsvps", "sub_requests", "availability_checks",
  "league_fees", "payments", "messages", "standings", "notifications",
];

try {
  await client.connect();

  // Disable RLS on all tables for dev
  for (const table of tables) {
    await client.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
  }
  console.log("RLS disabled on all tables");

} catch (err) {
  console.error("Setup failed:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
