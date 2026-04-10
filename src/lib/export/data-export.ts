import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import type { League, Team, Player, Game, Standing, Division } from "@/lib/types";

type ExportFormat = "pdf" | "xlsx";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function generatedLine(): string {
  return `Generated ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
}

function pdfHeader(doc: jsPDF, title: string) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(title.toUpperCase(), pageWidth / 2, 36, { align: "center" });
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(generatedLine(), 40, 52);
}

function autoWidth(ws: XLSX.WorkSheet) {
  const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
  const cols: { wch: number }[] = [];
  for (const row of data as string[][]) {
    row.forEach((cell, i) => {
      const len = cell != null ? String(cell).length : 0;
      if (!cols[i] || cols[i].wch < len) {
        cols[i] = { wch: Math.min(len + 2, 50) };
      }
    });
  }
  ws["!cols"] = cols;
}

function boldHeaders(ws: XLSX.WorkSheet) {
  // xlsx community edition doesn't support cell styling natively,
  // but we still set the header row for pro / SheetJS Pro users.
  // This is a no-op in the community build but included for forward compat.
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[addr]) {
      ws[addr].s = { font: { bold: true } };
    }
  }
}

function buildSheet(data: Record<string, unknown>[], name: string): XLSX.WorkSheet {
  const ws = XLSX.utils.json_to_sheet(data);
  autoWidth(ws);
  boldHeaders(ws);
  return ws;
}

function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function savePdf(doc: jsPDF, filename: string) {
  doc.save(filename);
}

function saveXlsx(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename);
}

// ---------------------------------------------------------------------------
// 1. All Leagues Summary
// ---------------------------------------------------------------------------

interface LeaguesSummaryInput {
  leagues: League[];
  teams: Team[];
  games: Game[];
}

export function exportLeaguesSummary(
  { leagues, teams, games }: LeaguesSummaryInput,
  format: ExportFormat
) {
  const leagueMap = new Map(leagues.map((l) => [l.id, l]));
  const rows = leagues.map((l) => {
    const teamCount = teams.filter((t) => t.league_id === l.id).length;
    const gameCount = games.filter((g) => g.league_id === l.id).length;
    return {
      "League Name": l.name,
      Sport: l.sport ?? "",
      Season: l.season_name ?? "",
      "Start Date": fmtDate(l.season_start),
      "End Date": fmtDate(l.season_end),
      Teams: teamCount,
      Games: gameCount,
    };
  });

  const title = "All Leagues Summary";

  if (format === "pdf") {
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
    pdfHeader(doc, title);
    autoTable(doc, {
      startY: 65,
      head: [Object.keys(rows[0] || {})],
      body: rows.map((r) => Object.values(r).map(String)),
      theme: "plain",
      headStyles: { fontStyle: "bold", fontSize: 10, textColor: [0, 0, 0], lineWidth: { bottom: 1 }, lineColor: [0, 0, 0] },
      bodyStyles: { fontSize: 9 },
      margin: { left: 40, right: 40 },
    });
    savePdf(doc, "leagues-summary.pdf");
  } else {
    const wb = XLSX.utils.book_new();
    const ws = buildSheet(rows, "Leagues");
    XLSX.utils.book_append_sheet(wb, ws, "Leagues Summary");
    // Add generated date in a separate info row
    XLSX.utils.sheet_add_aoa(ws, [[generatedLine()]], { origin: -1 });
    saveXlsx(wb, "leagues-summary.xlsx");
  }
}

// ---------------------------------------------------------------------------
// 2. All Teams & Captains
// ---------------------------------------------------------------------------

interface TeamsAndCaptainsInput {
  leagues: League[];
  teams: Team[];
  players: Player[];
}

export function exportTeamsAndCaptains(
  { leagues, teams, players }: TeamsAndCaptainsInput,
  format: ExportFormat
) {
  const leagueMap = new Map(leagues.map((l) => [l.id, l]));
  const playerMap = new Map(players.map((p) => [p.id, p]));

  const rows = teams.map((t) => {
    const league = leagueMap.get(t.league_id);
    const captain = t.captain_player_id ? playerMap.get(t.captain_player_id) : null;
    return {
      League: league?.name ?? "",
      "Team Name": t.name,
      Captain: captain?.name ?? "—",
      "Captain Email": captain?.email ?? "",
      "Captain Phone": captain?.phone ?? "",
    };
  });

  const title = "All Teams & Captains";

  if (format === "pdf") {
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
    pdfHeader(doc, title);
    autoTable(doc, {
      startY: 65,
      head: [Object.keys(rows[0] || {})],
      body: rows.map((r) => Object.values(r).map(String)),
      theme: "plain",
      headStyles: { fontStyle: "bold", fontSize: 10, textColor: [0, 0, 0], lineWidth: { bottom: 1 }, lineColor: [0, 0, 0] },
      bodyStyles: { fontSize: 9 },
      margin: { left: 40, right: 40 },
    });
    savePdf(doc, "teams-and-captains.pdf");
  } else {
    const wb = XLSX.utils.book_new();
    const ws = buildSheet(rows, "Teams");
    XLSX.utils.book_append_sheet(wb, ws, "Teams & Captains");
    XLSX.utils.sheet_add_aoa(ws, [[generatedLine()]], { origin: -1 });
    saveXlsx(wb, "teams-and-captains.xlsx");
  }
}

// ---------------------------------------------------------------------------
// 3. Full Schedule
// ---------------------------------------------------------------------------

interface FullScheduleInput {
  leagues: League[];
  teams: Team[];
  games: Game[];
}

export function exportFullSchedule(
  { leagues, teams, games }: FullScheduleInput,
  format: ExportFormat
) {
  const leagueMap = new Map(leagues.map((l) => [l.id, l]));
  const teamMap = new Map(teams.map((t) => [t.id, t]));

  const sorted = [...games].sort(
    (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
  );

  const rows = sorted.map((g) => {
    const league = leagueMap.get(g.league_id);
    const home = teamMap.get(g.home_team_id);
    const away = teamMap.get(g.away_team_id);
    return {
      League: league?.name ?? "",
      Date: fmtDateTime(g.scheduled_at),
      "Home Team": home?.name ?? "",
      "Away Team": away?.name ?? "",
      "Home Score": g.home_score != null ? g.home_score : "",
      "Away Score": g.away_score != null ? g.away_score : "",
      Venue: g.venue ?? "",
      Court: g.court ?? "",
      Status: g.status,
      Week: g.week_number ?? "",
    };
  });

  const title = "Full Schedule";

  if (format === "pdf") {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
    pdfHeader(doc, title);
    autoTable(doc, {
      startY: 65,
      head: [Object.keys(rows[0] || {})],
      body: rows.map((r) => Object.values(r).map(String)),
      theme: "plain",
      headStyles: { fontStyle: "bold", fontSize: 9, textColor: [0, 0, 0], lineWidth: { bottom: 1 }, lineColor: [0, 0, 0] },
      bodyStyles: { fontSize: 8 },
      margin: { left: 30, right: 30 },
    });
    savePdf(doc, "full-schedule.pdf");
  } else {
    const wb = XLSX.utils.book_new();
    const ws = buildSheet(rows, "Schedule");
    XLSX.utils.book_append_sheet(wb, ws, "Full Schedule");
    XLSX.utils.sheet_add_aoa(ws, [[generatedLine()]], { origin: -1 });
    saveXlsx(wb, "full-schedule.xlsx");
  }
}

// ---------------------------------------------------------------------------
// 4. Per-League Export (selected sections)
// ---------------------------------------------------------------------------

export interface LeagueExportOptions {
  league: League;
  divisions: Division[];
  standings: Standing[];
  teams: Team[];
  players: Player[];
  games: Game[];
  sections: {
    leagueInfo: boolean;
    standings: boolean;
    teamsRosters: boolean;
    schedule: boolean;
    gameResults: boolean;
  };
  format: ExportFormat;
}

export function exportLeagueData(options: LeagueExportOptions) {
  const { league, divisions, standings, teams, players, games, sections, format } = options;
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const playerMap = new Map(players.map((p) => [p.id, p]));
  const divisionMap = new Map(divisions.map((d) => [d.id, d]));

  const filename = `${league.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-export`;

  if (format === "pdf") {
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
    pdfHeader(doc, `${league.name} — Data Export`);
    let cursorY = 65;

    // League Info
    if (sections.leagueInfo) {
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.text("League Information", 40, cursorY);
      cursorY += 8;
      const infoRows = [
        ["Name", league.name],
        ["Sport", league.sport ?? "—"],
        ["Season", league.season_name ?? "—"],
        ["Start Date", fmtDate(league.season_start)],
        ["End Date", fmtDate(league.season_end)],
        ["Divisions", divisions.map((d) => d.name).join(", ") || "None"],
        ["Public", league.is_public ? "Yes" : "No"],
      ];
      autoTable(doc, {
        startY: cursorY,
        body: infoRows,
        theme: "plain",
        bodyStyles: { fontSize: 10 },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 100 } },
        margin: { left: 40, right: 40 },
      });
      cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
    }

    // Standings
    if (sections.standings) {
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.text("Standings", 40, cursorY);
      cursorY += 8;

      const divGroups = divisions.length > 0 ? divisions : [{ id: "", name: "Overall" } as Division];
      for (const div of divGroups) {
        const divStandings = div.id
          ? standings.filter((s) => {
              const team = teamMap.get(s.team_id);
              return team?.division_id === div.id;
            })
          : standings;

        if (divStandings.length === 0) continue;

        const sorted = [...divStandings].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));

        if (divisions.length > 0) {
          doc.setFontSize(10);
          doc.setFont("helvetica", "bold");
          doc.text(div.name, 40, cursorY);
          cursorY += 4;
        }

        const standingRows = sorted.map((s) => {
          const team = teamMap.get(s.team_id);
          const total = s.wins + s.losses + s.ties;
          const winPct = total > 0 ? (s.wins / total).toFixed(3) : ".000";
          const ptDiff = s.points_for - s.points_against;
          return [
            String(s.rank ?? ""),
            team?.name ?? "",
            String(s.wins),
            String(s.losses),
            String(s.ties),
            winPct,
            String(s.points_for),
            String(s.points_against),
            (ptDiff >= 0 ? "+" : "") + ptDiff,
          ];
        });

        autoTable(doc, {
          startY: cursorY,
          head: [["#", "Team", "W", "L", "T", "Win%", "PF", "PA", "+/-"]],
          body: standingRows,
          theme: "plain",
          headStyles: { fontStyle: "bold", fontSize: 9, textColor: [0, 0, 0], lineWidth: { bottom: 0.5 }, lineColor: [0, 0, 0] },
          bodyStyles: { fontSize: 9 },
          margin: { left: 40, right: 40 },
        });
        cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
      }
    }

    // Teams & Rosters
    if (sections.teamsRosters) {
      if (cursorY > 650) { doc.addPage(); cursorY = 40; }
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.text("Teams & Rosters", 40, cursorY);
      cursorY += 8;

      for (const team of teams) {
        const captain = team.captain_player_id ? playerMap.get(team.captain_player_id) : null;
        const roster = players.filter((p) => p.team_id === team.id);

        if (cursorY > 680) { doc.addPage(); cursorY = 40; }
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text(`${team.name}${captain ? ` (Captain: ${captain.name})` : ""}`, 40, cursorY);
        cursorY += 4;

        const rosterRows = roster.map((p) => [
          p.name,
          p.email ?? "",
          p.phone ?? "",
          p.is_sub ? "Sub" : "Roster",
        ]);

        if (rosterRows.length > 0) {
          autoTable(doc, {
            startY: cursorY,
            head: [["Player", "Email", "Phone", "Type"]],
            body: rosterRows,
            theme: "plain",
            headStyles: { fontStyle: "bold", fontSize: 8, textColor: [0, 0, 0], lineWidth: { bottom: 0.5 }, lineColor: [0, 0, 0] },
            bodyStyles: { fontSize: 8 },
            margin: { left: 40, right: 40 },
          });
          cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
        } else {
          doc.setFontSize(8);
          doc.setFont("helvetica", "italic");
          doc.text("No players", 50, cursorY + 10);
          cursorY += 18;
        }
      }
    }

    // Schedule
    if (sections.schedule) {
      if (cursorY > 600) { doc.addPage(); cursorY = 40; }
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.text("Schedule", 40, cursorY);
      cursorY += 8;

      const sorted = [...games].sort(
        (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
      );

      const schedRows = sorted.map((g) => [
        fmtDateTime(g.scheduled_at),
        teamMap.get(g.home_team_id)?.name ?? "",
        "vs",
        teamMap.get(g.away_team_id)?.name ?? "",
        g.home_score != null && g.away_score != null ? `${g.home_score}-${g.away_score}` : "",
        g.venue ?? "",
        g.status,
      ]);

      autoTable(doc, {
        startY: cursorY,
        head: [["Date", "Home", "", "Away", "Score", "Venue", "Status"]],
        body: schedRows,
        theme: "plain",
        headStyles: { fontStyle: "bold", fontSize: 9, textColor: [0, 0, 0], lineWidth: { bottom: 0.5 }, lineColor: [0, 0, 0] },
        bodyStyles: { fontSize: 8 },
        margin: { left: 40, right: 40 },
      });
      cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
    }

    // Game Results
    if (sections.gameResults) {
      if (cursorY > 600) { doc.addPage(); cursorY = 40; }
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.text("Game Results", 40, cursorY);
      cursorY += 8;

      const completed = games
        .filter((g) => g.status === "completed")
        .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

      const resultRows = completed.map((g) => [
        fmtDateTime(g.scheduled_at),
        teamMap.get(g.home_team_id)?.name ?? "",
        String(g.home_score ?? 0),
        String(g.away_score ?? 0),
        teamMap.get(g.away_team_id)?.name ?? "",
        g.venue ?? "",
      ]);

      autoTable(doc, {
        startY: cursorY,
        head: [["Date", "Home", "H Score", "A Score", "Away", "Venue"]],
        body: resultRows.length > 0 ? resultRows : [["No completed games", "", "", "", "", ""]],
        theme: "plain",
        headStyles: { fontStyle: "bold", fontSize: 9, textColor: [0, 0, 0], lineWidth: { bottom: 0.5 }, lineColor: [0, 0, 0] },
        bodyStyles: { fontSize: 8 },
        margin: { left: 40, right: 40 },
      });
    }

    savePdf(doc, `${filename}.pdf`);
  } else {
    // XLSX
    const wb = XLSX.utils.book_new();

    if (sections.leagueInfo) {
      const infoData = [
        { Field: "Name", Value: league.name },
        { Field: "Sport", Value: league.sport ?? "" },
        { Field: "Season", Value: league.season_name ?? "" },
        { Field: "Start Date", Value: fmtDate(league.season_start) },
        { Field: "End Date", Value: fmtDate(league.season_end) },
        { Field: "Divisions", Value: divisions.map((d) => d.name).join(", ") || "None" },
        { Field: "Public", Value: league.is_public ? "Yes" : "No" },
        { Field: "", Value: "" },
        { Field: "Generated", Value: generatedLine() },
      ];
      const ws = buildSheet(infoData, "League Info");
      XLSX.utils.book_append_sheet(wb, ws, "League Info");
    }

    if (sections.standings) {
      const standingRows = standings
        .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
        .map((s) => {
          const team = teamMap.get(s.team_id);
          const div = team?.division_id ? divisionMap.get(team.division_id) : null;
          const total = s.wins + s.losses + s.ties;
          const winPct = total > 0 ? Number((s.wins / total).toFixed(3)) : 0;
          const ptDiff = s.points_for - s.points_against;
          return {
            Rank: s.rank ?? "",
            Division: div?.name ?? "",
            Team: team?.name ?? "",
            Wins: s.wins,
            Losses: s.losses,
            Ties: s.ties,
            "Win%": winPct,
            "Points For": s.points_for,
            "Points Against": s.points_against,
            "Point Diff": ptDiff,
          };
        });
      const ws = buildSheet(standingRows, "Standings");
      XLSX.utils.book_append_sheet(wb, ws, "Standings");
    }

    if (sections.teamsRosters) {
      const rosterRows: Record<string, unknown>[] = [];
      for (const team of teams) {
        const captain = team.captain_player_id ? playerMap.get(team.captain_player_id) : null;
        const roster = players.filter((p) => p.team_id === team.id);
        const div = team.division_id ? divisionMap.get(team.division_id) : null;
        if (roster.length === 0) {
          rosterRows.push({
            Team: team.name,
            Division: div?.name ?? "",
            Captain: captain?.name ?? "",
            Player: "",
            Email: "",
            Phone: "",
            Type: "",
          });
        } else {
          for (const p of roster) {
            rosterRows.push({
              Team: team.name,
              Division: div?.name ?? "",
              Captain: captain?.name ?? "",
              Player: p.name,
              Email: p.email ?? "",
              Phone: p.phone ?? "",
              Type: p.is_sub ? "Sub" : "Roster",
            });
          }
        }
      }
      const ws = buildSheet(rosterRows, "Teams");
      XLSX.utils.book_append_sheet(wb, ws, "Teams & Rosters");
    }

    if (sections.schedule) {
      const sorted = [...games].sort(
        (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
      );
      const schedRows = sorted.map((g) => ({
        Date: fmtDateTime(g.scheduled_at),
        Week: g.week_number ?? "",
        "Home Team": teamMap.get(g.home_team_id)?.name ?? "",
        "Away Team": teamMap.get(g.away_team_id)?.name ?? "",
        "Home Score": g.home_score ?? "",
        "Away Score": g.away_score ?? "",
        Venue: g.venue ?? "",
        Court: g.court ?? "",
        Status: g.status,
        Playoff: g.is_playoff ? "Yes" : "No",
      }));
      const ws = buildSheet(schedRows, "Schedule");
      XLSX.utils.book_append_sheet(wb, ws, "Schedule");
    }

    if (sections.gameResults) {
      const completed = games
        .filter((g) => g.status === "completed")
        .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
      const resultRows = completed.map((g) => ({
        Date: fmtDateTime(g.scheduled_at),
        "Home Team": teamMap.get(g.home_team_id)?.name ?? "",
        "Home Score": g.home_score ?? 0,
        "Away Score": g.away_score ?? 0,
        "Away Team": teamMap.get(g.away_team_id)?.name ?? "",
        Venue: g.venue ?? "",
        Court: g.court ?? "",
        Week: g.week_number ?? "",
      }));
      const ws = buildSheet(
        resultRows.length > 0 ? resultRows : [{ Date: "No completed games" }],
        "Results"
      );
      XLSX.utils.book_append_sheet(wb, ws, "Game Results");
    }

    saveXlsx(wb, `${filename}.xlsx`);
  }
}
