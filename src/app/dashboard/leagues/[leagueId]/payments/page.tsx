"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LeagueFee, Payment, Player } from "@/lib/types";

export default function PaymentsPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const [fees, setFees] = useState<LeagueFee[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  // New fee form
  const [amount, setAmount] = useState("");
  const [per, setPer] = useState("player");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [addingFee, setAddingFee] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [feesRes, paymentsRes, playersRes] = await Promise.all([
        supabase
          .from("league_fees")
          .select("*")
          .eq("league_id", leagueId),
        supabase.from("payments").select("*"),
        supabase
          .from("players")
          .select("*")
          .eq("league_id", leagueId)
          .eq("is_sub", false)
          .order("name"),
      ]);
      setFees((feesRes.data || []) as LeagueFee[]);
      setPayments((paymentsRes.data || []) as Payment[]);
      setPlayers((playersRes.data || []) as Player[]);
      setLoading(false);
    }
    load();
  }, [leagueId]);

  async function addFee() {
    if (!amount) return;
    setAddingFee(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("league_fees")
      .insert({
        league_id: leagueId,
        amount_cents: Math.round(parseFloat(amount) * 100),
        per,
        description: description || null,
        due_date: dueDate || null,
      })
      .select()
      .single();

    if (!error && data) {
      setFees([...fees, data as LeagueFee]);
      setAmount("");
      setDescription("");
      setDueDate("");
    }
    setAddingFee(false);
  }

  const playersMap = new Map(players.map((p) => [p.id, p]));

  if (loading) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-6">
      {/* Create fee */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Set League Fee</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-2">
              <Label>Amount ($)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="50.00"
              />
            </div>
            <div className="space-y-2">
              <Label>Per</Label>
              <Select value={per} onValueChange={(v) => v && setPer(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="player">Per player</SelectItem>
                  <SelectItem value="team">Per team</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Season fee"
              />
            </div>
            <div className="space-y-2">
              <Label>Due date</Label>
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
                <Button onClick={addFee} disabled={addingFee || !amount}>
                  Add
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment status per fee */}
      {fees.map((fee) => {
        const feePayments = payments.filter(
          (p) => p.league_fee_id === fee.id
        );
        const paidPlayerIds = new Set(
          feePayments.filter((p) => p.status === "paid").map((p) => p.player_id)
        );
        const paidCount = paidPlayerIds.size;
        const totalPlayers = players.length;

        return (
          <Card key={fee.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  {fee.description || "League Fee"} &mdash; $
                  {(fee.amount_cents / 100).toFixed(2)} / {fee.per}
                </CardTitle>
                <Badge>
                  {paidCount}/{totalPlayers} paid
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {players.map((player) => (
                    <TableRow key={player.id}>
                      <TableCell>{player.name}</TableCell>
                      <TableCell className="text-center">
                        {paidPlayerIds.has(player.id) ? (
                          <Badge>Paid</Badge>
                        ) : (
                          <Badge variant="secondary">Unpaid</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
