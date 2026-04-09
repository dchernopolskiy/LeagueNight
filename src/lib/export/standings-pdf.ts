import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { Standing, Team } from "@/lib/types";

interface StandingsExportOptions {
  leagueName: string;
  seasonName?: string;
  standings: Standing[];
  teams: Team[];
  asOfDate?: Date;
}

export function generateStandingsPdf({
  leagueName,
  seasonName,
  standings,
  teams,
  asOfDate = new Date(),
}: StandingsExportOptions): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  const teamsMap = new Map(teams.map((t) => [t.id, t]));
  const pageWidth = doc.internal.pageSize.getWidth();

  // Title
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  const title = `${leagueName.toUpperCase()} STANDINGS${seasonName ? ` ${seasonName.toUpperCase()}` : ""}`;
  doc.text(title, pageWidth / 2, 40, { align: "center" });

  // As-of date
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const dateStr = `As of ${asOfDate.toLocaleDateString("en-US", { month: "long", year: "numeric", day: "numeric" })}`;
  doc.text(dateStr, 40, 60);

  // Sort standings by rank
  const sorted = [...standings].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));

  // Build table data
  const tableData = sorted.map((s) => {
    const team = teamsMap.get(s.team_id);
    const totalGames = s.wins + s.losses + s.ties;
    const winPct = totalGames > 0 ? (s.wins / totalGames).toFixed(3) : "#DIV/0!";
    return [
      team?.name?.toUpperCase() ?? "UNKNOWN",
      s.wins.toString(),
      s.losses.toString(),
      winPct,
    ];
  });

  autoTable(doc, {
    startY: 75,
    head: [["Team", "Wins", "Losses", "Win%"]],
    body: tableData,
    theme: "plain",
    headStyles: {
      fontStyle: "bold",
      fontSize: 11,
      textColor: [0, 0, 0],
      lineWidth: { bottom: 1 },
      lineColor: [0, 0, 0],
    },
    bodyStyles: {
      fontSize: 10,
    },
    columnStyles: {
      0: { cellWidth: 250, fontStyle: "normal" },
      1: { cellWidth: 60, halign: "center" },
      2: { cellWidth: 60, halign: "center" },
      3: { cellWidth: 60, halign: "center" },
    },
    margin: { left: 40, right: 40 },
  });

  return doc;
}

/**
 * Generate a multi-division standings PDF.
 * Each division is a separate standings group rendered in a two-column layout.
 */
interface Division {
  name: string;
  standings: Standing[];
}

interface MultiDivisionExportOptions {
  leagueName: string;
  seasonName?: string;
  divisions: Division[];
  teams: Team[];
  asOfDate?: Date;
}

export function generateMultiDivisionStandingsPdf({
  leagueName,
  seasonName,
  divisions,
  teams,
  asOfDate = new Date(),
}: MultiDivisionExportOptions): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  const teamsMap = new Map(teams.map((t) => [t.id, t]));
  const pageWidth = doc.internal.pageSize.getWidth();

  // Title
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  const title = `${leagueName.toUpperCase()} STANDINGS${seasonName ? ` ${seasonName.toUpperCase()}` : ""}`;
  doc.text(title, pageWidth / 2, 40, { align: "center" });

  // Date
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  const dateStr = `As of ${asOfDate.toLocaleDateString("en-US", { month: "long", year: "numeric", day: "numeric" })}`;
  doc.text(dateStr, 40, 58);

  let cursorY = 72;
  const colWidth = (pageWidth - 80 - 20) / 2; // two columns with gap
  let col = 0;

  for (const division of divisions) {
    const sorted = [...division.standings].sort(
      (a, b) => (a.rank ?? 99) - (b.rank ?? 99)
    );

    const tableData = sorted.map((s) => {
      const team = teamsMap.get(s.team_id);
      const total = s.wins + s.losses + s.ties;
      const pct = total > 0 ? (s.wins / total).toFixed(3) : "#DIV/0!";
      return [team?.name?.toUpperCase() ?? "UNKNOWN", s.wins, s.losses, pct];
    });

    const xOffset = 40 + col * (colWidth + 20);
    const estimatedHeight = 20 + sorted.length * 16 + 30; // header + rows + padding

    // Check if we need to move to next column or page
    if (cursorY + estimatedHeight > doc.internal.pageSize.getHeight() - 40) {
      if (col === 0) {
        col = 1;
        cursorY = 72;
      } else {
        doc.addPage();
        cursorY = 40;
        col = 0;
      }
    }

    const finalX = 40 + col * (colWidth + 20);

    // Division header
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(division.name.toUpperCase(), finalX, cursorY);

    autoTable(doc, {
      startY: cursorY + 6,
      head: [["", "Wins", "Losses", "Win%"]],
      body: tableData,
      theme: "plain",
      headStyles: {
        fontStyle: "bold",
        fontSize: 8,
        textColor: [0, 0, 0],
        lineWidth: { bottom: 0.5 },
        lineColor: [0, 0, 0],
      },
      bodyStyles: { fontSize: 8, cellPadding: 2 },
      columnStyles: {
        0: { cellWidth: colWidth * 0.5 },
        1: { cellWidth: colWidth * 0.15, halign: "center" },
        2: { cellWidth: colWidth * 0.15, halign: "center" },
        3: { cellWidth: colWidth * 0.2, halign: "center" },
      },
      margin: { left: finalX, right: pageWidth - finalX - colWidth },
      tableWidth: colWidth,
    });

    // Get the final Y from autoTable
    const finalY = (doc as unknown as { lastAutoTable: { finalY: number } })
      .lastAutoTable.finalY;
    cursorY = finalY + 16;

    // If we've gone too far down, switch column
    if (cursorY > doc.internal.pageSize.getHeight() - 100 && col === 0) {
      col = 1;
      cursorY = 72;
    }
  }

  return doc;
}
