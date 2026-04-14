"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Trophy,
  Check,
  X,
  Calendar,
  MapPin,
} from "lucide-react";
import { format } from "date-fns";
import type { Team, Location, Game, BracketSlot } from "@/lib/types";

interface Matchup {
  id: string;
  round: number;
  position: number;
  topSlot: BracketSlot;
  bottomSlot: BracketSlot;
  game: Game | null;
  bracket: "winners" | "losers" | "grand_final";
}

interface MatchupCardProps {
  matchup: Matchup;
  teamsMap: Map<string, Team>;
  locations: Location[];
  canManage: boolean;
  scoringMode: "game" | "sets";
  setsToWin: number;
  defaultDurationMinutes: number | null;
  isScoring: boolean;
  homeScore: string;
  awayScore: string;
  onStartScore: (gameId: string) => void;
  onSubmitScore: (gameId: string) => void;
  onCancelScore: () => void;
  onHomeScoreChange: (v: string) => void;
  onAwayScoreChange: (v: string) => void;
  onScheduleGame: (
    gameId: string,
    scheduledAt: string,
    locationId: string | null,
    venue: string | null
  ) => void;
}

export function MatchupCard({
  matchup,
  teamsMap,
  locations,
  canManage,
  scoringMode,
  setsToWin,
  defaultDurationMinutes,
  isScoring,
  homeScore,
  awayScore,
  onStartScore,
  onSubmitScore,
  onCancelScore,
  onHomeScoreChange,
  onAwayScoreChange,
  onScheduleGame,
}: MatchupCardProps) {
  const [scheduling, setScheduling] = useState(false);
  const [schedDate, setSchedDate] = useState("");
  const [schedTime, setSchedTime] = useState("");
  const [schedLocationId, setSchedLocationId] = useState("");
  const [schedCourt, setSchedCourt] = useState("");

  const { topSlot, bottomSlot, game } = matchup;
  const topTeam = topSlot.team_id ? teamsMap.get(topSlot.team_id) : null;
  const bottomTeam = bottomSlot.team_id
    ? teamsMap.get(bottomSlot.team_id)
    : null;

  const isCompleted = game?.status === "completed";
  const topWins =
    isCompleted &&
    game.home_score !== null &&
    game.away_score !== null &&
    game.home_score > game.away_score;
  const bottomWins =
    isCompleted &&
    game.home_score !== null &&
    game.away_score !== null &&
    game.away_score > game.home_score;

  const isBye =
    (topTeam && !bottomTeam && !bottomSlot.team_id) ||
    (!topTeam && bottomTeam && !topSlot.team_id);

  const borderColor =
    matchup.bracket === "losers"
      ? "border-orange-200"
      : matchup.bracket === "grand_final"
        ? "border-purple-200"
        : isCompleted
          ? "border-green-200"
          : "border-border";

  return (
    <div
      className={`border rounded-lg overflow-hidden ${borderColor} bg-card shadow-sm`}
    >
      {/* Top team */}
      <div
        className={`flex items-center justify-between px-2.5 py-1.5 text-sm ${
          topWins
            ? "bg-green-50 dark:bg-green-950/30 font-semibold"
            : ""
        } ${!topTeam ? "text-muted-foreground italic" : ""}`}
      >
        <span className="flex items-center gap-1.5 truncate min-w-0">
          {topSlot.seed != null && (
            <span className="text-[10px] text-muted-foreground w-3 text-right shrink-0 tabular-nums">
              {topSlot.seed}
            </span>
          )}
          <span className="truncate">
            {topTeam?.name ?? (isBye && !topTeam ? "BYE" : "TBD")}
          </span>
          {topWins && <Trophy className="h-3 w-3 text-green-600 shrink-0" />}
        </span>
        {isCompleted && game.home_score != null && (
          <span className="tabular-nums ml-2 shrink-0 text-xs">
            {game.home_score}
          </span>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-dashed" />

      {/* Bottom team */}
      <div
        className={`flex items-center justify-between px-2.5 py-1.5 text-sm ${
          bottomWins
            ? "bg-green-50 dark:bg-green-950/30 font-semibold"
            : ""
        } ${!bottomTeam ? "text-muted-foreground italic" : ""}`}
      >
        <span className="flex items-center gap-1.5 truncate min-w-0">
          {bottomSlot.seed != null && (
            <span className="text-[10px] text-muted-foreground w-3 text-right shrink-0 tabular-nums">
              {bottomSlot.seed}
            </span>
          )}
          <span className="truncate">
            {bottomTeam?.name ?? (isBye ? "BYE" : "TBD")}
          </span>
          {bottomWins && (
            <Trophy className="h-3 w-3 text-green-600 shrink-0" />
          )}
        </span>
        {isCompleted && game.away_score != null && (
          <span className="tabular-nums ml-2 shrink-0 text-xs">
            {game.away_score}
          </span>
        )}
      </div>

      {/* Score entry / action bar */}
      {canManage && game && !isCompleted && topTeam && bottomTeam && (
        <div className="border-t bg-muted/30 px-2.5 py-1.5">
          {isScoring ? (
            <div className="space-y-1">
              {scoringMode === "sets" && (
                <p className="text-[10px] text-muted-foreground">
                  Sets won (first to {setsToWin})
                </p>
              )}
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={0}
                  max={scoringMode === "sets" ? setsToWin : undefined}
                  value={homeScore}
                  onChange={(e) => onHomeScoreChange(e.target.value)}
                  className="w-12 h-6 text-xs text-center p-0"
                  placeholder={scoringMode === "sets" ? "0" : "H"}
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && onSubmitScore(game.id)}
                />
                <span className="text-muted-foreground text-xs">-</span>
                <Input
                  type="number"
                  min={0}
                  max={scoringMode === "sets" ? setsToWin : undefined}
                  value={awayScore}
                  onChange={(e) => onAwayScoreChange(e.target.value)}
                  className="w-12 h-6 text-xs text-center p-0"
                  placeholder={scoringMode === "sets" ? "0" : "A"}
                  onKeyDown={(e) => e.key === "Enter" && onSubmitScore(game.id)}
                />
                <Button
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => onSubmitScore(game.id)}
                  disabled={!homeScore || !awayScore}
                >
                  <Check className="h-3 w-3" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={onCancelScore}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ) : (
            <button
              className="text-[11px] text-primary hover:underline"
              onClick={() => onStartScore(game.id)}
            >
              Enter {scoringMode === "sets" ? "sets" : "score"}
            </button>
          )}
        </div>
      )}

      {/* Venue/time info */}
      {game && (game.venue || game.location_id) && (
        <div className="border-t px-2.5 py-1 bg-muted/20">
          <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
            <MapPin className="h-2.5 w-2.5 shrink-0" />
            {game.venue || locations.find((l) => l.id === game.location_id)?.name || ""}
            {game.court ? ` · ${game.court}` : ""}
          </p>
        </div>
      )}

      {/* Scheduled date/time */}
      {game && game.scheduled_at && (
        <div className={`border-t px-2.5 py-1 ${game.venue || game.location_id ? "" : "bg-muted/20"}`}>
          <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
            <Calendar className="h-2.5 w-2.5 shrink-0" />
            {format(new Date(game.scheduled_at), "MMM d, h:mm a")}
          </p>
        </div>
      )}

      {/* Schedule game button / form */}
      {canManage && game && !isCompleted && (
        <div className="border-t bg-muted/20 px-2.5 py-1.5">
          {scheduling ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Input
                  type="date"
                  value={schedDate}
                  onChange={(e) => setSchedDate(e.target.value)}
                  className="h-6 text-xs flex-1 px-1"
                />
                <Input
                  type="time"
                  value={schedTime}
                  onChange={(e) => setSchedTime(e.target.value)}
                  className="h-6 text-xs w-20 px-1"
                />
              </div>
              {locations.length > 0 && (
                <Select
                  value={schedLocationId || "none"}
                  onValueChange={(v) => {
                    if (!v) return;
                    setSchedLocationId(v === "none" ? "" : v);
                    setSchedCourt("");
                  }}
                >
                  <SelectTrigger className="h-6 text-xs">
                    <SelectValue placeholder="Location" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No location</SelectItem>
                    {locations.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id}>
                        {loc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {schedLocationId && (() => {
                const loc = locations.find((l) => l.id === schedLocationId);
                if (!loc || loc.court_count <= 1) return null;
                return (
                  <Select
                    value={schedCourt || "none"}
                    onValueChange={(v) => v && setSchedCourt(v === "none" ? "" : v)}
                  >
                    <SelectTrigger className="h-6 text-xs">
                      <SelectValue placeholder="Court (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Any court</SelectItem>
                      {Array.from({ length: loc.court_count }, (_, i) => i + 1).map((n) => (
                        <SelectItem key={n} value={`Court ${n}`}>
                          Court {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              })()}
              {defaultDurationMinutes && (
                <p className="text-[10px] text-muted-foreground">
                  Duration: {defaultDurationMinutes} min
                </p>
              )}
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  className="h-6 text-xs flex-1"
                  disabled={!schedDate || !schedTime}
                  onClick={() => {
                    const scheduledAt = new Date(`${schedDate}T${schedTime}`).toISOString();
                    const loc = locations.find((l) => l.id === schedLocationId);
                    const venueName = schedCourt
                      ? `${loc?.name} — ${schedCourt}`
                      : (loc?.name || null);
                    onScheduleGame(
                      game.id,
                      scheduledAt,
                      schedLocationId || null,
                      venueName
                    );
                    setScheduling(false);
                  }}
                >
                  <Check className="h-3 w-3 mr-1" />
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={() => setScheduling(false)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ) : (
            <button
              className="text-[11px] text-primary hover:underline flex items-center gap-1"
              onClick={() => {
                if (game.scheduled_at) {
                  const d = new Date(game.scheduled_at);
                  setSchedDate(format(d, "yyyy-MM-dd"));
                  setSchedTime(format(d, "HH:mm"));
                }
                setSchedLocationId(game.location_id || "");
                setSchedCourt(game.court || "");
                setScheduling(true);
              }}
            >
              <Calendar className="h-3 w-3" />
              {game.scheduled_at && (game.venue || game.location_id) ? "Reschedule" : "Schedule"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
