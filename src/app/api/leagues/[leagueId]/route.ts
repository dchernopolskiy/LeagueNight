import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/supabase/helpers";
import { NextRequest, NextResponse } from "next/server";

/**
 * DELETE /api/leagues/[leagueId]
 * Permanently delete a league and all associated data.
 * Only the league organizer (owner) may do this.
 * All child records cascade-delete via DB foreign key constraints.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await params;
  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Only the organizer (owner) can delete — not staff
  const { data: league } = await supabase
    .from("leagues")
    .select("id, organizer_id")
    .eq("id", leagueId)
    .eq("organizer_id", profile.id)
    .single();

  if (!league) {
    return NextResponse.json(
      { error: "League not found or you are not the owner" },
      { status: 403 }
    );
  }

  const { error } = await supabase.from("leagues").delete().eq("id", leagueId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
