"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRouter } from "next/navigation";
import { useState } from "react";

const SPORTS = [
  "Volleyball",
  "Basketball",
  "Kickball",
  "Softball",
  "Soccer",
  "Flag Football",
  "Dodgeball",
  "Pickleball",
  "Other",
];

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function NewLeaguePage() {
  const [name, setName] = useState("");
  const [sport, setSport] = useState("");
  const [seasonName, setSeasonName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();

    // Get current user's profile
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Not authenticated");
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("auth_id", user.id)
      .single();

    if (!profile) {
      setError("Profile not found");
      setLoading(false);
      return;
    }

    const slug = slugify(name) + "-" + Date.now().toString(36);

    const { data: league, error: insertError } = await supabase
      .from("leagues")
      .insert({
        organizer_id: profile.id,
        name,
        slug,
        sport: sport || null,
        season_name: seasonName || null,
        description: description || null,
      })
      .select()
      .single();

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    router.push(`/dashboard/leagues/${league.id}`);
  }

  return (
    <div className="max-w-lg mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Create a League</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-4">
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <div className="space-y-2">
              <Label htmlFor="name">League name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Thursday Night Volleyball"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sport">Sport</Label>
              <Select value={sport} onValueChange={(v) => v && setSport(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a sport" />
                </SelectTrigger>
                <SelectContent>
                  {SPORTS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="season">Season</Label>
              <Input
                id="season"
                value={seasonName}
                onChange={(e) => setSeasonName(e.target.value)}
                placeholder="Spring 2026"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Weekly recreational volleyball at South Sound YMCA"
                rows={3}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Creating..." : "Create League"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
