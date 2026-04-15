"use client";

import { Badge } from "@/components/ui/badge";
import { Star, Clock, CalendarCheck } from "lucide-react";
import type { PreferenceApplied } from "@/lib/types";

interface PreferenceIndicatorProps {
  preferenceApplied?: PreferenceApplied | null;
  homeTeamName?: string;
  awayTeamName?: string;
  variant?: "inline" | "badge";
  size?: "sm" | "md";
}

const PREFERENCE_LABELS: Record<string, string> = {
  preferred_time: "Time",
  preferred_day: "Day",
  week_specific_time: "Week Time",
  bye_date: "Bye Date",
};

const PREFERENCE_ICONS: Record<string, typeof Clock> = {
  preferred_time: Clock,
  preferred_day: CalendarCheck,
  week_specific_time: Star,
  bye_date: CalendarCheck,
};

export function PreferenceIndicator({
  preferenceApplied,
  homeTeamName,
  awayTeamName,
  variant = "inline",
  size = "sm",
}: PreferenceIndicatorProps) {
  if (!preferenceApplied || (!preferenceApplied.home_team && !preferenceApplied.away_team)) {
    return null;
  }

  const homePrefs = preferenceApplied.home_team || [];
  const awayPrefs = preferenceApplied.away_team || [];
  const totalPrefs = homePrefs.length + awayPrefs.length;

  if (totalPrefs === 0) return null;

  if (variant === "badge") {
    return (
      <Badge
        variant="secondary"
        className="gap-1 bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
      >
        <Star className="h-3 w-3 fill-blue-700" />
        <span className="text-xs">
          {totalPrefs} Pref{totalPrefs > 1 ? "s" : ""}
        </span>
      </Badge>
    );
  }

  // Inline variant - show detailed tooltip
  return (
    <div className="flex items-center gap-1 text-xs text-blue-600">
      <Star className="h-3 w-3 fill-blue-600" />
      <span className="font-medium">Preferences Applied</span>
      {homePrefs.length > 0 && (
        <span className="text-muted-foreground">
          • {homeTeamName}: {homePrefs.map(p => PREFERENCE_LABELS[p] || p).join(", ")}
        </span>
      )}
      {awayPrefs.length > 0 && (
        <span className="text-muted-foreground">
          • {awayTeamName}: {awayPrefs.map(p => PREFERENCE_LABELS[p] || p).join(", ")}
        </span>
      )}
    </div>
  );
}

interface PreferenceTooltipProps {
  preferenceApplied?: PreferenceApplied | null;
  schedulingNotes?: string | null;
  homeTeamName: string;
  awayTeamName: string;
}

export function PreferenceTooltip({
  preferenceApplied,
  schedulingNotes,
  homeTeamName,
  awayTeamName,
}: PreferenceTooltipProps) {
  const hasPreferences = preferenceApplied &&
    (preferenceApplied.home_team?.length || preferenceApplied.away_team?.length);

  if (!hasPreferences && !schedulingNotes) {
    return null;
  }

  return (
    <div className="text-xs space-y-1 py-1">
      {hasPreferences && (
        <>
          <div className="font-medium text-blue-600 flex items-center gap-1">
            <Star className="h-3 w-3 fill-blue-600" />
            Preferences Applied
          </div>
          {preferenceApplied?.home_team && preferenceApplied.home_team.length > 0 && (
            <div className="text-muted-foreground pl-4">
              {homeTeamName}: {preferenceApplied.home_team.map(p => PREFERENCE_LABELS[p] || p).join(", ")}
            </div>
          )}
          {preferenceApplied?.away_team && preferenceApplied.away_team.length > 0 && (
            <div className="text-muted-foreground pl-4">
              {awayTeamName}: {preferenceApplied.away_team.map(p => PREFERENCE_LABELS[p] || p).join(", ")}
            </div>
          )}
        </>
      )}
      {schedulingNotes && (
        <div className="text-muted-foreground italic">
          {schedulingNotes}
        </div>
      )}
    </div>
  );
}
