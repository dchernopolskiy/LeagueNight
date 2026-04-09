"use client";

import { useEffect, useState } from "react";
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
import { Plus, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import type {
  Bracket,
  BracketSlot,
  Team,
  Division,
  Game,
  Standing,
} from "@/lib/types";

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
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [expandedBrackets, setExpandedBrackets] = useState<Set<string>>(
    new Set()
  );
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [name, setName] = useState("Playoffs");
  const [numTeams, setNumTeams] = useState("8");
  const [format, setFormat] = useState<
    "single_elimination" | "double_elimination"
  >("single_elimination");
  const [seedBy, setSeedBy] = useState<"record" | "points">("record");
  const [divisionId, setDivisionId] = useState<string>("");

  useEffect(() => {
    loadData();
  }, [leagueId]);

  async function loadData() {
    const supabase = createClient();

    const [bracketsRes, teamsRes, divisionsRes, standingsRes] =
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
      ]);

    const loadedBrackets = (bracketsRes.data || []) as Bracket[];
    setTeams((teamsRes.data || []) as Team[]);
    setDivisions((divisionsRes.data || []) as Division[]);
    setStandings((standingsRes.data || []) as Standing[]);
    setBrackets(loadedBrackets);

    // Load slots and games for all brackets
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
          format,
          seedBy,
          name,
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

  async function deleteBracket(bracketId: string) {
    if (!confirm("Delete this bracket and all its playoff games?")) return;
    const supabase = createClient();
    await supabase.from("bracket_slots").delete().eq("bracket_id", bracketId);
    await supabase.from("brackets").delete().eq("id", bracketId);
    await loadData();
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
          <DialogTrigger>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              New Bracket
            </Button>
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

              <div className="space-y-1.5">
                <Label>Number of Teams</Label>
                <Input
                  type="number"
                  min={2}
                  max={Math.max(availableTeams, 2)}
                  value={numTeams}
                  onChange={(e) => setNumTeams(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {availableTeams} teams have standings.
                  {parseInt(numTeams) > 0 &&
                    Math.log2(parseInt(numTeams)) % 1 !== 0 &&
                    " Non-power-of-2 adds byes automatically."}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Format</Label>
                <Select
                  value={format}
                  onValueChange={(v) =>
                    v &&
                    setFormat(
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
                      Double Elimination
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
                  Standard seeding: #1 vs #{numTeams}, #2 vs #
                  {Math.max(parseInt(numTeams) - 1, 1)}, etc.
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

          const rounds = new Map<number, BracketSlot[]>();
          for (const slot of bracketSlots) {
            const arr = rounds.get(slot.round) || [];
            arr.push(slot);
            rounds.set(slot.round, arr);
          }
          const sortedRounds = [...rounds.keys()].sort((a, b) => a - b);

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
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteBracket(bracket.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>

              {isExpanded && (
                <CardContent>
                  <div className="flex gap-6 overflow-x-auto pb-4">
                    {sortedRounds.map((roundNum) => {
                      const roundSlots = rounds.get(roundNum) || [];
                      const matchups: {
                        top: BracketSlot;
                        bottom: BracketSlot;
                      }[] = [];
                      const sorted = [...roundSlots].sort(
                        (a, b) => a.position - b.position
                      );
                      for (let i = 0; i < sorted.length; i += 2) {
                        if (sorted[i + 1]) {
                          matchups.push({
                            top: sorted[i],
                            bottom: sorted[i + 1],
                          });
                        }
                      }

                      const isFirstRound = roundNum === sortedRounds[0];
                      const isFinal =
                        roundNum === sortedRounds[sortedRounds.length - 1];

                      return (
                        <div
                          key={roundNum}
                          className="flex flex-col gap-4 min-w-[200px]"
                        >
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider text-center">
                            {isFinal
                              ? "Final"
                              : isFirstRound
                                ? "Round 1"
                                : `Round ${roundNum}`}
                          </p>

                          <div className="flex flex-col justify-around flex-1 gap-4">
                            {matchups.map((m, idx) => {
                              const game = m.top.game_id
                                ? gamesMap.get(m.top.game_id)
                                : null;
                              const topTeam = m.top.team_id
                                ? teamsMap.get(m.top.team_id)
                                : null;
                              const bottomTeam = m.bottom.team_id
                                ? teamsMap.get(m.bottom.team_id)
                                : null;

                              const isCompleted =
                                game?.status === "completed";
                              const isBye = Boolean(
                                (topTeam && !bottomTeam) ||
                                (!topTeam && bottomTeam)
                              );

                              return (
                                <Card key={idx} className="min-w-[190px]">
                                  <CardContent className="p-0 px-3 py-2 space-y-1">
                                    <MatchupRow
                                      seed={m.top.seed}
                                      teamName={topTeam?.name ?? "TBD"}
                                      score={
                                        isCompleted ? game.home_score : null
                                      }
                                      isWinner={
                                        isCompleted &&
                                        game.home_score !== null &&
                                        game.away_score !== null &&
                                        game.home_score > game.away_score
                                      }
                                      isTBD={!topTeam}
                                      isBye={isBye && !topTeam}
                                    />
                                    <div className="border-t" />
                                    <MatchupRow
                                      seed={m.bottom.seed}
                                      teamName={
                                        bottomTeam?.name ??
                                        (isBye ? "BYE" : "TBD")
                                      }
                                      score={
                                        isCompleted ? game.away_score : null
                                      }
                                      isWinner={
                                        isCompleted &&
                                        game.home_score !== null &&
                                        game.away_score !== null &&
                                        game.away_score > game.home_score
                                      }
                                      isTBD={!bottomTeam}
                                      isBye={isBye && !bottomTeam}
                                    />
                                  </CardContent>
                                </Card>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}

function MatchupRow({
  seed,
  teamName,
  score,
  isWinner,
  isTBD,
  isBye = false,
}: {
  seed: number | null;
  teamName: string;
  score: number | null;
  isWinner: boolean;
  isTBD: boolean;
  isBye?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between text-sm ${
        isWinner ? "font-semibold" : ""
      } ${isTBD || isBye ? "text-muted-foreground italic" : ""}`}
    >
      <span className="flex items-center gap-1.5 truncate">
        {seed != null && (
          <span className="text-xs text-muted-foreground w-4 text-right shrink-0">
            {seed}
          </span>
        )}
        <span className="truncate">{teamName}</span>
      </span>
      {score != null && (
        <span className="tabular-nums ml-2 shrink-0">{score}</span>
      )}
    </div>
  );
}
