"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, Check, ExternalLink, Plus, Trash2 } from "lucide-react";
import type { League, LeagueSettings, Division } from "@/lib/types";

export default function SettingsPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const router = useRouter();
  const [league, setLeague] = useState<League | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [seasonName, setSeasonName] = useState("");
  const [scoringMode, setScoringMode] = useState<string>("game");
  const [setsToWin, setSetsToWin] = useState("2");
  const [seasonStart, setSeasonStart] = useState("");
  const [seasonEnd, setSeasonEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [newDivName, setNewDivName] = useState("");
  const [newDivLevel, setNewDivLevel] = useState("1");
  const [addingDiv, setAddingDiv] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("leagues")
        .select("*")
        .eq("id", leagueId)
        .single();
      if (data) {
        const l = data as League;
        setLeague(l);
        setName(l.name);
        setDescription(l.description || "");
        setSeasonName(l.season_name || "");
        setSeasonStart(l.season_start || "");
        setSeasonEnd(l.season_end || "");
        const settings = l.settings as LeagueSettings;
        setScoringMode(settings.scoring_mode || "game");
        setSetsToWin(String(settings.sets_to_win || 2));
      }

      const { data: divs } = await supabase
        .from("divisions")
        .select("*")
        .eq("league_id", leagueId)
        .order("level");
      if (divs) setDivisions(divs as Division[]);
    }
    load();
  }, [leagueId]);

  async function saveSettings() {
    setSaving(true);
    const supabase = createClient();
    await supabase
      .from("leagues")
      .update({
        name,
        description: description || null,
        season_name: seasonName || null,
        season_start: seasonStart || null,
        season_end: seasonEnd || null,
        settings: {
          ...(league?.settings || {}),
          scoring_mode: scoringMode,
          sets_to_win: parseInt(setsToWin),
        },
      })
      .eq("id", leagueId);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setSaving(false);
    router.refresh();
  }

  async function addDivision() {
    if (!newDivName.trim()) return;
    setAddingDiv(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("divisions")
      .insert({
        league_id: leagueId,
        name: newDivName.trim(),
        level: parseInt(newDivLevel) || 1,
      })
      .select()
      .single();
    if (!error && data) {
      setDivisions([...divisions, data as Division]);
      setNewDivName("");
      setNewDivLevel("1");
    }
    setAddingDiv(false);
  }

  async function deleteDivision(divId: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("divisions")
      .delete()
      .eq("id", divId);
    if (!error) {
      setDivisions(divisions.filter((d) => d.id !== divId));
    }
  }

  function copyPublicLink() {
    if (!league) return;
    const url = `${window.location.origin}/league/${league.slug}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!league) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-6 max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">League Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>League name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Season</Label>
            <Input
              value={seasonName}
              onChange={(e) => setSeasonName(e.target.value)}
              placeholder="Spring 2026"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Season start</Label>
              <Input
                type="date"
                value={seasonStart}
                onChange={(e) => setSeasonStart(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Season end</Label>
              <Input
                type="date"
                value={seasonEnd}
                onChange={(e) => setSeasonEnd(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <Separator />
          <div className="space-y-2">
            <Label>Scoring mode</Label>
            <Select value={scoringMode} onValueChange={(v) => v && setScoringMode(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="game">Game won/lost (simple)</SelectItem>
                <SelectItem value="sets">Sets (volleyball-style, e.g. 2-1)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {scoringMode === "sets" && (
            <div className="space-y-2">
              <Label>Sets to win (best of)</Label>
              <Select value={setsToWin} onValueChange={(v) => v && setSetsToWin(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">Best of 3 (first to 2)</SelectItem>
                  <SelectItem value="3">Best of 5 (first to 3)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <Button onClick={saveSettings} disabled={saving}>
            {saved ? "Saved!" : saving ? "Saving..." : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Divisions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {divisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No divisions yet. Add one to group teams by skill level.
            </p>
          ) : (
            <ul className="space-y-2">
              {divisions.map((div) => (
                <li
                  key={div.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{div.name}</span>
                    <Badge variant="secondary">Level {div.level}</Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteDivision(div.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Separator />
          <div className="flex gap-2">
            <Input
              placeholder="Division name"
              value={newDivName}
              onChange={(e) => setNewDivName(e.target.value)}
              className="flex-1"
            />
            <Input
              type="number"
              min={1}
              placeholder="Level"
              value={newDivLevel}
              onChange={(e) => setNewDivLevel(e.target.value)}
              className="w-20"
            />
            <Button
              variant="outline"
              onClick={addDivision}
              disabled={addingDiv || !newDivName.trim()}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Public League Page</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <code className="text-sm bg-muted px-2 py-1 rounded flex-1 truncate">
              /league/{league.slug}
            </code>
            <Button variant="outline" size="sm" onClick={copyPublicLink}>
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
            <Button variant="outline" size="sm" render={<a href={`/league/${league.slug}`} target="_blank" rel="noopener noreferrer" />}>
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
