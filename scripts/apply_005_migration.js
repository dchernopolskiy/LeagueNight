const { Client } = require("pg");

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();
  const res = await client.query(
    "ALTER TABLE locations ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}'"
  );
  console.log("Migration applied:", res.command);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
