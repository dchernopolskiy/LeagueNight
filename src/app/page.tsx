import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Calendar,
  ClipboardCheck,
  UserPlus,
  Trophy,
  CreditCard,
  MessageSquare,
  Zap,
} from "lucide-react";

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

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Nav */}
      <header className="border-b">
        <div className="container max-w-5xl mx-auto flex items-center justify-between h-14 px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Zap className="h-5 w-5" />
            LeagueNight
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" render={<Link href="/login" />}>Sign in</Button>
            <Button size="sm" render={<Link href="/signup" />}>Get started</Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="flex-1">
        <div className="container max-w-5xl mx-auto px-4 py-20 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight max-w-2xl mx-auto">
            The group chat that also runs your league
          </h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto">
            Replace the spreadsheet + group text combo. Schedule games, track
            availability, manage subs, collect payments — all from one link.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button size="lg" render={<Link href="/signup" />}>Start for free</Button>
            <Button size="lg" variant="outline" render={<Link href="#features" />}>See features</Button>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Free for one league. No credit card required.
          </p>
        </div>

        {/* Features */}
        <div
          id="features"
          className="container max-w-5xl mx-auto px-4 pb-20"
        >
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div key={feature.title} className="border rounded-lg p-6">
                <feature.icon className="h-8 w-8 mb-3 text-primary" />
                <h3 className="font-semibold mb-1">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="border-t bg-muted/50">
          <div className="container max-w-5xl mx-auto px-4 py-16 text-center">
            <h2 className="text-2xl font-bold">
              Stop herding cats. Start running your league.
            </h2>
            <p className="mt-2 text-muted-foreground">
              Set up in 5 minutes. Your players don&apos;t need to download anything.
            </p>
            <Button size="lg" className="mt-6" render={<Link href="/signup" />}>Create your league</Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-6">
        <div className="container max-w-5xl mx-auto px-4 text-center text-sm text-muted-foreground">
          LeagueNight &copy; {new Date().getFullYear()}
        </div>
      </footer>
    </div>
  );
}
