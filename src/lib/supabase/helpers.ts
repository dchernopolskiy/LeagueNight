import { createClient } from "./server";
import type { Profile } from "@/lib/types";

export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("auth_id", user.id)
    .single();

  return data;
}
