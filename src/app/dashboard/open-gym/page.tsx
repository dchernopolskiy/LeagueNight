import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/supabase/helpers";
import { redirect } from "next/navigation";
import { OpenGymManager } from "@/components/dashboard/open-gym-manager";
import type { Location, OpenGymSession } from "@/lib/types";

export default async function OpenGymPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();

  // Find organizer IDs for leagues where this user is staff (co-organizer)
  const { data: staffLeagues } = await supabase
    .from("league_staff")
    .select("league:leagues!league_staff_league_id_fkey(organizer_id)")
    .eq("profile_id", profile.id);

  const organizerIds = [
    profile.id,
    ...new Set(
      (staffLeagues || [])
        .map((s: any) => s.league?.organizer_id)
        .filter((id: string | undefined): id is string => !!id && id !== profile.id)
    ),
  ];

  const [sessionsRes, locationsRes] = await Promise.all([
    supabase
      .from("open_gym_sessions")
      .select("*")
      .in("organizer_id", organizerIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("locations")
      .select("*")
      .in("organizer_id", organizerIds)
      .order("name"),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Open Gym / Court Rentals</h1>
      <OpenGymManager
        initialSessions={(sessionsRes.data || []) as OpenGymSession[]}
        locations={(locationsRes.data || []) as Location[]}
        organizerId={profile.id}
      />
    </div>
  );
}
