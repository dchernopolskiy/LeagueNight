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
} from "lucide-react";
import { format } from "date-fns";
import type {
  Bracket,
  BracketSlot,
  Team,
  Division,
  Game,
  Standing,
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

  const [brackets, setBrackets] = useState<Bracket[]>([]);
  const [allSlots, setAllSlots] = useState<Map<string, BracketSlot[]>>(
    new Map()
  );
  const [teams, setTeams] = useState<Team[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [leagueName, setLeagueName] = useState("");
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

  // Score entry
  const [scoringGame, setScoringGame] = useState<string | null>(null);
  const [homeScore, setHomeScore] = useState("");
  const [awayScore, setAwayScore] = useState("");

  useEffect(() => {
    loadData();
  }, [leagueId]);

  async function loadData() {
    const supabase = createClient();

    const [bracketsRes, teamsRes, divisionsRes, standingsRes, leagueRes] =
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
        supabase.from("leagues").select("name").eq("id", leagueId).single(),
      ]);
    setLeagueName(leagueRes.data?.name || "");

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
      // Advance winner in bracket slots
      const game = games.find((g) => g.id === gameId);
      if (game) {
        const winnerId =
          h > a ? game.home_team_id : game.away_team_id;
        const loserId =
          h > a ? game.away_team_id : game.home_team_id;

        // Find the bracket slots that reference this game
        for (const [bracketId, slots] of allSlots.entries()) {
          const matchSlots = slots.filter((s) => s.game_id === gameId);
          if (matchSlots.length >= 2) {
            const topSlot = matchSlots[0];
            // Find where winner goes
            if (topSlot.winner_to) {
              const targetSlots = slots.filter(
                (s) =>
                  !s.team_id &&
                  s.round > topSlot.round
              );
              // Try to find the slot this winner_to points to
              for (const ts of targetSlots) {
                const slotKey = `${ts.round}-${ts.position}`;
                if (
                  topSlot.winner_to.includes(`${ts.round}-${Math.floor(ts.position / 2)}`)
                ) {
                  await supabase
                    .from("bracket_slots")
                    .update({ team_id: winnerId })
                    .eq("id", ts.id);
                  break;
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
                        <SelectItem key={d.id} value={d.id} label={d.name}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

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
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteBracket(bracket.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>

              {isExpanded && (
                <CardContent>
                  <BracketView
                    slots={bracketSlots}
                    teamsMap={teamsMap}
                    gamesMap={gamesMap}
                    format={bracket.format}
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
  format,
  scoringGame,
  homeScore,
  awayScore,
  onStartScore,
  onSubmitScore,
  onCancelScore,
  onHomeScoreChange,
  onAwayScoreChange,
}: {
  slots: BracketSlot[];
  teamsMap: Map<string, Team>;
  gamesMap: Map<string, Game>;
  format: "single_elimination" | "double_elimination";
  scoringGame: string | null;
  homeScore: string;
  awayScore: string;
  onStartScore: (gameId: string) => void;
  onSubmitScore: (gameId: string) => void;
  onCancelScore: () => void;
  onHomeScoreChange: (v: string) => void;
  onAwayScoreChange: (v: string) => void;
}) {
  // Group slots into rounds
  const rounds = new Map<number, BracketSlot[]>();
  for (const slot of slots) {
    const arr = rounds.get(slot.round) || [];
    arr.push(slot);
    rounds.set(slot.round, arr);
  }
  const sortedRounds = [...rounds.keys()].sort((a, b) => a - b);

  // Determine winners bracket vs losers bracket rounds
  // Winners bracket rounds have winner_to starting with "W-" or "GF-"
  // Losers bracket rounds have winner_to starting with "L-" or their slots come from losers
  const wbRounds: number[] = [];
  const lbRounds: number[] = [];
  const gfRounds: number[] = [];

  for (const roundNum of sortedRounds) {
    const roundSlots = rounds.get(roundNum) || [];
    const hasWinner = roundSlots.some(
      (s) => s.winner_to?.startsWith("W-") || s.winner_to?.startsWith("GF-")
    );
    const hasLoser = roundSlots.some((s) => s.winner_to?.startsWith("L-"));
    const isGF = roundSlots.some(
      (s) => s.winner_to === null && roundNum === sortedRounds[sortedRounds.length - 1]
    );

    if (format === "double_elimination") {
      if (isGF && roundNum === sortedRounds[sortedRounds.length - 1]) {
        gfRounds.push(roundNum);
      } else if (hasLoser) {
        lbRounds.push(roundNum);
      } else {
        wbRounds.push(roundNum);
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
            labelFn={(r) => roundLabel(r, lbRounds, "L")}
            scoringGame={scoringGame}
            homeScore={homeScore}
            awayScore={awayScore}
            onStartScore={onStartScore}
            onSubmitScore={onSubmitScore}
            onCancelScore={onCancelScore}
            onHomeScoreChange={onHomeScoreChange}
            onAwayScoreChange={onAwayScoreChange}
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
            labelFn={() => "Championship"}
            scoringGame={scoringGame}
            homeScore={homeScore}
            awayScore={awayScore}
            onStartScore={onStartScore}
            onSubmitScore={onSubmitScore}
            onCancelScore={onCancelScore}
            onHomeScoreChange={onHomeScoreChange}
            onAwayScoreChange={onAwayScoreChange}
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
  labelFn,
  scoringGame,
  homeScore,
  awayScore,
  onStartScore,
  onSubmitScore,
  onCancelScore,
  onHomeScoreChange,
  onAwayScoreChange,
}: {
  roundNums: number[];
  matchupsByRound: Map<number, Matchup[]>;
  teamsMap: Map<string, Team>;
  labelFn: (round: number) => string;
  scoringGame: string | null;
  homeScore: string;
  awayScore: string;
  onStartScore: (gameId: string) => void;
  onSubmitScore: (gameId: string) => void;
  onCancelScore: () => void;
  onHomeScoreChange: (v: string) => void;
  onAwayScoreChange: (v: string) => void;
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
                  isScoring={scoringGame === m.game?.id}
                  homeScore={homeScore}
                  awayScore={awayScore}
                  onStartScore={onStartScore}
                  onSubmitScore={onSubmitScore}
                  onCancelScore={onCancelScore}
                  onHomeScoreChange={onHomeScoreChange}
                  onAwayScoreChange={onAwayScoreChange}
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
  isScoring,
  homeScore,
  awayScore,
  onStartScore,
  onSubmitScore,
  onCancelScore,
  onHomeScoreChange,
  onAwayScoreChange,
}: {
  matchup: Matchup;
  teamsMap: Map<string, Team>;
  isScoring: boolean;
  homeScore: string;
  awayScore: string;
  onStartScore: (gameId: string) => void;
  onSubmitScore: (gameId: string) => void;
  onCancelScore: () => void;
  onHomeScoreChange: (v: string) => void;
  onAwayScoreChange: (v: string) => void;
}) {
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
      {game && !isCompleted && topTeam && bottomTeam && (
        <div className="border-t bg-muted/30 px-2.5 py-1.5">
          {isScoring ? (
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min={0}
                value={homeScore}
                onChange={(e) => onHomeScoreChange(e.target.value)}
                className="w-12 h-6 text-xs text-center p-0"
                placeholder="H"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && onSubmitScore(game.id)}
              />
              <span className="text-muted-foreground text-xs">-</span>
              <Input
                type="number"
                min={0}
                value={awayScore}
                onChange={(e) => onAwayScoreChange(e.target.value)}
                className="w-12 h-6 text-xs text-center p-0"
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
          ) : (
            <button
              className="text-[11px] text-primary hover:underline"
              onClick={() => onStartScore(game.id)}
            >
              Enter score
            </button>
          )}
        </div>
      )}

      {/* Venue/time info */}
      {game && game.venue && (
        <div className="border-t px-2.5 py-1 bg-muted/20">
          <p className="text-[10px] text-muted-foreground truncate">
            {game.venue}
            {game.court ? ` · ${game.court}` : ""}
            {game.scheduled_at &&
              ` · ${format(new Date(game.scheduled_at), "MMM d, h:mm a")}`}
          </p>
        </div>
      )}
    </div>
  );
}
