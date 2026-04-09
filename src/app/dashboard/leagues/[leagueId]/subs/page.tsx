"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import type { Player, SubRequest, Game, Team } from "@/lib/types";

export default function SubsPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const [subs, setSubs] = useState<Player[]>([]);
  const [requests, setRequests] = useState<SubRequest[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [subsRes, reqsRes, gamesRes, teamsRes] = await Promise.all([
        supabase
          .from("players")
          .select("*")
          .eq("league_id", leagueId)
          .eq("is_sub", true)
          .order("name"),
        supabase
          .from("sub_requests")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase
          .from("games")
          .select("*")
          .eq("league_id", leagueId)
          .eq("status", "scheduled")
          .order("scheduled_at"),
        supabase.from("teams").select("*").eq("league_id", leagueId),
      ]);
      setSubs((subsRes.data || []) as Player[]);
      setRequests((reqsRes.data || []) as SubRequest[]);
      setGames((gamesRes.data || []) as Game[]);
      setTeams((teamsRes.data || []) as Team[]);
      setLoading(false);
    }
    load();
  }, [leagueId]);

  const teamsMap = new Map(teams.map((t) => [t.id, t]));
  const subsMap = new Map(subs.map((s) => [s.id, s]));

  if (loading) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-6">
      {/* Sub pool */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Sub Pool <Badge variant="secondary">{subs.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {subs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No subs registered. Add players without a team from the Teams tab.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {subs.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center justify-between border rounded-lg p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{sub.name}</p>
                    {sub.email && (
                      <p className="text-xs text-muted-foreground">
                        {sub.email}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active sub requests */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sub Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No sub requests yet.
            </p>
          ) : (
            <div className="space-y-2">
              {requests.map((req) => {
                const game = games.find((g) => g.id === req.game_id);
                const team = teamsMap.get(req.team_id);
                const claimedBy = req.claimed_by
                  ? subsMap.get(req.claimed_by)
                  : null;

                return (
                  <div
                    key={req.id}
                    className="flex items-center justify-between border rounded-lg p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {team?.name} needs a sub
                      </p>
                      {game && (
                        <p className="text-xs text-muted-foreground">
                          {format(
                            new Date(game.scheduled_at),
                            "EEE, MMM d 'at' h:mm a"
                          )}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant={
                        req.status === "open"
                          ? "secondary"
                          : req.status === "claimed"
                          ? "default"
                          : "destructive"
                      }
                    >
                      {req.status === "claimed" && claimedBy
                        ? `Claimed: ${claimedBy.name}`
                        : req.status}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
