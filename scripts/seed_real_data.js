const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL });

const ORGANIZER_ID = '8d560e83-ac34-43f7-98a7-21d06c416cc0';

// Helper: generate slug from league name
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-spring-2026';
}

// Helper: generate 6 fake player names for a team
function fakePlayers(teamName) {
  const firstNames = ['Alex', 'Jordan', 'Casey', 'Morgan', 'Riley', 'Taylor', 'Drew', 'Jamie', 'Quinn', 'Avery', 'Cameron', 'Dakota', 'Emerson', 'Finley', 'Harper', 'Reese', 'Sage', 'Logan', 'Ellis', 'Rowan', 'River', 'Blake', 'Skyler', 'Kai', 'Jaden', 'Peyton', 'Hayden', 'Charlie', 'Frankie', 'Lennon'];
  const lastNames = ['Kim', 'Lee', 'Park', 'Chen', 'Wu', 'Cho', 'Nguyen', 'Tran', 'Davis', 'Hall', 'Torres', 'Johnson', 'Brown', 'Clark', 'White', 'Green', 'Miller', 'Garcia', 'Lopez', 'Martinez', 'Santos', 'Costa', 'Shah', 'Patel', 'Ahmed', 'Cruz', 'Diaz', 'Ramos', 'Evans', 'Foster'];
  const used = new Set();
  const players = [];
  for (let i = 0; i < 6; i++) {
    let name;
    do {
      const f = firstNames[Math.floor(Math.random() * firstNames.length)];
      const l = lastNames[Math.floor(Math.random() * lastNames.length)];
      name = `${f} ${l}`;
    } while (used.has(name));
    used.add(name);
    players.push(name);
  }
  return players;
}

// All volleyball leagues with real data
const VOLLEYBALL_LEAGUES = [
  {
    name: 'Reverse Mondays',
    day: 'Monday',
    dayOfWeek: 1,
    divisions: [
      {
        name: 'A',
        level: 0,
        teams: [
          { name: 'Mak Attack', wins: null, losses: null },
          { name: 'Toon Squad', wins: 4, losses: 0 },
          { name: 'Cinnabuns', wins: 3, losses: 1 },
          { name: 'Boom Boom Boom', wins: 1, losses: 3 },
          { name: 'Malosi', wins: 0, losses: 4 },
        ],
      },
      {
        name: 'B/B+',
        level: 1,
        teams: [
          { name: 'Crunchwrap Supreme', wins: 4, losses: 0 },
          { name: 'Obvious Approach', wins: 4, losses: 0 },
          { name: 'Blazing Bombers LMMR', wins: 4, losses: 0 },
          { name: 'Good Vibes', wins: 3, losses: 1 },
          { name: 'Hidden Volley Ranch', wins: 3, losses: 1 },
          { name: 'Sneak Attack', wins: 3, losses: 1 },
          { name: "S'Mores & Missed Scores", wins: 3, losses: 1 },
          { name: 'Kaya', wins: 2, losses: 2 },
          { name: 'BTA', wins: 2, losses: 2 },
          { name: 'Balls Balls Balls', wins: 2, losses: 2 },
          { name: 'Acronyms', wins: 2, losses: 2 },
          { name: 'TBD', wins: 0, losses: 4 },
          { name: 'SASA', wins: 0, losses: 4 },
          { name: 'Canadian Geese Advisory', wins: 0, losses: 4 },
          { name: 'GGC', wins: 0, losses: 4 },
          { name: 'Cow Tippers', wins: 0, losses: 4 },
          { name: 'Serve Aces', wins: null, losses: null },
          { name: 'Iditos', wins: null, losses: null },
        ],
      },
    ],
  },
  {
    name: 'C Major Tuesdays',
    day: 'Tuesday',
    dayOfWeek: 2,
    divisions: [
      {
        name: 'Division 1',
        level: 0,
        teams: [
          { name: 'Notorious DIG', wins: 4, losses: 0 },
          { name: 'Tornado', wins: 4, losses: 0 },
          { name: 'Set It and Regret It', wins: 4, losses: 0 },
          { name: 'Pipe Dream', wins: 3, losses: 1 },
          { name: 'Pump It Up', wins: 3, losses: 1 },
          { name: 'The Volley Llamas', wins: 3, losses: 1 },
          { name: "That's What She Set", wins: 2, losses: 2 },
          { name: 'BFT', wins: 1, losses: 3 },
          { name: 'Fury', wins: 1, losses: 3 },
          { name: 'Mothers of Mayhem', wins: 1, losses: 3 },
          { name: 'Diving Ducks', wins: 0, losses: 4 },
          { name: 'Seagull Smash', wins: 0, losses: 4 },
          { name: 'Taterbugs', wins: 0, losses: 4 },
        ],
      },
    ],
  },
  {
    name: 'Women\'s Wednesdays',
    day: 'Wednesday',
    dayOfWeek: 3,
    divisions: [
      {
        name: 'B/C',
        level: 0,
        teams: [
          { name: 'Sweaty & Ready', wins: 4, losses: 0 },
          { name: 'Flatballerz 4 Lyfe', wins: 4, losses: 0 },
          { name: 'Win or Booze', wins: 3, losses: 1 },
          { name: 'Tight Aces', wins: 3, losses: 1 },
          { name: 'Fourceful Chaos', wins: 3, losses: 1 },
          { name: 'Hidden Volley Ranch', wins: 3, losses: 1 },
          { name: 'Orville Redenblocker', wins: 1, losses: 3 },
          { name: "Don't Stop Believing", wins: 1, losses: 3 },
          { name: 'Holy Blockamole!!', wins: 0, losses: 4 },
          { name: 'Donkey Dominators', wins: 0, losses: 4 },
          { name: 'Gold Diggers', wins: 0, losses: 4 },
        ],
      },
      {
        name: 'A/B',
        level: 1,
        teams: [
          { name: 'Bump Bump Goose', wins: 4, losses: 0 },
          { name: 'Olympians', wins: 4, losses: 0 },
          { name: 'Sets and the City', wins: 2, losses: 2 },
          { name: 'Chewblocka', wins: 2, losses: 2 },
          { name: 'Spike Me Up', wins: 1, losses: 3 },
          { name: 'Serve Aces', wins: 1, losses: 3 },
          { name: 'Johnston', wins: 1, losses: 3 },
          { name: 'Kiss My Pass', wins: 1, losses: 3 },
          { name: 'Holy Blockamole', wins: null, losses: null },
          { name: 'Block Party', wins: null, losses: null },
          { name: 'Pancakes', wins: null, losses: null },
          { name: 'Uh Oh', wins: null, losses: null },
          { name: 'Hits & Giggles', wins: null, losses: null },
        ],
      },
    ],
  },
  {
    name: 'B Thursdays',
    day: 'Thursday',
    dayOfWeek: 4,
    divisions: [
      {
        name: 'B Major',
        level: 0,
        teams: [
          { name: 'Spike Me Up', wins: 3, losses: 1 },
          { name: 'Squirtis', wins: 3, losses: 1 },
          { name: 'Wiggle', wins: 3, losses: 1 },
          { name: 'Funtastic 4', wins: 3, losses: 1 },
          { name: 'Nuricanes', wins: 3, losses: 1 },
          { name: 'Bump Set Psych', wins: 2, losses: 2 },
          { name: 'Popup Blockers', wins: 2, losses: 2 },
          { name: 'Spike Nation', wins: 1, losses: 3 },
          { name: 'The Inconsistents', wins: 0, losses: 4 },
        ],
      },
      {
        name: 'B League',
        level: 1,
        teams: [
          { name: 'MVP', wins: 4, losses: 0 },
          { name: "Crazy 88's", wins: 4, losses: 0 },
          { name: 'Joust the Tip', wins: 3, losses: 1 },
          { name: 'Skibidi Block Bureau of Ohio', wins: 1, losses: 3 },
          { name: 'Crawford Services', wins: 0, losses: 4 },
          { name: 'Notorious DIG', wins: 0, losses: 4 },
          { name: 'True Grace Lions', wins: 0, losses: 4 },
          { name: 'Court Jesters', wins: null, losses: null },
          { name: 'Tips Appreciated', wins: null, losses: null },
          { name: 'True Grace Eagles', wins: null, losses: null },
          { name: 'Flying Monkeys', wins: null, losses: null },
          { name: 'Damons Pack', wins: null, losses: null },
          { name: 'Back That Pass Up', wins: null, losses: null },
          { name: 'Feral Four', wins: null, losses: null },
          { name: 'True Grace Wolves', wins: null, losses: null },
          { name: 'Empire Spikes Back', wins: null, losses: null },
          { name: 'Ace Up', wins: null, losses: null },
        ],
      },
    ],
  },
];

const BASKETBALL_LEAGUES = [
  {
    name: 'Thursday Night Hoops',
    day: 'Thursday',
    dayOfWeek: 4,
    divisions: [
      {
        name: 'Competitive',
        level: 0,
        teams: [
          { name: 'Rim Reapers', wins: 3, losses: 1 },
          { name: 'Fadeaway Kings', wins: 2, losses: 2 },
          { name: 'Downtown Buckets', wins: 2, losses: 2 },
          { name: 'Glass Cleaners', wins: 1, losses: 3 },
        ],
      },
      {
        name: 'Rec',
        level: 1,
        teams: [
          { name: 'Air Ballers', wins: 4, losses: 0 },
          { name: 'Brick City', wins: 2, losses: 2 },
          { name: 'Turnover Machines', wins: 1, losses: 3 },
          { name: 'Bench Mob', wins: 1, losses: 3 },
        ],
      },
    ],
  },
  {
    name: 'Sunday League',
    day: 'Sunday',
    dayOfWeek: 0,
    divisions: [
      {
        name: 'Open',
        level: 0,
        teams: [
          { name: 'Full Court Press', wins: 4, losses: 0 },
          { name: 'Swish Squad', wins: 3, losses: 1 },
          { name: 'Dunk Dynasty', wins: 2, losses: 2 },
          { name: 'Half Court Heaves', wins: 2, losses: 2 },
          { name: 'Layup Legends', wins: 1, losses: 3 },
          { name: 'Shot Clock Violators', wins: 0, losses: 4 },
        ],
      },
    ],
  },
];

const PICKLEBALL_LEAGUES = [
  {
    name: 'Olympia Pickleball Open',
    day: 'Saturday',
    dayOfWeek: 6,
    divisions: [
      {
        name: 'Open',
        level: 0,
        teams: [
          { name: 'Dink Dynasty', wins: 3, losses: 1 },
          { name: 'Kitchen Nightmares', wins: 3, losses: 1 },
          { name: 'Paddle Poppers', wins: 1, losses: 3 },
          { name: 'Net Gainers', wins: 1, losses: 3 },
        ],
      },
      {
        name: 'Intermediate',
        level: 1,
        teams: [
          { name: 'Third Shot Droppers', wins: 4, losses: 0 },
          { name: 'Pickle Juice', wins: 2, losses: 2 },
          { name: 'Brine Time', wins: 1, losses: 3 },
          { name: 'Volley Dollies', wins: 1, losses: 3 },
        ],
      },
    ],
  },
];

// Generate games for ALL teams in a division.
// Teams with W-L records get completed games matching those records.
// ALL teams (including those without records) get upcoming scheduled games.
function generateGamesForDivision(teamsWithIds, leagueId, venues, dayOfWeek) {
  const games = [];
  if (teamsWithIds.length < 2) return games;

  const teamsWithRecords = teamsWithIds.filter(t => t.wins !== null);
  const completedPairs = new Set();

  // --- Phase 1: Generate completed games for teams with existing W-L records ---
  if (teamsWithRecords.length >= 2) {
    const sorted = [...teamsWithRecords].sort((a, b) => (b.wins - a.wins) || (a.losses - b.losses));
    const winsNeeded = {};
    const lossesNeeded = {};
    for (const t of sorted) {
      winsNeeded[t.id] = t.wins;
      lossesNeeded[t.id] = t.losses;
    }

    for (const winner of sorted) {
      while (winsNeeded[winner.id] > 0) {
        let loser = null;
        for (const candidate of [...sorted].reverse()) {
          if (candidate.id === winner.id) continue;
          const pairKey = [winner.id, candidate.id].sort().join('-');
          if (completedPairs.has(pairKey)) continue;
          if (lossesNeeded[candidate.id] > 0) {
            loser = candidate;
            break;
          }
        }
        if (!loser) break;

        const pairKey = [winner.id, loser.id].sort().join('-');
        completedPairs.add(pairKey);
        winsNeeded[winner.id]--;
        lossesNeeded[loser.id]--;

        const weekNum = Math.min(4, games.length % 4 + 1);
        const gameDate = new Date('2026-04-06');
        const currentDay = gameDate.getDay();
        const daysToAdd = (dayOfWeek - currentDay + 7) % 7;
        gameDate.setDate(gameDate.getDate() + daysToAdd + (weekNum - 1) * 7);
        gameDate.setHours(19, 0, 0, 0);

        const venue = venues[Math.floor(Math.random() * venues.length)];
        const winScore = 2;
        const loseScore = Math.random() > 0.5 ? 1 : 0;
        const isHome = Math.random() > 0.5;

        games.push({
          league_id: leagueId,
          home_team_id: isHome ? winner.id : loser.id,
          away_team_id: isHome ? loser.id : winner.id,
          scheduled_at: gameDate.toISOString(),
          venue,
          status: 'completed',
          home_score: isHome ? winScore : loseScore,
          away_score: isHome ? loseScore : winScore,
          week_number: weekNum,
        });
      }
    }
  }

  // --- Phase 2: Generate upcoming scheduled games for ALL teams ---
  // Round-robin style: every team should have at least a few upcoming games
  const allPairs = [];
  for (let i = 0; i < teamsWithIds.length; i++) {
    for (let j = i + 1; j < teamsWithIds.length; j++) {
      const pairKey = [teamsWithIds[i].id, teamsWithIds[j].id].sort().join('-');
      if (!completedPairs.has(pairKey)) {
        allPairs.push([teamsWithIds[i], teamsWithIds[j]]);
      }
    }
  }
  // Shuffle pairs for variety
  for (let i = allPairs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allPairs[i], allPairs[j]] = [allPairs[j], allPairs[i]];
  }

  // Schedule enough upcoming games so every team has at least 2-3 upcoming
  const teamUpcomingCount = {};
  for (const t of teamsWithIds) teamUpcomingCount[t.id] = 0;
  const minUpcoming = 2;
  let weekOffset = 0;

  for (const [teamA, teamB] of allPairs) {
    if (teamUpcomingCount[teamA.id] >= minUpcoming + 1 && teamUpcomingCount[teamB.id] >= minUpcoming + 1) continue;

    const weekNum = 5 + weekOffset;
    const gameDate = new Date('2026-04-06');
    const currentDay = gameDate.getDay();
    const daysToAdd = (dayOfWeek - currentDay + 7) % 7;
    gameDate.setDate(gameDate.getDate() + daysToAdd + (weekNum - 1) * 7);
    gameDate.setHours(19, 0, 0, 0);

    const venue = venues[Math.floor(Math.random() * venues.length)];
    games.push({
      league_id: leagueId,
      home_team_id: teamA.id,
      away_team_id: teamB.id,
      scheduled_at: gameDate.toISOString(),
      venue,
      status: 'scheduled',
      home_score: null,
      away_score: null,
      week_number: weekNum,
    });
    teamUpcomingCount[teamA.id]++;
    teamUpcomingCount[teamB.id]++;
    weekOffset = (weekOffset + 1) % 8; // spread across 8 weeks
  }

  return games;
}

async function seed() {
  await c.connect();
  console.log('Connected to database.');

  // 1. Delete all existing data for this organizer
  console.log('\n--- Cleaning existing data for organizer ---');

  // Get all league IDs for this organizer
  const existingLeagues = await c.query(
    'SELECT id FROM leagues WHERE organizer_id = $1', [ORGANIZER_ID]
  );
  const leagueIds = existingLeagues.rows.map(r => r.id);

  if (leagueIds.length > 0) {
    const idList = leagueIds.map((_, i) => `$${i + 1}`).join(', ');

    // Delete in dependency order
    await c.query(`DELETE FROM bracket_slots WHERE bracket_id IN (SELECT id FROM brackets WHERE league_id IN (${idList}))`, leagueIds);
    await c.query(`DELETE FROM brackets WHERE league_id IN (${idList})`, leagueIds);
    await c.query(`DELETE FROM standings WHERE league_id IN (${idList})`, leagueIds);
    await c.query(`DELETE FROM rsvps WHERE game_id IN (SELECT id FROM games WHERE league_id IN (${idList}))`, leagueIds);
    await c.query(`DELETE FROM availability_checks WHERE league_id IN (${idList})`, leagueIds);
    await c.query(`DELETE FROM sub_requests WHERE game_id IN (SELECT id FROM games WHERE league_id IN (${idList}))`, leagueIds);
    await c.query(`DELETE FROM games WHERE league_id IN (${idList})`, leagueIds);
    await c.query(`DELETE FROM messages WHERE league_id IN (${idList})`, leagueIds);
    await c.query(`DELETE FROM payments WHERE player_id IN (SELECT id FROM players WHERE league_id IN (${idList}))`, leagueIds);
    await c.query(`DELETE FROM league_fees WHERE league_id IN (${idList})`, leagueIds);
    // Unset captain before deleting players
    await c.query(`UPDATE teams SET captain_player_id = NULL WHERE league_id IN (${idList})`, leagueIds);
    await c.query(`DELETE FROM players WHERE league_id IN (${idList})`, leagueIds);
    await c.query(`DELETE FROM game_day_patterns WHERE league_id IN (${idList})`, leagueIds);
    await c.query(`DELETE FROM divisions WHERE league_id IN (${idList})`, leagueIds);
    await c.query(`DELETE FROM teams WHERE league_id IN (${idList})`, leagueIds);
    await c.query(`DELETE FROM leagues WHERE id IN (${idList})`, leagueIds);

    console.log(`Deleted ${leagueIds.length} existing leagues and all related data.`);
  } else {
    console.log('No existing leagues found.');
  }

  // 2. Check for existing locations
  console.log('\n--- Checking locations ---');
  const existingLocations = await c.query(
    'SELECT id, name FROM locations WHERE organizer_id = $1', [ORGANIZER_ID]
  );
  console.log('Existing locations:', existingLocations.rows.map(r => r.name));

  const locationMap = {};
  for (const loc of existingLocations.rows) {
    locationMap[loc.name.toLowerCase()] = loc.id;
  }

  // Create Reeves and Marshall if they don't exist
  const venues = ['Reeves Middle School', 'Marshall Middle School'];
  for (const venueName of venues) {
    if (!locationMap[venueName.toLowerCase()]) {
      const res = await c.query(
        `INSERT INTO locations (organizer_id, name, court_count) VALUES ($1, $2, 4) RETURNING id`,
        [ORGANIZER_ID, venueName]
      );
      locationMap[venueName.toLowerCase()] = res.rows[0].id;
      console.log(`Created location: ${venueName}`);
    } else {
      console.log(`Location already exists: ${venueName}`);
    }
  }

  // 3. Create volleyball leagues
  console.log('\n--- Creating Volleyball Leagues ---');
  for (const league of VOLLEYBALL_LEAGUES) {
    const slug = slugify(league.name);
    console.log(`\nCreating league: ${league.name} (${slug})`);

    const leagueRes = await c.query(`
      INSERT INTO leagues (organizer_id, name, slug, sport, season_name, season_start, season_end, settings, timezone, is_public)
      VALUES ($1, $2, $3, 'Volleyball', 'Spring 2026', '2026-04-06', '2026-06-29',
        '{"scoring_mode": "sets", "sets_to_win": 2}', 'America/Los_Angeles', true)
      RETURNING id
    `, [ORGANIZER_ID, league.name, slug]);
    const leagueId = leagueRes.rows[0].id;

    for (const div of league.divisions) {
      console.log(`  Division: ${div.name}`);
      const divRes = await c.query(
        'INSERT INTO divisions (league_id, name, level) VALUES ($1, $2, $3) RETURNING id',
        [leagueId, div.name, div.level]
      );
      const divisionId = divRes.rows[0].id;

      const teamsWithIds = [];

      for (const team of div.teams) {
        const teamRes = await c.query(
          'INSERT INTO teams (league_id, name, division_id) VALUES ($1, $2, $3) RETURNING id',
          [leagueId, team.name, divisionId]
        );
        const teamId = teamRes.rows[0].id;

        // Create 6 players
        const players = fakePlayers(team.name);
        let captainId = null;
        for (let i = 0; i < players.length; i++) {
          const pRes = await c.query(
            'INSERT INTO players (league_id, team_id, name, is_sub) VALUES ($1, $2, $3, false) RETURNING id',
            [leagueId, teamId, players[i]]
          );
          if (i === 0) captainId = pRes.rows[0].id;
        }
        if (captainId) {
          await c.query('UPDATE teams SET captain_player_id = $1 WHERE id = $2', [captainId, teamId]);
        }

        teamsWithIds.push({ id: teamId, name: team.name, wins: team.wins, losses: team.losses });
      }

      // Generate games for teams with W-L records
      const games = generateGamesForDivision(teamsWithIds, leagueId, venues, league.dayOfWeek);
      for (const g of games) {
        const locationId = locationMap[g.venue.toLowerCase()] || null;
        await c.query(`
          INSERT INTO games (league_id, home_team_id, away_team_id, scheduled_at, venue, location_id, status, home_score, away_score, week_number)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [g.league_id, g.home_team_id, g.away_team_id, g.scheduled_at, g.venue, locationId, g.status, g.home_score, g.away_score, g.week_number]);
      }
      console.log(`    Created ${games.filter(g => g.status === 'completed').length} completed games, ${games.filter(g => g.status === 'scheduled').length} scheduled games`);
    }

    // Recalculate standings
    await c.query('SELECT recalculate_standings($1)', [leagueId]);
    console.log(`  Standings recalculated.`);
  }

  // 4. Create basketball leagues
  console.log('\n--- Creating Basketball Leagues ---');
  for (const league of BASKETBALL_LEAGUES) {
    const slug = slugify(league.name);
    console.log(`\nCreating league: ${league.name} (${slug})`);

    const leagueRes = await c.query(`
      INSERT INTO leagues (organizer_id, name, slug, sport, season_name, season_start, season_end, settings, timezone, is_public)
      VALUES ($1, $2, $3, 'Basketball', 'Spring 2026', '2026-04-06', '2026-06-29',
        '{"scoring_mode": "game"}', 'America/Los_Angeles', true)
      RETURNING id
    `, [ORGANIZER_ID, league.name, slug]);
    const leagueId = leagueRes.rows[0].id;

    for (const div of league.divisions) {
      console.log(`  Division: ${div.name}`);
      const divRes = await c.query(
        'INSERT INTO divisions (league_id, name, level) VALUES ($1, $2, $3) RETURNING id',
        [leagueId, div.name, div.level]
      );
      const divisionId = divRes.rows[0].id;

      const teamsWithIds = [];

      for (const team of div.teams) {
        const teamRes = await c.query(
          'INSERT INTO teams (league_id, name, division_id) VALUES ($1, $2, $3) RETURNING id',
          [leagueId, team.name, divisionId]
        );
        const teamId = teamRes.rows[0].id;

        const players = fakePlayers(team.name);
        let captainId = null;
        for (let i = 0; i < players.length; i++) {
          const pRes = await c.query(
            'INSERT INTO players (league_id, team_id, name, is_sub) VALUES ($1, $2, $3, false) RETURNING id',
            [leagueId, teamId, players[i]]
          );
          if (i === 0) captainId = pRes.rows[0].id;
        }
        if (captainId) {
          await c.query('UPDATE teams SET captain_player_id = $1 WHERE id = $2', [captainId, teamId]);
        }

        teamsWithIds.push({ id: teamId, name: team.name, wins: team.wins, losses: team.losses });
      }

      // Basketball games use point scores
      const teamsWithRecords = teamsWithIds.filter(t => t.wins !== null);
      const completedPairs = new Set();
      const bballGames = [];

      if (teamsWithRecords.length >= 2) {
        const sorted = [...teamsWithRecords].sort((a, b) => b.wins - a.wins);
        const winsNeeded = {};
        const lossesNeeded = {};
        for (const t of sorted) {
          winsNeeded[t.id] = t.wins;
          lossesNeeded[t.id] = t.losses;
        }

        for (const winner of sorted) {
          while (winsNeeded[winner.id] > 0) {
            let loser = null;
            for (const candidate of [...sorted].reverse()) {
              if (candidate.id === winner.id) continue;
              const pairKey = [winner.id, candidate.id].sort().join('-');
              if (completedPairs.has(pairKey)) continue;
              if (lossesNeeded[candidate.id] > 0) {
                loser = candidate;
                break;
              }
            }
            if (!loser) break;

            const pairKey = [winner.id, loser.id].sort().join('-');
            completedPairs.add(pairKey);
            winsNeeded[winner.id]--;
            lossesNeeded[loser.id]--;

            const weekNum = Math.min(4, bballGames.length % 4 + 1);
            const gameDate = new Date('2026-04-06');
            const currentDay = gameDate.getDay();
            const daysToAdd = (league.dayOfWeek - currentDay + 7) % 7;
            gameDate.setDate(gameDate.getDate() + daysToAdd + (weekNum - 1) * 7);
            gameDate.setHours(19, 0, 0, 0);

            const venue = venues[Math.floor(Math.random() * venues.length)];
            const winScore = 55 + Math.floor(Math.random() * 30);
            const loseScore = Math.max(30, winScore - 5 - Math.floor(Math.random() * 20));
            const isHome = Math.random() > 0.5;

            bballGames.push({
              league_id: leagueId,
              home_team_id: isHome ? winner.id : loser.id,
              away_team_id: isHome ? loser.id : winner.id,
              scheduled_at: gameDate.toISOString(),
              venue,
              status: 'completed',
              home_score: isHome ? winScore : loseScore,
              away_score: isHome ? loseScore : winScore,
              week_number: weekNum,
            });
          }
        }
      }

      // Upcoming games for ALL teams
      const allBballPairs = [];
      for (let i = 0; i < teamsWithIds.length; i++) {
        for (let j = i + 1; j < teamsWithIds.length; j++) {
          const pairKey = [teamsWithIds[i].id, teamsWithIds[j].id].sort().join('-');
          if (!completedPairs.has(pairKey)) allBballPairs.push([teamsWithIds[i], teamsWithIds[j]]);
        }
      }
      for (let i = allBballPairs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allBballPairs[i], allBballPairs[j]] = [allBballPairs[j], allBballPairs[i]];
      }
      const bballUpcoming = {};
      for (const t of teamsWithIds) bballUpcoming[t.id] = 0;
      let bballWeekOff = 0;
      for (const [tA, tB] of allBballPairs) {
        if (bballUpcoming[tA.id] >= 3 && bballUpcoming[tB.id] >= 3) continue;
        const weekNum = 5 + bballWeekOff;
        const gameDate = new Date('2026-04-06');
        const currentDay = gameDate.getDay();
        const daysToAdd = (league.dayOfWeek - currentDay + 7) % 7;
        gameDate.setDate(gameDate.getDate() + daysToAdd + (weekNum - 1) * 7);
        gameDate.setHours(19, 0, 0, 0);
        const venue = venues[Math.floor(Math.random() * venues.length)];
        bballGames.push({
          league_id: leagueId,
          home_team_id: tA.id,
          away_team_id: tB.id,
          scheduled_at: gameDate.toISOString(),
          venue,
          status: 'scheduled',
          home_score: null,
          away_score: null,
          week_number: weekNum,
        });
        bballUpcoming[tA.id]++;
        bballUpcoming[tB.id]++;
        bballWeekOff = (bballWeekOff + 1) % 8;
      }

      for (const g of bballGames) {
        const locationId = locationMap[g.venue.toLowerCase()] || null;
        await c.query(`
          INSERT INTO games (league_id, home_team_id, away_team_id, scheduled_at, venue, location_id, status, home_score, away_score, week_number)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [g.league_id, g.home_team_id, g.away_team_id, g.scheduled_at, g.venue, locationId, g.status, g.home_score, g.away_score, g.week_number]);
      }
      console.log(`    Created ${bballGames.filter(g => g.status === 'completed').length} completed, ${bballGames.filter(g => g.status === 'scheduled').length} scheduled games`);
    }

    await c.query('SELECT recalculate_standings($1)', [leagueId]);
    console.log(`  Standings recalculated.`);
  }

  // 5. Create pickleball leagues
  console.log('\n--- Creating Pickleball Leagues ---');
  for (const league of PICKLEBALL_LEAGUES) {
    const slug = slugify(league.name);
    console.log(`\nCreating league: ${league.name} (${slug})`);

    const leagueRes = await c.query(`
      INSERT INTO leagues (organizer_id, name, slug, sport, season_name, season_start, season_end, settings, timezone, is_public)
      VALUES ($1, $2, $3, 'Pickleball', 'Spring 2026', '2026-04-06', '2026-06-29',
        '{"scoring_mode": "game"}', 'America/Los_Angeles', true)
      RETURNING id
    `, [ORGANIZER_ID, league.name, slug]);
    const leagueId = leagueRes.rows[0].id;

    for (const div of league.divisions) {
      console.log(`  Division: ${div.name}`);
      const divRes = await c.query(
        'INSERT INTO divisions (league_id, name, level) VALUES ($1, $2, $3) RETURNING id',
        [leagueId, div.name, div.level]
      );
      const divisionId = divRes.rows[0].id;

      const teamsWithIds = [];

      for (const team of div.teams) {
        const teamRes = await c.query(
          'INSERT INTO teams (league_id, name, division_id) VALUES ($1, $2, $3) RETURNING id',
          [leagueId, team.name, divisionId]
        );
        const teamId = teamRes.rows[0].id;

        const players = fakePlayers(team.name);
        let captainId = null;
        for (let i = 0; i < players.length; i++) {
          const pRes = await c.query(
            'INSERT INTO players (league_id, team_id, name, is_sub) VALUES ($1, $2, $3, false) RETURNING id',
            [leagueId, teamId, players[i]]
          );
          if (i === 0) captainId = pRes.rows[0].id;
        }
        if (captainId) {
          await c.query('UPDATE teams SET captain_player_id = $1 WHERE id = $2', [captainId, teamId]);
        }

        teamsWithIds.push({ id: teamId, name: team.name, wins: team.wins, losses: team.losses });
      }

      // Pickleball games - similar to basketball with game scores
      const teamsWithRecords = teamsWithIds.filter(t => t.wins !== null);
      const completedPairs = new Set();
      const pbGames = [];

      if (teamsWithRecords.length >= 2) {
        const sorted = [...teamsWithRecords].sort((a, b) => b.wins - a.wins);
        const winsNeeded = {};
        const lossesNeeded = {};
        for (const t of sorted) {
          winsNeeded[t.id] = t.wins;
          lossesNeeded[t.id] = t.losses;
        }

        for (const winner of sorted) {
          while (winsNeeded[winner.id] > 0) {
            let loser = null;
            for (const candidate of [...sorted].reverse()) {
              if (candidate.id === winner.id) continue;
              const pairKey = [winner.id, candidate.id].sort().join('-');
              if (completedPairs.has(pairKey)) continue;
              if (lossesNeeded[candidate.id] > 0) {
                loser = candidate;
                break;
              }
            }
            if (!loser) break;

            const pairKey = [winner.id, loser.id].sort().join('-');
            completedPairs.add(pairKey);
            winsNeeded[winner.id]--;
            lossesNeeded[loser.id]--;

            const weekNum = Math.min(4, pbGames.length % 4 + 1);
            const gameDate = new Date('2026-04-06');
            const currentDay = gameDate.getDay();
            const daysToAdd = (league.dayOfWeek - currentDay + 7) % 7;
            gameDate.setDate(gameDate.getDate() + daysToAdd + (weekNum - 1) * 7);
            gameDate.setHours(10, 0, 0, 0);

            const venue = venues[Math.floor(Math.random() * venues.length)];
            const winScore = 11;
            const loseScore = Math.floor(Math.random() * 9) + 1;
            const isHome = Math.random() > 0.5;

            pbGames.push({
              league_id: leagueId,
              home_team_id: isHome ? winner.id : loser.id,
              away_team_id: isHome ? loser.id : winner.id,
              scheduled_at: gameDate.toISOString(),
              venue,
              status: 'completed',
              home_score: isHome ? winScore : loseScore,
              away_score: isHome ? loseScore : winScore,
              week_number: weekNum,
            });
          }
        }
      }

      // Upcoming games for ALL teams
      const allPbPairs = [];
      for (let i = 0; i < teamsWithIds.length; i++) {
        for (let j = i + 1; j < teamsWithIds.length; j++) {
          const pairKey = [teamsWithIds[i].id, teamsWithIds[j].id].sort().join('-');
          if (!completedPairs.has(pairKey)) allPbPairs.push([teamsWithIds[i], teamsWithIds[j]]);
        }
      }
      for (let i = allPbPairs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allPbPairs[i], allPbPairs[j]] = [allPbPairs[j], allPbPairs[i]];
      }
      const pbUpcoming = {};
      for (const t of teamsWithIds) pbUpcoming[t.id] = 0;
      let pbWeekOff = 0;
      for (const [tA, tB] of allPbPairs) {
        if (pbUpcoming[tA.id] >= 3 && pbUpcoming[tB.id] >= 3) continue;
        const weekNum = 5 + pbWeekOff;
        const gameDate = new Date('2026-04-06');
        const currentDay = gameDate.getDay();
        const daysToAdd = (league.dayOfWeek - currentDay + 7) % 7;
        gameDate.setDate(gameDate.getDate() + daysToAdd + (weekNum - 1) * 7);
        gameDate.setHours(10, 0, 0, 0);
        const venue = venues[Math.floor(Math.random() * venues.length)];
        pbGames.push({
          league_id: leagueId,
          home_team_id: tA.id,
          away_team_id: tB.id,
          scheduled_at: gameDate.toISOString(),
          venue,
          status: 'scheduled',
          home_score: null,
          away_score: null,
          week_number: weekNum,
        });
        pbUpcoming[tA.id]++;
        pbUpcoming[tB.id]++;
        pbWeekOff = (pbWeekOff + 1) % 8;
      }

      for (const g of pbGames) {
        const locationId = locationMap[g.venue.toLowerCase()] || null;
        await c.query(`
          INSERT INTO games (league_id, home_team_id, away_team_id, scheduled_at, venue, location_id, status, home_score, away_score, week_number)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [g.league_id, g.home_team_id, g.away_team_id, g.scheduled_at, g.venue, locationId, g.status, g.home_score, g.away_score, g.week_number]);
      }
      console.log(`    Created ${pbGames.filter(g => g.status === 'completed').length} completed, ${pbGames.filter(g => g.status === 'scheduled').length} scheduled games`);
    }

    await c.query('SELECT recalculate_standings($1)', [leagueId]);
    console.log(`  Standings recalculated.`);
  }

  // Summary
  const summary = await c.query(`
    SELECT l.name, l.sport,
      (SELECT count(*) FROM teams WHERE league_id = l.id) as team_count,
      (SELECT count(*) FROM players WHERE league_id = l.id) as player_count,
      (SELECT count(*) FROM games WHERE league_id = l.id AND status = 'completed') as completed_games,
      (SELECT count(*) FROM games WHERE league_id = l.id AND status = 'scheduled') as scheduled_games
    FROM leagues l WHERE l.organizer_id = $1 ORDER BY l.sport, l.name
  `, [ORGANIZER_ID]);

  console.log('\n=== SEED SUMMARY ===');
  console.log('League'.padEnd(35), 'Sport'.padEnd(14), 'Teams', 'Players', 'Done', 'Sched');
  console.log('-'.repeat(85));
  for (const r of summary.rows) {
    console.log(
      r.name.padEnd(35),
      r.sport.padEnd(14),
      String(r.team_count).padStart(5),
      String(r.player_count).padStart(7),
      String(r.completed_games).padStart(4),
      String(r.scheduled_games).padStart(5)
    );
  }

  console.log('\nSeed complete!');
  await c.end();
}

seed().catch(e => { console.error(e); c.end(); process.exit(1); });
