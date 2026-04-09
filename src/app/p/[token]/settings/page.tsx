"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useParams } from "next/navigation";
import type { Player } from "@/lib/types";

export default function PlayerSettingsPage() {
  const { token } = useParams<{ token: string }>();
  const [player, setPlayer] = useState<Player | null>(null);
  const [pref, setPref] = useState("email");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/player/${token}`);
      if (res.ok) {
        const data = await res.json();
        setPlayer(data);
        setPref(data.notification_pref);
      }
    }
    load();
  }, [token]);

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/player/${token}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notification_pref: pref }),
    });
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  }

  if (!player) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-sm mx-auto p-4 space-y-6">
        <h1 className="text-xl font-bold">Notification Settings</h1>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{player.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>How should we reach you?</Label>
              <Select value={pref} onValueChange={(v) => v && setPref(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="none">None (check manually)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={save} disabled={saving} className="w-full">
              {saved ? "Saved!" : saving ? "Saving..." : "Save"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
