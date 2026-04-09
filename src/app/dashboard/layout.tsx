import { getProfile } from "@/lib/supabase/helpers";
import { redirect } from "next/navigation";
import { DashboardSidebar } from "@/components/dashboard/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  return (
    <div className="flex h-screen">
      <DashboardSidebar profile={profile} />
      <main className="flex-1 overflow-y-auto">
        <div className="container max-w-5xl mx-auto p-6">{children}</div>
      </main>
    </div>
  );
}
