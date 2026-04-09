import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import type { Game, Team, Player, League, GameDayPattern } from "@/lib/types";

interface ScheduleExportOptions {
  league: League;
  teams: Team[];
  players: Player[];
  games: Game[];
  pattern?: GameDayPattern;
}

export function generateSchedulePdf({
  league,
  teams,
  players,
  games,
}: ScheduleExportOptions): jsPDF {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const teamsMap = new Map(teams.map((t) => [t.id, t]));

  // ----- HEADER -----
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(
    `${league.name.toUpperCase()}${league.season_name ? ` — ${league.season_name.toUpperCase()}` : ""}`,
    pageWidth / 2,
    35,
    { align: "center" }
  );

  // ----- TEAM ROSTER -----
  // 3-column layout: team# . name / captain phone
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");

  const teamsWithCaptain = teams.map((t, i) => {
    const captain = players.find((p) => p.id === t.captain_player_id);
    const captainStr = captain
      ? ` / ${captain.name}${captain.phone ? `  ${captain.phone}` : ""}`
      : "";
    return `${i + 1}. ${t.name}${captainStr}`;
  });

  const colCount = 3;
  const perCol = Math.ceil(teamsWithCaptain.length / colCount);
  const rosterColWidth = (pageWidth - 80) / colCount;
  let rosterY = 52;

  for (let col = 0; col < colCount; col++) {
    const x = 40 + col * rosterColWidth;
    for (let row = 0; row < perCol; row++) {
      const idx = col * perCol + row;
      if (idx >= teamsWithCaptain.length) break;
      doc.text(teamsWithCaptain[idx], x, rosterY + row * 11);
    }
  }

  rosterY += perCol * 11 + 12;

  // ----- SCHEDULE GRID -----
  // Group games by week
  const gamesByWeek = new Map<number, Game[]>();
  for (const game of games.filter((g) => g.status !== "cancelled")) {
    const week = game.week_number || 0;
    const arr = gamesByWeek.get(week) || [];
    arr.push(game);
    gamesByWeek.set(week, arr);
  }

  const sortedWeeks = [...gamesByWeek.keys()].sort((a, b) => a - b);

  // Assign a number to each team for compact display
  const teamNumbers = new Map<string, number>();
  teams.forEach((t, i) => teamNumbers.set(t.id, i + 1));

  // Render weeks side by side (2 per row)
  const weeksPerRow = 2;
  const weekBlockWidth = (pageWidth - 80 - 20) / weeksPerRow;

  let currentY = rosterY;

  for (let wi = 0; wi < sortedWeeks.length; wi += weeksPerRow) {
    // Check if we need a new page
    if (currentY > doc.internal.pageSize.getHeight() - 160) {
      doc.addPage();
      currentY = 40;
    }

    let maxBlockHeight = 0;

    for (let col = 0; col < weeksPerRow && wi + col < sortedWeeks.length; col++) {
      const weekNum = sortedWeeks[wi + col];
      const weekGames = gamesByWeek.get(weekNum)!;
      const xOffset = 40 + col * (weekBlockWidth + 20);

      // Get date from first game
      const firstGame = weekGames[0];
      const dateLabel = firstGame
        ? format(new Date(firstGame.scheduled_at), "MMM d")
        : "";

      // Group by time slot
      const timeSlots = new Map<string, Game[]>();
      for (const g of weekGames) {
        const timeKey = format(new Date(g.scheduled_at), "h:mma").toLowerCase();
        const arr = timeSlots.get(timeKey) || [];
        arr.push(g);
        timeSlots.set(timeKey, arr);
      }

      const sortedTimes = [...timeSlots.keys()].sort();

      // Collect courts
      const courts = [...new Set(weekGames.map((g) => g.court || g.venue || "Ct. 1"))];

      // Week header
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.text(`Wk. ${weekNum}`, xOffset, currentY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(dateLabel, xOffset + 40, currentY);

      // Build table: rows = courts, cols = time slots
      const header = ["", ...sortedTimes];

      // Determine which games happen at which court + time
      const bodyRows: string[][] = [];
      for (const court of courts) {
        const row = [court];
        for (const timeKey of sortedTimes) {
          const slotGames = timeSlots.get(timeKey) || [];
          const matchAtCourt = slotGames.find(
            (g) => (g.court || g.venue || "Ct. 1") === court
          );
          if (matchAtCourt) {
            const h = teamNumbers.get(matchAtCourt.home_team_id) ?? "?";
            const a = teamNumbers.get(matchAtCourt.away_team_id) ?? "?";
            row.push(`${h} v ${a}`);
          } else {
            row.push("");
          }
        }
        bodyRows.push(row);
      }

      // If there are no distinct courts, build simpler rows
      if (courts.length === 0) {
        for (const timeKey of sortedTimes) {
          const slotGames = timeSlots.get(timeKey) || [];
          for (const g of slotGames) {
            const h = teamNumbers.get(g.home_team_id) ?? "?";
            const a = teamNumbers.get(g.away_team_id) ?? "?";
            bodyRows.push([timeKey, `${h} v ${a}`]);
          }
        }
      }

      autoTable(doc, {
        startY: currentY + 6,
        head: [header],
        body: bodyRows,
        theme: "grid",
        headStyles: {
          fontStyle: "bold",
          fontSize: 7,
          textColor: [0, 0, 0],
          fillColor: [230, 230, 230],
          cellPadding: 2,
        },
        bodyStyles: { fontSize: 7, cellPadding: 2 },
        margin: { left: xOffset, right: pageWidth - xOffset - weekBlockWidth },
        tableWidth: weekBlockWidth,
      });

      const finalY = (doc as unknown as { lastAutoTable: { finalY: number } })
        .lastAutoTable.finalY;
      const blockHeight = finalY - currentY;
      if (blockHeight > maxBlockHeight) maxBlockHeight = blockHeight;
    }

    currentY += maxBlockHeight + 20;
  }

  // Footer
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.text(
    "Generated by LeagueNight",
    pageWidth / 2,
    doc.internal.pageSize.getHeight() - 20,
    { align: "center" }
  );

  return doc;
}
