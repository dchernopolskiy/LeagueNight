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
      {/* pt-12 on mobile for top bar, pb-16 for bottom nav */}
      <main className="flex-1 overflow-y-auto pt-12 pb-20 md:pt-0 md:pb-0">
        <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 lg:px-8 md:py-8">{children}</div>
      </main>
    </div>
  );
}
