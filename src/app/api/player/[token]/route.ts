import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const patchBodySchema = z.object({
  notification_pref: z
    .object({
      sms: z.boolean().optional(),
      email: z.boolean().optional(),
      push: z.boolean().optional(),
      reminder_hours: z.number().int().min(0).max(168).optional(),
    })
    .strict()
    .optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const supabase = createAdminClient();

  const { data: player } = await supabase
    .from("players")
    .select("id, name, email, phone, notification_pref, is_sub, team_id, league_id")
    .eq("token", token)
    .single();

  if (!player) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(player);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  const { data: player } = await supabase
    .from("players")
    .select("id")
    .eq("token", token)
    .single();

  if (!player) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updates = parsed.data;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true });
  }

  const { error } = await supabase
    .from("players")
    .update(updates)
    .eq("id", player.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
