import jsPDF from "jspdf";
import "jspdf-autotable";
import type { Bracket, BracketSlot, Team, Game } from "@/lib/types";
import { format } from "date-fns";

export function generateBracketPdf({
  bracket,
  slots,
  teams,
  games,
  leagueName,
}: {
  bracket: Bracket;
  slots: BracketSlot[];
  teams: Map<string, Team>;
  games: Map<string, Game>;
  leagueName: string;
}): jsPDF {
  const doc = new jsPDF({ orientation: "landscape" });
  const pageW = doc.internal.pageSize.getWidth();

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

  // Layout
  const startY = 35;
  const colWidth = (pageW - 20) / sortedRounds.length;
  const matchHeight = 16;
  const matchGap = 6;

  for (let col = 0; col < sortedRounds.length; col++) {
    const roundNum = sortedRounds[col];
    const roundSlots = rounds.get(roundNum) || [];
    const sorted = [...roundSlots].sort((a, b) => a.position - b.position);

    const x = 10 + col * colWidth;
    const spacingMultiplier = Math.pow(2, col);

    // Round label
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    const label = col === sortedRounds.length - 1 ? "Final" : `Round ${col + 1}`;
    doc.text(label, x + colWidth / 2, startY, { align: "center" });

    // Draw matchups
    for (let i = 0; i < sorted.length; i += 2) {
      if (!sorted[i + 1]) continue;
      const matchIdx = Math.floor(i / 2);
      const totalMatchups = Math.floor(sorted.length / 2);

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
      const topName = topTeam?.name ?? (bottomTeam && !topTeam ? "BYE" : "TBD");
      const seedPrefix = topSlot.seed ? `${topSlot.seed}. ` : "";
      doc.text(`${seedPrefix}${topName}`, x + 4, matchY + 5.5);

      if (isCompleted && game.home_score != null) {
        doc.text(String(game.home_score), x + boxW - 2, matchY + 5.5, { align: "right" });
      }

      // Bottom team
      const bottomName = bottomTeam?.name ?? "TBD";
      const bottomSeedPrefix = bottomSlot.seed ? `${bottomSlot.seed}. ` : "";
      doc.text(`${bottomSeedPrefix}${bottomName}`, x + 4, matchY + matchHeight - 2.5);

      if (isCompleted && game.away_score != null) {
        doc.text(String(game.away_score), x + boxW - 2, matchY + matchHeight - 2.5, { align: "right" });
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
        doc.text(`${seedPrefix}${topName}`, x + 4, matchY + 5.5);
        doc.text(`${bottomSeedPrefix}${bottomName}`, x + 4, matchY + matchHeight - 2.5);
        if (game.home_score != null) {
          doc.text(String(game.home_score), x + boxW - 2, matchY + 5.5, { align: "right" });
        }
        if (game.away_score != null) {
          doc.text(String(game.away_score), x + boxW - 2, matchY + matchHeight - 2.5, { align: "right" });
        }
      }

      // Connector lines to next round
      if (col < sortedRounds.length - 1) {
        const midY = matchY + matchHeight / 2;
        const nextX = x + colWidth;
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.3);
        doc.line(x + 2 + boxW, midY, nextX + 2, midY);
      }
    }
  }

  return doc;
}
