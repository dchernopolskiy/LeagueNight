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

type RGB = [number, number, number];

const BRAND = {
  ink: [21, 34, 48] as RGB,
  slate: [82, 96, 112] as RGB,
  paper: [249, 247, 241] as RGB,
  panel: [255, 252, 245] as RGB,
  line: [224, 218, 207] as RGB,
  navy: [14, 35, 55] as RGB,
  blue: [34, 107, 150] as RGB,
  gold: [232, 170, 66] as RGB,
  green: [42, 129, 96] as RGB,
  red: [171, 67, 55] as RGB,
};

const MARGIN_X = 38;
const FOOTER_HEIGHT = 34;

function textColor(doc: jsPDF, color: RGB) {
  doc.setTextColor(color[0], color[1], color[2]);
}

function fillColor(doc: jsPDF, color: RGB) {
  doc.setFillColor(color[0], color[1], color[2]);
}

function drawColorSwatch(doc: jsPDF, color: RGB, x: number, y: number) {
  fillColor(doc, color);
  doc.roundedRect(x, y, 8, 8, 2, 2, "F");
}

function parseTeamColor(color: string | null): RGB {
  if (!color) return BRAND.blue;

  const hex = color.trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return BRAND.blue;

  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function teamNumber(index: number): string {
  return (index + 1).toString().padStart(2, "0");
}

function getDateSpan(games: Game[]): string {
  const timestamps = games
    .map((game) => new Date(game.scheduled_at).getTime())
    .filter((time) => !Number.isNaN(time))
    .sort((a, b) => a - b);

  if (timestamps.length === 0) return "Dates TBD";

  const first = new Date(timestamps[0]);
  const last = new Date(timestamps[timestamps.length - 1]);

  if (format(first, "yyyy-MM-dd") === format(last, "yyyy-MM-dd")) {
    return format(first, "EEE, MMM d");
  }

  return `${format(first, "MMM d")} - ${format(last, "MMM d")}`;
}

function drawHero(doc: jsPDF, league: League, games: Game[]) {
  const pageWidth = doc.internal.pageSize.getWidth();

  fillColor(doc, BRAND.navy);
  doc.rect(0, 0, pageWidth, 96, "F");

  fillColor(doc, BRAND.gold);
  doc.rect(0, 0, 14, 96, "F");
  doc.setDrawColor(BRAND.gold[0], BRAND.gold[1], BRAND.gold[2]);
  doc.setLineWidth(1.5);
  doc.line(MARGIN_X, 79, pageWidth - MARGIN_X, 79);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(25);
  textColor(doc, [255, 252, 245]);
  doc.text("League Schedule", MARGIN_X, 43);

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  textColor(doc, BRAND.gold);
  doc.text(league.name.toUpperCase(), MARGIN_X, 62);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  textColor(doc, [218, 226, 232]);
  const generated = `Generated ${format(new Date(), "MMM d, yyyy")}`;
  const dateSpan = getDateSpan(games);
  doc.text(`${league.season_name || "Season"}  |  ${dateSpan}  |  ${generated}`, MARGIN_X, 76);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  textColor(doc, [255, 252, 245]);
  doc.text("BenchWarmer", pageWidth - MARGIN_X, 43, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  textColor(doc, [218, 226, 232]);
  doc.text("printable game-day packet", pageWidth - MARGIN_X, 58, { align: "right" });
}

function drawSummaryCards(
  doc: jsPDF,
  {
    teams,
    games,
    weeks,
  }: {
    teams: Team[];
    games: Game[];
    weeks: number[];
  }
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const gap = 10;
  const cardWidth = (pageWidth - MARGIN_X * 2 - gap * 3) / 4;
  const cards = [
    { label: "Teams", value: teams.length.toString(), color: BRAND.blue },
    { label: "Games", value: games.length.toString(), color: BRAND.green },
    { label: "Weeks", value: weeks.length.toString(), color: BRAND.gold },
    { label: "Date Range", value: getDateSpan(games), color: BRAND.red },
  ];

  for (const [index, card] of cards.entries()) {
    const x = MARGIN_X + index * (cardWidth + gap);
    fillColor(doc, BRAND.panel);
    doc.roundedRect(x, 112, cardWidth, 42, 8, 8, "F");
    doc.setDrawColor(BRAND.line[0], BRAND.line[1], BRAND.line[2]);
    doc.roundedRect(x, 112, cardWidth, 42, 8, 8, "S");
    fillColor(doc, card.color);
    doc.roundedRect(x, 112, 6, 42, 4, 4, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(index === 3 ? 13 : 18);
    textColor(doc, BRAND.ink);
    doc.text(card.value, x + 17, 135);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    textColor(doc, BRAND.slate);
    doc.text(card.label.toUpperCase(), x + 17, 148);
  }
}

function drawSectionTitle(doc: jsPDF, title: string, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  textColor(doc, BRAND.ink);
  doc.text(title, MARGIN_X, y);

  doc.setDrawColor(BRAND.line[0], BRAND.line[1], BRAND.line[2]);
  doc.setLineWidth(0.7);
  doc.line(MARGIN_X, y + 8, doc.internal.pageSize.getWidth() - MARGIN_X, y + 8);
}

function drawTeamKey(
  doc: jsPDF,
  teams: Team[],
  players: Player[],
  y: number
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const captainByTeam = new Map(
    teams.map((team) => {
      const captain = players.find((player) => player.id === team.captain_player_id);
      return [team.id, captain] as const;
    })
  );

  drawSectionTitle(doc, "Team Key", y);
  y += 22;

  const columns = teams.length > 12 ? 4 : 3;
  const gap = 10;
  const cardWidth = (pageWidth - MARGIN_X * 2 - gap * (columns - 1)) / columns;
  const cardHeight = 24;

  teams.forEach((team, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const x = MARGIN_X + col * (cardWidth + gap);
    const cardY = y + row * (cardHeight + 7);

    if (cardY + cardHeight > pageHeight - FOOTER_HEIGHT - 12) {
      return;
    }

    fillColor(doc, [255, 255, 255]);
    doc.roundedRect(x, cardY, cardWidth, cardHeight, 6, 6, "F");
    doc.setDrawColor(BRAND.line[0], BRAND.line[1], BRAND.line[2]);
    doc.roundedRect(x, cardY, cardWidth, cardHeight, 6, 6, "S");

    drawColorSwatch(doc, parseTeamColor(team.color), x + 8, cardY + 8);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    textColor(doc, BRAND.ink);
    doc.text(teamNumber(index), x + 22, cardY + 15);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.6);
    doc.text(team.name, x + 42, cardY + 10, { maxWidth: cardWidth - 48 });

    const captain = captainByTeam.get(team.id);
    if (captain) {
      doc.setFontSize(6.5);
      textColor(doc, BRAND.slate);
      doc.text(`Capt. ${captain.name}`, x + 42, cardY + 20, {
        maxWidth: cardWidth - 48,
      });
    }
  });

  const renderedRows = Math.ceil(teams.length / columns);
  return y + renderedRows * (cardHeight + 7) + 14;
}

function drawFooter(doc: jsPDF, pageNumber: number, pageCount: number) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setDrawColor(BRAND.line[0], BRAND.line[1], BRAND.line[2]);
  doc.setLineWidth(0.6);
  doc.line(MARGIN_X, pageHeight - 28, pageWidth - MARGIN_X, pageHeight - 28);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  textColor(doc, BRAND.slate);
  doc.text("Generated by BenchWarmer", MARGIN_X, pageHeight - 14);
  doc.text(`Page ${pageNumber} of ${pageCount}`, pageWidth - MARGIN_X, pageHeight - 14, {
    align: "right",
  });
}

function drawPageBackground(doc: jsPDF) {
  fillColor(doc, BRAND.paper);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight(), "F");
}

function getCompactMatchup(game: Game, teamNumbers: Map<string, string>) {
  const homeNumber = teamNumbers.get(game.home_team_id) || "??";
  const awayNumber = teamNumbers.get(game.away_team_id) || "??";

  return `${homeNumber} v ${awayNumber}`;
}

function getLocationLabel(game: Game) {
  return game.venue || "Location TBD";
}

function getCourtLabel(game: Game) {
  return game.court || "Court";
}

function formatGameStatus(game: Game): string {
  if (game.status === "completed") {
    if (game.home_score !== null && game.away_score !== null) {
      return `${game.home_score}-${game.away_score}`;
    }
    return "Final";
  }

  if (game.status === "rescheduled") return "Rescheduled";
  return "Scheduled";
}

function drawCompactScheduleHeader(doc: jsPDF, league: League, games: Game[]) {
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setDrawColor(BRAND.line[0], BRAND.line[1], BRAND.line[2]);
  doc.setLineWidth(0.8);
  doc.line(MARGIN_X, 42, pageWidth - MARGIN_X, 42);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  textColor(doc, BRAND.ink);
  doc.text("Compact Schedule", MARGIN_X, 35);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  textColor(doc, BRAND.slate);
  doc.text(`${league.name}  |  ${getDateSpan(games)}`, pageWidth - MARGIN_X, 35, {
    align: "right",
  });
}

function drawWeekBlock({
  doc,
  weekNumber,
  weekGames,
  x,
  y,
  width,
  teamNumbers,
}: {
  doc: jsPDF;
  weekNumber: number;
  weekGames: Game[];
  x: number;
  y: number;
  width: number;
  teamNumbers: Map<string, string>;
}): number {
  const locationGroups = new Map<string, Game[]>();
  const timeSlots = [
    ...new Set(weekGames.map((game) => format(new Date(game.scheduled_at), "h:mm a"))),
  ].sort(
    (a, b) =>
      new Date(`2000-01-01 ${a}`).getTime() - new Date(`2000-01-01 ${b}`).getTime()
  );

  for (const game of weekGames) {
    const location = getLocationLabel(game);
    locationGroups.set(location, [...(locationGroups.get(location) || []), game]);
  }

  const tableRows: string[][] = [];
  const locationRowIndexes = new Set<number>();

  for (const [location, locationGames] of locationGroups) {
    locationRowIndexes.add(tableRows.length);
    tableRows.push([location.toUpperCase(), ...timeSlots.map(() => "")]);

    const courts = [...new Set(locationGames.map(getCourtLabel))];
    for (const court of courts) {
      const row = [court];

      for (const time of timeSlots) {
        const game = locationGames.find(
          (candidate) =>
            getCourtLabel(candidate) === court &&
            format(new Date(candidate.scheduled_at), "h:mm a") === time
        );
        const status = game ? formatGameStatus(game) : "";
        const note = game && status !== "Scheduled" ? ` ${status}` : "";
        row.push(game ? `${getCompactMatchup(game, teamNumbers)}${note}` : "");
      }

      tableRows.push(row);
    }
  }

  const firstDate = weekGames[0] ? format(new Date(weekGames[0].scheduled_at), "MMM d") : "";

  autoTable(doc, {
    startY: y,
    head: [[`Wk. ${weekNumber || "-"} ${firstDate}`, ...timeSlots]],
    body: tableRows,
    theme: "grid",
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: BRAND.ink,
      fontStyle: "bold",
      fontSize: 7,
      cellPadding: { top: 2, right: 2.5, bottom: 2, left: 2.5 },
      lineColor: BRAND.ink,
      lineWidth: 0.5,
    },
    bodyStyles: {
      fillColor: [255, 255, 255],
      fontSize: 6.4,
      textColor: BRAND.ink,
      cellPadding: { top: 1.6, right: 2.5, bottom: 1.6, left: 2.5 },
      lineColor: [84, 84, 84],
      lineWidth: 0.35,
      minCellHeight: 9,
    },
    alternateRowStyles: {
      fillColor: [255, 255, 255],
    },
    columnStyles: {
      0: { cellWidth: 62, fontStyle: "bold" },
    },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      if (locationRowIndexes.has(data.row.index)) {
        data.cell.styles.fillColor = [239, 239, 239];
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.textColor = BRAND.slate;
        data.cell.styles.fontSize = 5.8;
      }
    },
    margin: { left: x, right: doc.internal.pageSize.getWidth() - x - width },
    tableWidth: width,
    pageBreak: "avoid",
    rowPageBreak: "avoid",
  });

  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY - y;
}

export function generateSchedulePdf({
  league,
  teams,
  players,
  games,
}: ScheduleExportOptions): jsPDF {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const teamNumbers = new Map(teams.map((team, index) => [team.id, teamNumber(index)]));
  const activeGames = games
    .filter((game) => game.status !== "cancelled")
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

  const gamesByWeek = new Map<number, Game[]>();
  for (const game of activeGames) {
    const week = game.week_number || 0;
    gamesByWeek.set(week, [...(gamesByWeek.get(week) || []), game]);
  }

  const sortedWeeks = [...gamesByWeek.keys()].sort((a, b) => a - b);

  drawPageBackground(doc);
  drawHero(doc, league, activeGames);
  drawSummaryCards(doc, { teams, games: activeGames, weeks: sortedWeeks });

  drawTeamKey(doc, teams, players, 184);

  if (activeGames.length === 0) {
    const currentY = 430;
    fillColor(doc, BRAND.panel);
    doc.roundedRect(MARGIN_X, currentY, pageWidth - MARGIN_X * 2, 70, 10, 10, "F");
    doc.setDrawColor(BRAND.line[0], BRAND.line[1], BRAND.line[2]);
    doc.roundedRect(MARGIN_X, currentY, pageWidth - MARGIN_X * 2, 70, 10, 10, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    textColor(doc, BRAND.ink);
    doc.text("No scheduled games yet", pageWidth / 2, currentY + 34, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    textColor(doc, BRAND.slate);
    doc.text("Generate or add games, then export again.", pageWidth / 2, currentY + 51, {
      align: "center",
    });
  } else {
    doc.addPage();
    drawPageBackground(doc);
    drawCompactScheduleHeader(doc, league, activeGames);

    const weeksPerRow = 2;
    const gapX = 16;
    const blockWidth = (pageWidth - MARGIN_X * 2 - gapX) / weeksPerRow;
    let currentY = 60;

    for (let weekIndex = 0; weekIndex < sortedWeeks.length; weekIndex += weeksPerRow) {
      if (currentY > pageHeight - FOOTER_HEIGHT - 72) {
        doc.addPage();
        drawPageBackground(doc);
        drawCompactScheduleHeader(doc, league, activeGames);
        currentY = 60;
      }

      let rowHeight = 0;

      for (
        let column = 0;
        column < weeksPerRow && weekIndex + column < sortedWeeks.length;
        column++
      ) {
        const weekNumber = sortedWeeks[weekIndex + column];
        const weekGames = gamesByWeek.get(weekNumber) || [];
        const x = MARGIN_X + column * (blockWidth + gapX);
        const height = drawWeekBlock({
          doc,
          weekNumber,
          weekGames,
          x,
          y: currentY,
          width: blockWidth,
          teamNumbers,
        });

        rowHeight = Math.max(rowHeight, height);
      }

      currentY += rowHeight + 10;
    }
  }

  const pageCount = doc.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    doc.setPage(pageNumber);
    drawFooter(doc, pageNumber, pageCount);
  }

  return doc;
}
