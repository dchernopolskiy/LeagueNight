import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/supabase/helpers";
import { redirect } from "next/navigation";
import { OpenGymManager } from "@/components/dashboard/open-gym-manager";
import type { Location, OpenGymSession } from "@/lib/types";

export default async function OpenGymPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();

  const [sessionsRes, locationsRes] = await Promise.all([
    supabase
      .from("open_gym_sessions")
      .select("*")
      .eq("organizer_id", profile.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("locations")
      .select("*")
      .eq("organizer_id", profile.id)
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
