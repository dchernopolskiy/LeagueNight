import { format } from "date-fns";
import type { Game, Team } from "@/lib/types";

function icalDate(date: Date): string {
  return format(date, "yyyyMMdd'T'HHmmss");
}

function escapeIcal(str: string): string {
  return str.replace(/[\\;,\n]/g, (c) =>
    c === "\n" ? "\\n" : `\\${c}`
  );
}

export function generateIcalFeed(
  games: Game[],
  teamsMap: Map<string, Team>,
  leagueName: string,
  durationMinutes: number = 60
): string {
  const events = games
    .filter((g) => g.status !== "cancelled")
    .map((game) => {
      const home = teamsMap.get(game.home_team_id)?.name ?? "TBD";
      const away = teamsMap.get(game.away_team_id)?.name ?? "TBD";
      const start = new Date(game.scheduled_at);
      const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

      return [
        "BEGIN:VEVENT",
        `UID:${game.id}@leaguenight`,
        `DTSTART:${icalDate(start)}`,
        `DTEND:${icalDate(end)}`,
        `SUMMARY:${escapeIcal(`${home} vs ${away}`)}`,
        `DESCRIPTION:${escapeIcal(`${leagueName} - Week ${game.week_number || ""}`)}`,
        game.venue ? `LOCATION:${escapeIcal(game.venue)}` : "",
        `STATUS:${game.status === "completed" ? "CONFIRMED" : "TENTATIVE"}`,
        "END:VEVENT",
      ]
        .filter(Boolean)
        .join("\r\n");
    });

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//LeagueNight//${escapeIcal(leagueName)}//EN`,
    `X-WR-CALNAME:${escapeIcal(leagueName)}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
}
