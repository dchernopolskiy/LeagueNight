import jsPDF from "jspdf";
import "jspdf-autotable";
import type { Bracket, BracketSlot, Team, Game, Location } from "@/lib/types";
import { format } from "date-fns";

/**
 * Format TBD labels to show which game this slot is waiting for
 */
function formatTBDLabel(
  slot: BracketSlot,
  allSlots: BracketSlot[]
): string {
  const sourceSlot = allSlots.find(
    (s) => s.winner_to === slot.id || s.loser_to === slot.id
  );

  if (!sourceSlot) return "TBD";

  const isWinner = sourceSlot.winner_to === slot.id;
  const hasLoserPath = sourceSlot.loser_to !== null;
  const sourceIsWB = hasLoserPath;
  const sourceIsLB = !hasLoserPath && sourceSlot.round > 1;

  const sourceSlots = allSlots.filter((s) => s.round < slot.round);
  let gameNumber = 1;

  for (const s of sourceSlots) {
    const slotHasLoserPath = s.loser_to !== null;
    const slotIsWB = slotHasLoserPath;
    const slotIsLB = !slotHasLoserPath && s.round > 1;

    if (
      (sourceIsWB && slotIsWB) ||
      (sourceIsLB && slotIsLB)
    ) {
      if (s.round < sourceSlot.round || (s.round === sourceSlot.round && s.position < sourceSlot.position)) {
        if (s.position % 2 === 0) gameNumber++;
      }
    }
  }

  const bracketPrefix = sourceIsWB ? "WB" : sourceIsLB ? "LB" : "";
  return `${isWinner ? "W" : "L"} of ${bracketPrefix} G${gameNumber}`;
}

export function generateBracketPdf({
  bracket,
  slots,
  teams,
  games,
  leagueName,
  locations = [],
}: {
  bracket: Bracket;
  slots: BracketSlot[];
  teams: Map<string, Team>;
  games: Map<string, Game>;
  leagueName: string;
  locations?: Location[];
}): jsPDF {
  const doc = new jsPDF({ orientation: "landscape" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Title
  doc.setFontSize(16);
  doc.text(leagueName, pageW / 2, 15, { align: "center" });
  doc.setFontSize(12);
  doc.text(`${bracket.name} — ${bracket.format === "single_elimination" ? "Single Elimination" : "Double Elimination"}`, pageW / 2, 22, { align: "center" });
  doc.setFontSize(8);
  doc.text(`${bracket.num_teams} teams · Generated ${format(new Date(bracket.created_at), "MMM d, yyyy")}`, pageW / 2, 27, { align: "center" });

  // Group slots into rounds
  const rounds = new Map<number, BracketSlot[]>();
  for (const slot of slots) {
    const arr = rounds.get(slot.round) || [];
    arr.push(slot);
    rounds.set(slot.round, arr);
  }
  const sortedRounds = [...rounds.keys()].sort((a, b) => a - b);

  // For double elimination, separate into WB/LB/GF
  if (bracket.format === "double_elimination") {
    const wbRounds: number[] = [];
    const lbRounds: number[] = [];
    const gfRounds: number[] = [];

    for (const roundNum of sortedRounds) {
      const roundSlots = rounds.get(roundNum) || [];
      const isGF = roundNum === sortedRounds[sortedRounds.length - 1] &&
        roundSlots.some((s) => s.winner_to === null);
      const isWB = roundSlots.some((s) => s.loser_to !== null);

      if (isGF) {
        gfRounds.push(roundNum);
      } else if (isWB) {
        wbRounds.push(roundNum);
      } else {
        lbRounds.push(roundNum);
      }
    }

    // Render Winners Bracket
    let currentY = 35;
    if (wbRounds.length > 0) {
      doc.setFontSize(10);
      doc.setTextColor(34, 197, 94); // green
      doc.text("Winners Bracket", pageW / 2, currentY, { align: "center" });
      currentY += 7;
      currentY = renderBracketSection(doc, rounds, wbRounds, slots, teams, games, locations, currentY, pageW, "W");
    }

    // Render Losers Bracket on new page
    if (lbRounds.length > 0) {
      doc.addPage();
      currentY = 15;
      doc.setFontSize(10);
      doc.setTextColor(234, 88, 12); // orange
      doc.text("Losers Bracket", pageW / 2, currentY, { align: "center" });
      currentY += 7;
      currentY = renderBracketSection(doc, rounds, lbRounds, slots, teams, games, locations, currentY, pageW, "L");
    }

    // Render Grand Final on new page
    if (gfRounds.length > 0) {
      doc.addPage();
      currentY = 15;
      doc.setFontSize(10);
      doc.setTextColor(168, 85, 247); // purple
      doc.text("Grand Final", pageW / 2, currentY, { align: "center" });
      currentY += 7;
      renderBracketSection(doc, rounds, gfRounds, slots, teams, games, locations, currentY, pageW, "GF");
    }

    return doc;
  }

  // Single elimination - use original layout
  const startY = 35;
  renderBracketSection(doc, rounds, sortedRounds, slots, teams, games, locations, startY, pageW, "");
  return doc;
}

/**
 * Render a section of the bracket (WB/LB/GF or all for single elim)
 */
function renderBracketSection(
  doc: jsPDF,
  rounds: Map<number, BracketSlot[]>,
  roundNums: number[],
  allSlots: BracketSlot[],
  teams: Map<string, Team>,
  games: Map<string, Game>,
  locations: Location[],
  startY: number,
  pageW: number,
  prefix: string
): number {
  const colWidth = (pageW - 20) / roundNums.length;
  const matchHeight = 20; // Increased for game info
  const matchGap = 8;

  for (let col = 0; col < roundNums.length; col++) {
    const roundNum = roundNums[col];
    const roundSlots = rounds.get(roundNum) || [];
    const sorted = [...roundSlots].sort((a, b) => a.position - b.position);

    const x = 10 + col * colWidth;
    const spacingMultiplier = Math.pow(2, col);

    // Round label
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    const label = col === roundNums.length - 1 && prefix === "" ? "Final" :
                  prefix ? `${prefix} R${col + 1}` : `Round ${col + 1}`;
    doc.text(label, x + colWidth / 2, startY, { align: "center" });

    // Draw matchups
    for (let i = 0; i < sorted.length; i += 2) {
      if (!sorted[i + 1]) continue;
      const matchIdx = Math.floor(i / 2);

      const baseOffset = spacingMultiplier * (matchHeight + matchGap);
      const matchY = startY + 5 + matchIdx * baseOffset +
        (spacingMultiplier - 1) * (matchHeight + matchGap) / 2;

      const topSlot = sorted[i];
      const bottomSlot = sorted[i + 1];
      const topTeam = topSlot.team_id ? teams.get(topSlot.team_id) : null;
      const bottomTeam = bottomSlot.team_id ? teams.get(bottomSlot.team_id) : null;
      const game = topSlot.game_id ? games.get(topSlot.game_id) : null;
      const isCompleted = game?.status === "completed";

      // Match box
      const boxW = colWidth - 8;
      doc.setDrawColor(180, 180, 180);
      doc.setLineWidth(0.3);
      doc.rect(x + 2, matchY, boxW, matchHeight);
      doc.line(x + 2, matchY + matchHeight / 2, x + 2 + boxW, matchY + matchHeight / 2);

      // Top team
      doc.setFontSize(7);
      doc.setTextColor(0, 0, 0);
      const topName = topTeam?.name ?? (bottomTeam && !topTeam ? "BYE" : formatTBDLabel(topSlot, allSlots));
      const seedPrefix = topSlot.seed ? `${topSlot.seed}. ` : "";
      doc.text(`${seedPrefix}${topName}`, x + 4, matchY + 5);

      if (isCompleted && game.home_score != null) {
        doc.text(String(game.home_score), x + boxW - 2, matchY + 5, { align: "right" });
      }

      // Bottom team
      const bottomName = bottomTeam?.name ?? formatTBDLabel(bottomSlot, allSlots);
      const bottomSeedPrefix = bottomSlot.seed ? `${bottomSlot.seed}. ` : "";
      doc.text(`${bottomSeedPrefix}${bottomName}`, x + 4, matchY + matchHeight / 2 + 5);

      if (isCompleted && game.away_score != null) {
        doc.text(String(game.away_score), x + boxW - 2, matchY + matchHeight / 2 + 5, { align: "right" });
      }

      // Game info (time & location)
      if (game) {
        doc.setFontSize(5);
        doc.setTextColor(120, 120, 120);
        const gameTime = game.scheduled_at ? format(new Date(game.scheduled_at), "MMM d, h:mm a") : "";
        const location = game.location_id ? locations.find(l => l.id === game.location_id)?.name || "" : "";
        const gameInfo = [gameTime, location].filter(Boolean).join(" • ");
        if (gameInfo) {
          doc.text(gameInfo, x + 4, matchY + matchHeight - 2);
        }
      }

      // Winner highlight
      if (isCompleted) {
        const winnerY = game.home_score! > game.away_score!
          ? matchY
          : matchY + matchHeight / 2;
        doc.setFillColor(220, 252, 231);
        doc.rect(x + 2, winnerY, boxW, matchHeight / 2, "F");
        doc.rect(x + 2, matchY, boxW, matchHeight);
        doc.line(x + 2, matchY + matchHeight / 2, x + 2 + boxW, matchY + matchHeight / 2);

        // Redraw text over fill
        doc.setFontSize(7);
        doc.setTextColor(0, 0, 0);
        doc.text(`${seedPrefix}${topName}`, x + 4, matchY + 5);
        doc.text(`${bottomSeedPrefix}${bottomName}`, x + 4, matchY + matchHeight / 2 + 5);
        if (game.home_score != null) {
          doc.text(String(game.home_score), x + boxW - 2, matchY + 5, { align: "right" });
        }
        if (game.away_score != null) {
          doc.text(String(game.away_score), x + boxW - 2, matchY + matchHeight / 2 + 5, { align: "right" });
        }
      }

      // Connector lines to next round
      if (col < roundNums.length - 1) {
        const midY = matchY + matchHeight / 2;
        const nextX = x + colWidth;
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.3);
        doc.line(x + 2 + boxW, midY, nextX + 2, midY);
      }
    }
  }

  return startY + 150; // Return next Y position
}
