const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL });

const ORGANIZER_ID = '8d560e83-ac34-43f7-98a7-21d06c416cc0';

// Volleyball team/player names for realistic data
const VB_TEAMS = {
  "Reverse Mondays": {
    divisions: [
      { name: "A", level: 0, teams: [
        { name: "Netbusters", players: ["Alex Kim", "Jordan Lee", "Casey Park", "Riley Chen", "Morgan Wu", "Sam Cho"] },
        { name: "Block Party", players: ["Taylor Swift", "Drew Nguyen", "Jamie Tran", "Quinn Davis", "Parker Hall", "Blake Torres"] },
        { name: "Set It Off", players: ["Avery Johnson", "Cameron Lee", "Dakota Brown", "Emerson Clark", "Finley White", "Harper Green"] },
        { name: "Ace Ventura", players: ["Reese Miller", "Sage Thompson", "Logan Anderson", "Ellis Martin", "Rowan Garcia", "River Lopez"] },
      ]},
      { name: "B+", level: 1, teams: [
        { name: "Dig Dug", players: ["Pat Reeves", "Chris Marsh", "Jessie Lane", "Robin Swift", "Dana Kraft", "Terry Stone"] },
        { name: "Spike Lee", players: ["Angel Cruz", "Bobby Fischer", "Carmen Diaz", "Dante Ramos", "Eve Lin", "Frank Patel"] },
        { name: "Bump Set Spike", players: ["Grace Kim", "Henry Zhao", "Iris Shah", "Jack Torres", "Kelly Ngo", "Leo Santos"] },
        { name: "Volley Llamas", players: ["Mia Costa", "Nick Fernandez", "Olivia Wu", "Peter Chang", "Rosa Mendez", "Steve Park"] },
      ]},
      { name: "B", level: 2, teams: [
        { name: "Net Gain", players: ["Uma Patel", "Vic Nguyen", "Wendy Liu", "Xavier Jones", "Yuki Tanaka", "Zara Ahmed"] },
        { name: "Served Fresh", players: ["Amy Brown", "Ben Carter", "Clara Diaz", "Doug Evans", "Ella Foster", "Fred Garcia"] },
        { name: "Pass It On", players: ["Gina Hernandez", "Hank Irving", "Isla James", "Kurt Klein", "Luna Martinez", "Max Nelson"] },
        { name: "Court Jesters", players: ["Nora Owen", "Oscar Perry", "Penny Quinn", "Reed Smith", "Sara Torres", "Tom Upton"] },
      ]},
    ],
  },
  "Wednesday Warriors": {
    divisions: [
      { name: "A", level: 0, teams: [
        { name: "The Setters", players: ["Aiden Cross", "Beth Donovan", "Carl Erikson", "Diana Fox", "Evan Grant", "Fiona Harper"] },
        { name: "Slam Dunk VB", players: ["Gary Holt", "Helen Ivory", "Ian Jackson", "Julia Knight", "Kevin Long", "Lisa Moore"] },
        { name: "Kill Shot", players: ["Mark Noble", "Nina Ortiz", "Owen Phillips", "Paula Quinn", "Rick Stevens", "Sue Taylor"] },
        { name: "Under Pressure", players: ["Tina Upton", "Uri Vasquez", "Vera Walsh", "Will Xavier", "Xena Young", "Yuri Zhao"] },
        { name: "Blockaholics", players: ["Aaron Blake", "Brenda Cole", "Derek Dunn", "Elena Fry", "Felix Green", "Greta Hill"] },
        { name: "Net Prophets", players: ["Hugo Ivan", "Irene Jones", "James Kline", "Karen Lee", "Larry Moss", "Megan Nash"] },
      ]},
      { name: "B", level: 1, teams: [
        { name: "Casual Spikers", players: ["Ned O'Brien", "Opal Parks", "Pete Ross", "Quinn Shaw", "Ruth Torres", "Sean Vance"] },
        { name: "Serve-ivors", players: ["Tara Webb", "Ulysses Xu", "Violet Yang", "Wayne Zhu", "Xia Adams", "Yosef Bass"] },
        { name: "Pancake Squad", players: ["Zena Clark", "Abe Dixon", "Belle Evans", "Chad Fox", "Dina Grant", "Emil Hayes"] },
        { name: "Sandy Cheeks", players: ["Faye Irving", "Glen James", "Hope Klein", "Ike Long", "Jade Moore", "Karl Nash"] },
        { name: "Rec Wreckers", players: ["Lena Ortiz", "Mike Perry", "Nadia Quinn", "Otto Ross", "Pam Shaw", "Ron Torres"] },
        { name: "Just for Kicks", players: ["Sally Upton", "Tim Vance", "Una Webb", "Val Xu", "Walt Young", "Xena Zhu"] },
      ]},
    ],
  },
};

async function seed() {
  await c.connect();
  
  for (const [leagueName, config] of Object.entries(VB_TEAMS)) {
    console.log(`Creating league: ${leagueName}`);
    const slug = leagueName.toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).slice(2, 10);
    
    const leagueRes = await c.query(`
      INSERT INTO leagues (organizer_id, name, slug, sport, season_name, season_start, season_end, settings, timezone)
      VALUES ($1, $2, $3, 'Volleyball', 'Spring 2026', '2026-04-06', '2026-06-29',
        '{"scoring_mode": "sets", "sets_to_win": 2}', 'America/Los_Angeles')
      RETURNING id
    `, [ORGANIZER_ID, leagueName, slug]);
    const leagueId = leagueRes.rows[0].id;
    
    for (const div of config.divisions) {
      console.log(`  Creating division: ${div.name}`);
      const divRes = await c.query(`
        INSERT INTO divisions (league_id, name, level)
        VALUES ($1, $2, $3) RETURNING id
      `, [leagueId, div.name, div.level]);
      const divisionId = divRes.rows[0].id;
      
      const teamIds = [];
      for (const team of div.teams) {
        const teamRes = await c.query(`
          INSERT INTO teams (league_id, name, division_id)
          VALUES ($1, $2, $3) RETURNING id
        `, [leagueId, team.name, divisionId]);
        const teamId = teamRes.rows[0].id;
        teamIds.push(teamId);
        
        let captainId = null;
        for (let i = 0; i < team.players.length; i++) {
          const playerRes = await c.query(`
            INSERT INTO players (league_id, team_id, name, is_sub)
            VALUES ($1, $2, $3, false) RETURNING id
          `, [leagueId, teamId, team.players[i]]);
          if (i === 0) captainId = playerRes.rows[0].id;
        }
        
        if (captainId) {
          await c.query('UPDATE teams SET captain_player_id = $1 WHERE id = $2', [captainId, teamId]);
        }
      }
      
      // Generate some completed games with scores for standings
      const numTeams = teamIds.length;
      const gamesPlayed = [];
      for (let i = 0; i < numTeams; i++) {
        for (let j = i + 1; j < numTeams; j++) {
          // Each pair plays once, simulate 3 weeks of completed games
          if (gamesPlayed.length < numTeams * 2) {
            const weekNum = Math.floor(gamesPlayed.length / Math.floor(numTeams / 2)) + 1;
            const gameDate = new Date('2026-04-06');
            gameDate.setDate(gameDate.getDate() + (weekNum - 1) * 7);
            
            // Volleyball sets scoring: randomly 2-0, 2-1, 0-2, 1-2
            const outcomes = [[2, 0], [2, 1], [0, 2], [1, 2], [2, 0], [2, 1]];
            const [hs, as] = outcomes[Math.floor(Math.random() * outcomes.length)];
            
            const isHome = Math.random() > 0.5;
            const homeTeam = isHome ? teamIds[i] : teamIds[j];
            const awayTeam = isHome ? teamIds[j] : teamIds[i];
            
            await c.query(`
              INSERT INTO games (league_id, home_team_id, away_team_id, scheduled_at, venue, status, home_score, away_score, week_number)
              VALUES ($1, $2, $3, $4, 'Reeves Middle School', 'completed', $5, $6, $7)
            `, [leagueId, homeTeam, awayTeam, gameDate.toISOString(), hs, as, weekNum]);
            gamesPlayed.push(true);
          }
        }
      }
      
      // Generate upcoming scheduled games  
      for (let i = 0; i < numTeams; i++) {
        for (let j = i + 1; j < numTeams; j++) {
          if (gamesPlayed.length >= numTeams * 2) {
            const weekNum = Math.floor(gamesPlayed.length / Math.floor(numTeams / 2)) + 1;
            const gameDate = new Date('2026-04-06');
            gameDate.setDate(gameDate.getDate() + (weekNum - 1) * 7);
            gameDate.setHours(19, 0, 0, 0);
            
            const venues = ['Reeves Middle School', 'Marshall Middle School'];
            const venue = venues[Math.floor(Math.random() * venues.length)];
            
            await c.query(`
              INSERT INTO games (league_id, home_team_id, away_team_id, scheduled_at, venue, status, week_number)
              VALUES ($1, $2, $3, $4, $5, 'scheduled', $6)
            `, [leagueId, teamIds[i], teamIds[j], gameDate.toISOString(), venue, weekNum]);
            gamesPlayed.push(true);
          }
        }
      }
    }
    
    // Recalculate standings
    await c.query('SELECT recalculate_standings($1)', [leagueId]);
    console.log(`  Standings recalculated for ${leagueName}`);
  }
  
  // Add subs to existing "Reverse B" league
  const existingLeagueId = '50b82275-f31a-44a4-bad3-d7fbe6d7a4e8';
  const existingTeams = await c.query('SELECT id, name FROM teams WHERE league_id = $1', [existingLeagueId]);
  
  // Add players to teams that don't have enough
  for (const team of existingTeams.rows) {
    const playerCount = await c.query('SELECT count(*) as cnt FROM players WHERE team_id = $1', [team.id]);
    const cnt = parseInt(playerCount.rows[0].cnt);
    if (cnt < 4) {
      const names = ['Jordan Rivers', 'Casey Adams', 'Morgan Blake', 'Riley Cooper', 'Taylor Dean', 'Avery Ellis'];
      for (let i = cnt; i < 6; i++) {
        const name = names[i - cnt] + ' (' + team.name.substring(0, 3) + ')';
        await c.query(`
          INSERT INTO players (league_id, team_id, name, is_sub)
          VALUES ($1, $2, $3, false)
        `, [existingLeagueId, team.id, name]);
      }
    }
  }
  
  // Generate some completed games for existing Reverse B league per division
  const divGames = await c.query('SELECT count(*) as cnt FROM games WHERE league_id = $1', [existingLeagueId]);
  if (parseInt(divGames.rows[0].cnt) === 0) {
    const divTeams = await c.query(`
      SELECT t.id, t.division_id FROM teams t 
      WHERE t.league_id = $1 AND t.division_id IS NOT NULL
      ORDER BY t.division_id, t.name
    `, [existingLeagueId]);
    
    const byDiv = {};
    for (const t of divTeams.rows) {
      if (!byDiv[t.division_id]) byDiv[t.division_id] = [];
      byDiv[t.division_id].push(t.id);
    }
    
    for (const [divId, ids] of Object.entries(byDiv)) {
      let gidx = 0;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const weekNum = Math.floor(gidx / Math.max(1, Math.floor(ids.length / 2))) + 1;
          const gameDate = new Date('2026-04-07');
          gameDate.setDate(gameDate.getDate() + (weekNum - 1) * 7);
          
          const outcomes = [[2, 0], [2, 1], [0, 2], [1, 2]];
          const [hs, as] = outcomes[Math.floor(Math.random() * outcomes.length)];
          
          if (weekNum <= 3) {
            await c.query(`
              INSERT INTO games (league_id, home_team_id, away_team_id, scheduled_at, venue, status, home_score, away_score, week_number)
              VALUES ($1, $2, $3, $4, 'Reeves Middle School', 'completed', $5, $6, $7)
            `, [existingLeagueId, ids[i], ids[j], gameDate.toISOString(), hs, as, weekNum]);
          } else {
            await c.query(`
              INSERT INTO games (league_id, home_team_id, away_team_id, scheduled_at, venue, status, week_number)
              VALUES ($1, $2, $3, $4, 'Reeves Middle School', 'scheduled', $5)
            `, [existingLeagueId, ids[i], ids[j], gameDate.toISOString(), weekNum]);
          }
          gidx++;
        }
      }
    }
    
    await c.query('SELECT recalculate_standings($1)', [existingLeagueId]);
    console.log('Reverse B: standings recalculated');
  }
  
  console.log('\n✅ Seed complete!');
  c.end();
}

seed().catch(e => { console.error(e); c.end(); process.exit(1); });
