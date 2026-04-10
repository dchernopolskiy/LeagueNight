import { getProfile } from "@/lib/supabase/helpers";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DashboardSidebar } from "@/components/dashboard/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const [ownedRes, staffRes] = await Promise.all([
    supabase.from("leagues").select("id").eq("organizer_id", profile.id).limit(1),
    supabase.from("league_staff").select("id").eq("profile_id", profile.id).limit(1),
  ]);

  const isOrganizerOfAny =
    (ownedRes.data || []).length > 0 || (staffRes.data || []).length > 0;

  return (
    <div className="flex h-screen">
      <DashboardSidebar profile={profile} isOrganizerOfAny={isOrganizerOfAny} />
      <main className="flex-1 overflow-y-auto">
        <div className="container max-w-5xl mx-auto p-6">{children}</div>
      </main>
    </div>
  );
}
