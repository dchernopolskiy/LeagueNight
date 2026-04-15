"use client";

import { InlineQRCode } from "@/components/ui/qr-code";
import type { League } from "@/lib/types";

interface LeaguePrintPosterProps {
  league: League;
}

export function LeaguePrintPoster({ league }: LeaguePrintPosterProps) {
  const publicUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/league/${league.slug}`
    : '';

  return (
    <div className="hidden print:block print:fixed print:inset-0 print:bg-white print:p-8">
      <div className="flex flex-col items-center justify-center h-full space-y-8">
        {/* League Name */}
        <div className="text-center space-y-4">
          <h1 className="text-6xl font-bold text-gray-900">{league.name}</h1>
          {league.sport && (
            <p className="text-2xl text-gray-600">{league.sport}</p>
          )}
          {league.season_name && (
            <p className="text-xl text-gray-500">{league.season_name}</p>
          )}
        </div>

        {/* Description */}
        {league.description && (
          <p className="text-lg text-gray-700 max-w-2xl text-center px-8">
            {league.description}
          </p>
        )}

        {/* QR Code */}
        <div className="flex flex-col items-center space-y-4">
          <InlineQRCode
            url={publicUrl}
            size={200}
            className="shadow-lg"
          />
          <div className="text-center space-y-1">
            <p className="text-sm font-semibold text-gray-700">
              Scan to view schedule & standings
            </p>
            <p className="text-xs text-gray-500 font-mono">
              {publicUrl}
            </p>
          </div>
        </div>

        {/* Additional Info */}
        {(league.season_start && league.season_end) && (
          <div className="text-center text-gray-600">
            <p className="text-sm">
              {new Date(league.season_start).toLocaleDateString()} - {new Date(league.season_end).toLocaleDateString()}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
