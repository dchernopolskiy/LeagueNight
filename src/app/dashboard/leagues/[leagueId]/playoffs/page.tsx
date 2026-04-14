"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus,
  ChevronDown,
  ChevronUp,
  Trash2,
  Download,
  Trophy,
  Check,
  X,
  Calendar,
  MapPin,
} from "lucide-react";
import { format } from "date-fns";
import { useLeagueRole } from "@/lib/league-role-context";
import type {
  Bracket,
  BracketSlot,
  Team,
  Division,
  Game,
  Standing,
  Location,
  LeagueSettings,
} from "@/lib/types";
import { generateBracketPdf } from "@/lib/export/bracket-pdf";

// ── Types ────────────────────────────────────────────────────────────
interface Matchup {
  id: string; // "W-{round}-{matchIdx}" or "L-{round}-{matchIdx}" or "GF"
  round: number;
  position: number;
  topSlot: BracketSlot;
  bottomSlot: BracketSlot;
  game: Game | null;
  bracket: "winners" | "losers" | "grand_final";
}

// ── Main Page ────────────────────────────────────────────────────────
export default function PlayoffsPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { canManage } = useLeagueRole();

  const [brackets, setBrackets] = useState<Bracket[]>([]);
  const [allSlots, setAllSlots] = useState<Map<string, BracketSlot[]>>(
    new Map()
  );
  const [teams, setTeams] = useState<Team[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [leagueName, setLeagueName] = useState("");
  const [leagueSettings, setLeagueSettings] = useState<LeagueSettings>({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [expandedBrackets, setExpandedBrackets] = useState<Set<string>>(
    new Set()
  );
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [name, setName] = useState("Playoffs");
  const [numTeams, setNumTeams] = useState("8");
  const [teamsPerBracket, setTeamsPerBracket] = useState("4");
  const [bracketFormat, setBracketFormat] = useState<
    "single_elimination" | "double_elimination"
  >("double_elimination");
  const [seedBy, setSeedBy] = useState<"record" | "points">("record");
  const [divisionId, setDivisionId] = useState<string>("");
  // Scheduling defaults for the bracket
  const [defaultLocationId, setDefaultLocationId] = useState("");
  const [defaultStartTime, setDefaultStartTime] = useState("");
  const [defaultDurationMinutes, setDefaultDurationMinutes] = useState("");

  // Score entry
  const [scoringGame, setScoringGame] = useState<string | null>(null);
  const [homeScore, setHomeScore] = useState("");
  const [awayScore, setAwayScore] = useState("");

  useEffect(() => {
    loadData();
    function onFocus() { loadData(); }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [leagueId]);

  async function loadData() {
    const supabase = createClient();

    const [bracketsRes, teamsRes, divisionsRes, standingsRes, leagueRes, locationsRes] =
      await Promise.all([
        supabase
          .from("brackets")
          .select("*")
          .eq("league_id", leagueId)
          .order("created_at"),
        supabase.from("teams").select("*").eq("league_id", leagueId),
        supabase.from("divisions").select("*").eq("league_id", leagueId),
        supabase
          .from("standings")
          .select("*")
          .eq("league_id", leagueId)
          .order("rank"),
        supabase.from("leagues").select("name, organizer_id, settings").eq("id", leagueId).single(),
        supabase.from("locations").select("*").order("name"),
      ]);
    setLeagueName(leagueRes.data?.name || "");
    if (leagueRes.data?.settings) setLeagueSettings(leagueRes.data.settings as LeagueSettings);
    // Filter locations to organizer's — locations belong to organizer, not league
    const organizerId = leagueRes.data?.organizer_id;
    setLocations(
      ((locationsRes.data || []) as Location[]).filter(
        (l) => l.organizer_id === organizerId
      )
    );

    const loadedBrackets = (bracketsRes.data || []) as Bracket[];
    setTeams((teamsRes.data || []) as Team[]);
    setDivisions((divisionsRes.data || []) as Division[]);
    setStandings((standingsRes.data || []) as Standing[]);
    setBrackets(loadedBrackets);

    if (loadedBrackets.length > 0) {
      const bracketIds = loadedBrackets.map((b) => b.id);
      const [slotsRes, gamesRes] = await Promise.all([
        supabase
          .from("bracket_slots")
          .select("*")
          .in("bracket_id", bracketIds)
          .order("round")
          .order("position"),
        supabase
          .from("games")
          .select("*")
          .eq("league_id", leagueId)
          .eq("is_playoff", true),
      ]);

      setGames((gamesRes.data || []) as Game[]);

      const slotsMap = new Map<string, BracketSlot[]>();
      for (const slot of (slotsRes.data || []) as BracketSlot[]) {
        const arr = slotsMap.get(slot.bracket_id) || [];
        arr.push(slot);
        slotsMap.set(slot.bracket_id, arr);
      }
      setAllSlots(slotsMap);
      setExpandedBrackets(new Set(bracketIds));
    }

    setLoading(false);
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/brackets/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagueId,
          divisionId: divisionId || undefined,
          numTeams: parseInt(numTeams),
          format: bracketFormat,
          seedBy,
          name,
          teamsPerBracket: parseInt(teamsPerBracket),
          defaultLocationId: defaultLocationId || undefined,
          defaultStartTime: defaultStartTime || undefined,
          defaultDurationMinutes: defaultDurationMinutes ? parseInt(defaultDurationMinutes) : undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to generate bracket");
        return;
      }

      setShowForm(false);
      await loadData();
    } finally {
      setGenerating(false);
    }
  }

  async function submitScore(gameId: string) {
    const h = parseInt(homeScore);
    const a = parseInt(awayScore);
    if (isNaN(h) || isNaN(a)) return;

    const supabase = createClient();
    const { error } = await supabase
      .from("games")
      .update({ home_score: h, away_score: a, status: "completed" })
      .eq("id", gameId);

    if (!error) {
      const game = games.find((g) => g.id === gameId);
      if (game) {
        const winnerId = h > a ? game.home_team_id : game.away_team_id;
        const loserId = h > a ? game.away_team_id : game.home_team_id;

        // Helper: parse a routing key like "W-2-0", "L-4-1", "GF-5-0"
        // and find the first empty slot in that matchup
        function findTargetSlot(
          slots: BracketSlot[],
          routingKey: string
        ): BracketSlot | null {
          // Format: PREFIX-ROUND-MATCHUP
          const parts = routingKey.split("-");
          const round = parseInt(parts[1]);
          const matchup = parseInt(parts[2]);
          // Matchup N means positions 2*N and 2*N+1
          const pos0 = matchup * 2;
          const pos1 = matchup * 2 + 1;
          return (
            slots.find(
              (s) =>
                s.round === round &&
                (s.position === pos0 || s.position === pos1) &&
                !s.team_id
            ) || null
          );
        }

        for (const [bracketId, slots] of allSlots.entries()) {
          const matchSlots = slots.filter((s) => s.game_id === gameId);
          if (matchSlots.length < 2) continue;

          const refSlot = matchSlots[0];

          // Advance winner
          if (refSlot.winner_to) {
            const target = findTargetSlot(slots, refSlot.winner_to);
            if (target) {
              await supabase
                .from("bracket_slots")
                .update({ team_id: winnerId })
                .eq("id", target.id);
            }
          }

          // Advance loser (double elimination — loser drops to LB)
          if (refSlot.loser_to) {
            const target = findTargetSlot(slots, refSlot.loser_to);
            if (target) {
              await supabase
                .from("bracket_slots")
                .update({ team_id: loserId })
                .eq("id", target.id);
            }
          }

          // Auto-create games for matchups where both teams are now filled
          // Re-read bracket to get scheduling defaults and fresh slots
          const [{ data: bracketData }, { data: freshSlots }] = await Promise.all([
            supabase.from("brackets").select("default_location_id, default_start_time, default_duration_minutes").eq("id", bracketId).single(),
            supabase.from("bracket_slots").select("*").eq("bracket_id", bracketId).order("round").order("position"),
          ]);

          // Resolve default location name
          let autoVenue: string | null = null;
          if (bracketData?.default_location_id) {
            const { data: loc } = await supabase.from("locations").select("name").eq("id", bracketData.default_location_id).single();
            autoVenue = loc?.name || null;
          }

          function buildAutoScheduledAt(): string {
            if (bracketData?.default_start_time) {
              const now = new Date();
              const [h, m] = bracketData.default_start_time.split(":").map(Number);
              now.setHours(h, m, 0, 0);
              return now.toISOString();
            }
            return new Date().toISOString();
          }

          if (freshSlots) {
            const sorted = [...freshSlots].sort(
              (a, b) => a.round - b.round || a.position - b.position
            );
            for (let si = 0; si < sorted.length; si += 2) {
              const top = sorted[si];
              const bot = sorted[si + 1];
              if (
                top &&
                bot &&
                top.team_id &&
                bot.team_id &&
                !top.game_id &&
                !bot.game_id
              ) {
                const { data: newGame } = await supabase
                  .from("games")
                  .insert({
                    league_id: leagueId,
                    home_team_id: top.team_id,
                    away_team_id: bot.team_id,
                    scheduled_at: buildAutoScheduledAt(),
                    status: "scheduled",
                    is_playoff: true,
                    ...(bracketData?.default_location_id && {
                      location_id: bracketData.default_location_id,
                      venue: autoVenue,
                    }),
                  })
                  .select("id")
                  .single();
                if (newGame) {
                  await supabase
                    .from("bracket_slots")
                    .update({ game_id: newGame.id })
                    .in("id", [top.id, bot.id]);
                }
              }
            }
          }
        }
      }

      setScoringGame(null);
      setHomeScore("");
      setAwayScore("");
      await loadData();
    }
  }

  async function scheduleGame(
    gameId: string,
    scheduledAt: string,
    locationId: string | null,
    venue: string | null
  ) {
    const supabase = createClient();
    // Extract court from venue string if formatted as "Location — Court X"
    let court: string | null = null;
    let cleanVenue = venue;
    if (venue && venue.includes(" — Court ")) {
      const parts = venue.split(" — ");
      cleanVenue = parts[0];
      court = parts[1] || null;
    }
    const { error } = await supabase
      .from("games")
      .update({ scheduled_at: scheduledAt, location_id: locationId, venue: cleanVenue, court })
      .eq("id", gameId);
    if (!error) await loadData();
  }

  async function deleteBracket(bracketId: string) {
    if (!confirm("Delete this bracket and all its playoff games?")) return;
    const supabase = createClient();
    // Delete games tied to this bracket's slots
    const bracketSlots = allSlots.get(bracketId) || [];
    const gameIds = bracketSlots
      .map((s) => s.game_id)
      .filter(Boolean) as string[];
    if (gameIds.length > 0) {
      await supabase.from("games").delete().in("id", gameIds);
    }
    await supabase.from("bracket_slots").delete().eq("bracket_id", bracketId);
    await supabase.from("brackets").delete().eq("id", bracketId);
    await loadData();
  }

  function downloadBracketPdf(bracket: Bracket) {
    const bracketSlots = allSlots.get(bracket.id) || [];
    const doc = generateBracketPdf({
      bracket,
      slots: bracketSlots,
      teams: teamsMap,
      games: gamesMap,
      leagueName,
    });
    doc.save(`${bracket.name.replace(/\s+/g, "_")}_bracket.pdf`);
  }

  function toggleBracket(bracketId: string) {
    setExpandedBrackets((prev) => {
      const next = new Set(prev);
      if (next.has(bracketId)) next.delete(bracketId);
      else next.add(bracketId);
      return next;
    });
  }

  const teamsMap = new Map(teams.map((t) => [t.id, t]));
  const gamesMap = new Map(games.map((g) => [g.id, g]));
  const availableTeams = standings.length;

  if (loading) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Playoff Brackets</h2>
        {canManage && (
          <Dialog open={showForm} onOpenChange={setShowForm}>
            <DialogTrigger render={<Button size="sm" />}>
              <Plus className="h-4 w-4 mr-1" />
              New Bracket
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Generate Playoff Bracket</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-1.5">
                  <Label htmlFor="bracket-name">Bracket Name</Label>
                  <Input
                    id="bracket-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Championship, Consolation"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Total Teams</Label>
                    <Input
                      type="number"
                      min={2}
                      max={Math.max(availableTeams, 2)}
                      value={numTeams}
                      onChange={(e) => setNumTeams(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {availableTeams} with standings
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Teams Per Bracket</Label>
                    <Select
                      value={teamsPerBracket}
                      onValueChange={(v) => v && setTeamsPerBracket(v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="2">2 (Finals)</SelectItem>
                        <SelectItem value="3">3 (Round Robin)</SelectItem>
                        <SelectItem value="4">4</SelectItem>
                        <SelectItem value="6">6</SelectItem>
                        <SelectItem value="8">8</SelectItem>
                        <SelectItem value="16">16</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Creates{" "}
                      {Math.ceil(parseInt(numTeams) / parseInt(teamsPerBracket))}{" "}
                      bracket{Math.ceil(parseInt(numTeams) / parseInt(teamsPerBracket)) > 1 ? "s" : ""}
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Format</Label>
                  <Select
                    value={bracketFormat}
                    onValueChange={(v) =>
                      v &&
                      setBracketFormat(
                        v as "single_elimination" | "double_elimination"
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single_elimination">
                        Single Elimination
                      </SelectItem>
                      <SelectItem value="double_elimination">
                        Double Elimination (Loser Bracket)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Seed By</Label>
                  <Select
                    value={seedBy}
                    onValueChange={(v) =>
                      v && setSeedBy(v as "record" | "points")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="record">Record (W-L)</SelectItem>
                      <SelectItem value="points">Points For</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Top seeds play bottom seeds. Score-matched grouping across
                    brackets.
                  </p>
                </div>

                {divisions.length > 0 && (
                  <div className="space-y-1.5">
                    <Label>Division (optional)</Label>
                    <Select
                      value={divisionId || "all"}
                      onValueChange={(v) =>
                        v && setDivisionId(v === "all" ? "" : v)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="All divisions" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All divisions</SelectItem>
                        {divisions.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="border rounded-lg p-3 space-y-3 bg-muted/20">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Scheduling Defaults</p>
                  <p className="text-xs text-muted-foreground">
                    Applied automatically to games as teams advance. You can override per-game.
                  </p>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Default location</Label>
                    <Select
                      value={defaultLocationId || "none"}
                      onValueChange={(v) => v && setDefaultLocationId(v === "none" ? "" : v)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="No default" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No default</SelectItem>
                        {locations.map((loc) => (
                          <SelectItem key={loc.id} value={loc.id}>
                            {loc.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Default start time</Label>
                      <Input
                        type="time"
                        value={defaultStartTime}
                        onChange={(e) => setDefaultStartTime(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Game duration (min)</Label>
                      <Select
                        value={defaultDurationMinutes || "none"}
                        onValueChange={(v) => v && setDefaultDurationMinutes(v === "none" ? "" : v)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {[30, 45, 60, 75, 90, 120].map((m) => (
                            <SelectItem key={m} value={m.toString()}>{m} min</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <Button
                  onClick={handleGenerate}
                  disabled={
                    generating || !name || !numTeams || parseInt(numTeams) < 2
                  }
                  className="w-full"
                >
                  {generating ? "Generating..." : "Generate Bracket"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Brackets */}
      {brackets.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-2">
              No playoff brackets yet.
            </p>
            <p className="text-sm text-muted-foreground">
              Create a bracket to generate playoff matchups from your current
              standings.
            </p>
          </CardContent>
        </Card>
      ) : (
        brackets.map((bracket) => {
          const isExpanded = expandedBrackets.has(bracket.id);
          const bracketSlots = allSlots.get(bracket.id) || [];

          return (
            <Card key={bracket.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <button
                    className="flex items-center gap-2 text-left"
                    onClick={() => toggleBracket(bracket.id)}
                  >
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                    <CardTitle className="text-base">{bracket.name}</CardTitle>
                    <Badge variant="secondary" className="text-xs">
                      {bracket.format === "single_elimination"
                        ? "Single Elim"
                        : "Double Elim"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {bracket.num_teams} teams
                    </span>
                  </button>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
                      onClick={() => downloadBracketPdf(bracket)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteBracket(bracket.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>

              {isExpanded && (
                <CardContent>
                  <BracketView
                    slots={bracketSlots}
                    teamsMap={teamsMap}
                    gamesMap={gamesMap}
                    locations={locations}
                    format={bracket.format}
                    canManage={canManage}
                    scoringMode={leagueSettings.scoring_mode || "game"}
                    setsToWin={leagueSettings.sets_to_win || 2}
                    defaultDurationMinutes={bracket.default_duration_minutes}
                    scoringGame={scoringGame}
                    homeScore={homeScore}
                    awayScore={awayScore}
                    onStartScore={(gameId) => {
                      setScoringGame(gameId);
                      const g = gamesMap.get(gameId);
                      setHomeScore(g?.home_score?.toString() || "");
                      setAwayScore(g?.away_score?.toString() || "");
                    }}
                    onSubmitScore={submitScore}
                    onCancelScore={() => {
                      setScoringGame(null);
                      setHomeScore("");
                      setAwayScore("");
                    }}
                    onHomeScoreChange={setHomeScore}
                    onAwayScoreChange={setAwayScore}
                    onScheduleGame={scheduleGame}
                  />
                </CardContent>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}

// ── Bracket Visualization ────────────────────────────────────────────

function BracketView({
  slots,
  teamsMap,
  gamesMap,
  locations,
  format,
  canManage,
  scoringMode,
  setsToWin,
  defaultDurationMinutes,
  scoringGame,
  homeScore,
  awayScore,
  onStartScore,
  onSubmitScore,
  onCancelScore,
  onHomeScoreChange,
  onAwayScoreChange,
  onScheduleGame,
}: {
  slots: BracketSlot[];
  teamsMap: Map<string, Team>;
  gamesMap: Map<string, Game>;
  locations: Location[];
  format: "single_elimination" | "double_elimination";
  canManage: boolean;
  scoringMode: "game" | "sets";
  setsToWin: number;
  defaultDurationMinutes: number | null;
  scoringGame: string | null;
  homeScore: string;
  awayScore: string;
  onStartScore: (gameId: string) => void;
  onSubmitScore: (gameId: string) => void;
  onCancelScore: () => void;
  onHomeScoreChange: (v: string) => void;
  onAwayScoreChange: (v: string) => void;
  onScheduleGame: (gameId: string, scheduledAt: string, locationId: string | null, venue: string | null) => void;
}) {
  // Group slots into rounds
  const rounds = new Map<number, BracketSlot[]>();
  for (const slot of slots) {
    const arr = rounds.get(slot.round) || [];
    arr.push(slot);
    rounds.set(slot.round, arr);
  }
  const sortedRounds = [...rounds.keys()].sort((a, b) => a - b);

  // Determine winners bracket vs losers bracket rounds.
  // WB rounds have loser_to set (they send losers to LB).
  // GF is the last round with winner_to === null.
  // Everything else is LB.
  const wbRounds: number[] = [];
  const lbRounds: number[] = [];
  const gfRounds: number[] = [];

  for (const roundNum of sortedRounds) {
    const roundSlots = rounds.get(roundNum) || [];

    if (format === "double_elimination") {
      const isGF =
        roundNum === sortedRounds[sortedRounds.length - 1] &&
        roundSlots.some((s) => s.winner_to === null);
      const isWB = roundSlots.some((s) => s.loser_to !== null);

      if (isGF) {
        gfRounds.push(roundNum);
      } else if (isWB) {
        wbRounds.push(roundNum);
      } else {
        lbRounds.push(roundNum);
      }
    } else {
      wbRounds.push(roundNum);
    }
  }

  function buildMatchups(roundNums: number[]): Map<number, Matchup[]> {
    const result = new Map<number, Matchup[]>();
    for (const roundNum of roundNums) {
      const roundSlots = rounds.get(roundNum) || [];
      const sorted = [...roundSlots].sort((a, b) => a.position - b.position);
      const matchups: Matchup[] = [];

      for (let i = 0; i < sorted.length; i += 2) {
        if (sorted[i + 1]) {
          const game = sorted[i].game_id
            ? gamesMap.get(sorted[i].game_id!) ?? null
            : null;

          const bracketType = lbRounds.includes(roundNum)
            ? "losers"
            : gfRounds.includes(roundNum)
              ? "grand_final"
              : "winners";

          matchups.push({
            id: `${bracketType[0].toUpperCase()}-${roundNum}-${Math.floor(i / 2)}`,
            round: roundNum,
            position: Math.floor(i / 2),
            topSlot: sorted[i],
            bottomSlot: sorted[i + 1],
            game,
            bracket: bracketType,
          });
        }
      }
      result.set(roundNum, matchups);
    }
    return result;
  }

  const wbMatchups = buildMatchups(wbRounds);
  const lbMatchups = buildMatchups(lbRounds);
  const gfMatchups = buildMatchups(gfRounds);

  function roundLabel(roundNum: number, roundNums: number[], prefix: string): string {
    const idx = roundNums.indexOf(roundNum);
    if (idx === roundNums.length - 1 && prefix === "W") return "WB Final";
    if (idx === roundNums.length - 1 && prefix === "L") return "LB Final";
    return `${prefix} Round ${idx + 1}`;
  }

  return (
    <div className="space-y-6">
      {/* Winners Bracket */}
      {wbRounds.length > 0 && (
        <div>
          {format === "double_elimination" && (
            <h3 className="text-sm font-semibold text-green-600 mb-3 flex items-center gap-1.5">
              <Trophy className="h-3.5 w-3.5" />
              Winners Bracket
            </h3>
          )}
          <RoundColumns
            roundNums={wbRounds}
            matchupsByRound={wbMatchups}
            teamsMap={teamsMap}
            locations={locations}
            canManage={canManage}
            scoringMode={scoringMode}
            setsToWin={setsToWin}
            defaultDurationMinutes={defaultDurationMinutes}
            labelFn={(r) =>
              format === "single_elimination"
                ? wbRounds.indexOf(r) === wbRounds.length - 1
                  ? "Final"
                  : `Round ${wbRounds.indexOf(r) + 1}`
                : roundLabel(r, wbRounds, "W")
            }
            scoringGame={scoringGame}
            homeScore={homeScore}
            awayScore={awayScore}
            onStartScore={onStartScore}
            onSubmitScore={onSubmitScore}
            onCancelScore={onCancelScore}
            onHomeScoreChange={onHomeScoreChange}
            onAwayScoreChange={onAwayScoreChange}
            onScheduleGame={onScheduleGame}
          />
        </div>
      )}

      {/* Losers Bracket */}
      {lbRounds.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-orange-600 mb-3">
            Losers Bracket
          </h3>
          <RoundColumns
            roundNums={lbRounds}
            matchupsByRound={lbMatchups}
            teamsMap={teamsMap}
            locations={locations}
            canManage={canManage}
            scoringMode={scoringMode}
            setsToWin={setsToWin}
            defaultDurationMinutes={defaultDurationMinutes}
            labelFn={(r) => roundLabel(r, lbRounds, "L")}
            scoringGame={scoringGame}
            homeScore={homeScore}
            awayScore={awayScore}
            onStartScore={onStartScore}
            onSubmitScore={onSubmitScore}
            onCancelScore={onCancelScore}
            onHomeScoreChange={onHomeScoreChange}
            onAwayScoreChange={onAwayScoreChange}
            onScheduleGame={onScheduleGame}
          />
        </div>
      )}

      {/* Grand Final */}
      {gfRounds.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-purple-600 mb-3 flex items-center gap-1.5">
            <Trophy className="h-3.5 w-3.5" />
            Grand Final
            <span className="text-xs font-normal text-muted-foreground">
              (if necessary: LB winner must beat WB winner twice)
            </span>
          </h3>
          <RoundColumns
            roundNums={gfRounds}
            matchupsByRound={gfMatchups}
            teamsMap={teamsMap}
            locations={locations}
            canManage={canManage}
            scoringMode={scoringMode}
            setsToWin={setsToWin}
            defaultDurationMinutes={defaultDurationMinutes}
            labelFn={() => "Championship"}
            scoringGame={scoringGame}
            homeScore={homeScore}
            awayScore={awayScore}
            onStartScore={onStartScore}
            onSubmitScore={onSubmitScore}
            onCancelScore={onCancelScore}
            onHomeScoreChange={onHomeScoreChange}
            onAwayScoreChange={onAwayScoreChange}
            onScheduleGame={onScheduleGame}
          />
        </div>
      )}
    </div>
  );
}

// ── Round Columns with Connecting Lines ──────────────────────────────

function RoundColumns({
  roundNums,
  matchupsByRound,
  teamsMap,
  locations,
  canManage,
  scoringMode,
  setsToWin,
  defaultDurationMinutes,
  labelFn,
  scoringGame,
  homeScore,
  awayScore,
  onStartScore,
  onSubmitScore,
  onCancelScore,
  onHomeScoreChange,
  onAwayScoreChange,
  onScheduleGame,
}: {
  roundNums: number[];
  matchupsByRound: Map<number, Matchup[]>;
  teamsMap: Map<string, Team>;
  locations: Location[];
  canManage: boolean;
  scoringMode: "game" | "sets";
  setsToWin: number;
  defaultDurationMinutes: number | null;
  labelFn: (round: number) => string;
  scoringGame: string | null;
  homeScore: string;
  awayScore: string;
  onStartScore: (gameId: string) => void;
  onSubmitScore: (gameId: string) => void;
  onCancelScore: () => void;
  onHomeScoreChange: (v: string) => void;
  onAwayScoreChange: (v: string) => void;
  onScheduleGame: (gameId: string, scheduledAt: string, locationId: string | null, venue: string | null) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-4">
      {roundNums.map((roundNum, colIdx) => {
        const matchups = matchupsByRound.get(roundNum) || [];

        // Calculate vertical spacing — later rounds need more gap to align
        const spacingMultiplier = Math.pow(2, colIdx);

        return (
          <div
            key={roundNum}
            className="flex flex-col min-w-[210px] shrink-0"
          >
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-center mb-3">
              {labelFn(roundNum)}
            </p>

            <div
              className="flex flex-col flex-1"
              style={{
                gap: `${Math.max(8, (spacingMultiplier - 1) * 48 + 8)}px`,
                justifyContent: matchups.length <= 1 ? "center" : "space-around",
              }}
            >
              {matchups.map((m) => (
                <MatchupCard
                  key={m.id}
                  matchup={m}
                  teamsMap={teamsMap}
                  locations={locations}
                  canManage={canManage}
                  scoringMode={scoringMode}
                  setsToWin={setsToWin}
                  defaultDurationMinutes={defaultDurationMinutes}
                  isScoring={scoringGame === m.game?.id}
                  homeScore={homeScore}
                  awayScore={awayScore}
                  onStartScore={onStartScore}
                  onSubmitScore={onSubmitScore}
                  onCancelScore={onCancelScore}
                  onHomeScoreChange={onHomeScoreChange}
                  onAwayScoreChange={onAwayScoreChange}
                  onScheduleGame={onScheduleGame}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Single Matchup Card ──────────────────────────────────────────────

function MatchupCard({
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
}: {
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
  onScheduleGame: (gameId: string, scheduledAt: string, locationId: string | null, venue: string | null) => void;
}) {
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
                    const newLocId = v === "none" ? "" : v;
                    setSchedLocationId(newLocId);
                    setSchedCourt(""); // reset court when location changes
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
              {/* Court selection — only if selected location has multiple courts */}
              {schedLocationId && (() => {
                const loc = locations.find((l) => l.id === schedLocationId);
                if (!loc || loc.court_count <= 1) return null;
                return (
                  <Select
                    value={schedCourt || "none"}
                    onValueChange={(v) => setSchedCourt(v === "none" ? "" : v)}
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
