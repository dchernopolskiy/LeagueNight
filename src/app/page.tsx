import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Calendar,
  ClipboardCheck,
  UserPlus,
  Trophy,
  CreditCard,
  MessageSquare,
  ArrowRight,
} from "lucide-react";
import { getProfile } from "@/lib/supabase/helpers";

const features = [
  {
    icon: Calendar,
    title: "Auto-Generated Schedules",
    description:
      "Round-robin schedule in one click. Handles bye weeks, multiple courts, and time slots.",
  },
  {
    icon: ClipboardCheck,
    title: "One-Tap Availability",
    description:
      "Players RSVP from a text link — no app download, no account required. You see who's in by Wednesday.",
  },
  {
    icon: UserPlus,
    title: "Sub Management",
    description:
      "League-wide sub pool. Post a request, subs claim the spot. No more chasing people.",
  },
  {
    icon: Trophy,
    title: "Live Standings",
    description:
      "Enter scores, standings update instantly. Configurable tiebreakers.",
  },
  {
    icon: CreditCard,
    title: "Collect Payments",
    description:
      "Set league fees, collect via Stripe. See who's paid and send reminders with one click.",
  },
  {
    icon: MessageSquare,
    title: "Built-in Chat",
    description:
      "League-wide announcements and team chat. One less group text to manage.",
  },
];

export default async function HomePage() {
  const profile = await getProfile();
  if (profile) redirect("/dashboard");

  return (
    <div className="flex flex-col min-h-screen">
      {/* Nav */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border/50">
        <div className="max-w-6xl mx-auto flex items-center justify-between h-14 px-4 md:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-foreground text-background flex items-center justify-center">
              <Trophy className="h-3.5 w-3.5" />
            </div>
            <span className="font-heading font-semibold tracking-tight">LeagueNight</span>
          </Link>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" render={<Link href="/login" />}>Sign in</Button>
            <Button size="sm" render={<Link href="/signup" />}>Get started</Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="flex-1">
        <div className="max-w-6xl mx-auto px-4 md:px-6 pt-28 pb-20 md:pt-40 md:pb-28 min-h-[85vh] flex flex-col items-center justify-center text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-warm/10 text-warm text-xs font-medium mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-warm animate-pulse" />
            Free for one league
          </div>
          <h1 className="font-heading text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tighter max-w-3xl mx-auto leading-[0.95]">
            The group chat that also runs your league
          </h1>
          <p className="mt-6 text-base md:text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Replace the spreadsheet + group text combo. Schedule games, track
            availability, manage subs, collect payments — all from one link.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3 w-full sm:w-auto">
            <Button size="lg" className="w-full sm:w-auto gap-2" render={<Link href="/signup" />}>
              Start for free
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" className="w-full sm:w-auto" render={<Link href="#features" />}>
              See features
            </Button>
          </div>
        </div>

        {/* Features */}
        <div
          id="features"
          className="max-w-6xl mx-auto px-4 md:px-6 pb-24 md:pb-32"
        >
          <div className="text-center mb-12 md:mb-16">
            <h2 className="font-heading text-2xl md:text-3xl font-bold tracking-tight">
              Everything your league needs
            </h2>
            <p className="mt-3 text-muted-foreground max-w-md mx-auto">
              Built by rec league organizers, for rec league organizers.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="group border border-border/60 rounded-2xl p-6 md:p-7 transition-colors hover:bg-accent/50"
              >
                <div className="h-10 w-10 rounded-xl bg-foreground/5 flex items-center justify-center mb-4">
                  <feature.icon className="h-5 w-5 text-foreground/70" />
                </div>
                <h3 className="font-heading font-semibold tracking-tight mb-1.5">
                  {feature.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="border-t">
          <div className="max-w-6xl mx-auto px-4 md:px-6 py-20 md:py-24 text-center">
            <h2 className="font-heading text-2xl md:text-3xl font-bold tracking-tight">
              Stop herding cats. Start running your league.
            </h2>
            <p className="mt-3 text-muted-foreground">
              Set up in 5 minutes. Your players don&apos;t need to download anything.
            </p>
            <Button size="lg" className="mt-8 gap-2" render={<Link href="/signup" />}>
              Create your league
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="max-w-6xl mx-auto px-4 md:px-6 text-center text-sm text-muted-foreground">
          LeagueNight &copy; {new Date().getFullYear()}
        </div>
      </footer>
    </div>
  );
}
