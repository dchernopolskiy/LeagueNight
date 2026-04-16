"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

/**
 * Dashboard-scoped error boundary.
 * A crash inside any dashboard page (e.g. the large playoffs component)
 * is contained here instead of unmounting the entire app shell.
 */
export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard error]", error.digest, error);
  }, [error]);

  return (
    <div className="p-6 max-w-lg mx-auto">
      <div className="border rounded-lg p-6 text-center space-y-3 bg-destructive/5 border-destructive/20">
        <AlertTriangle className="h-8 w-8 mx-auto text-destructive" />
        <h2 className="text-lg font-semibold">This page hit an error</h2>
        <p className="text-sm text-muted-foreground">
          The rest of the dashboard is still usable. Retrying usually works after a refresh.
        </p>
        {error.digest && (
          <p className="text-xs font-mono text-muted-foreground">
            Reference: {error.digest}
          </p>
        )}
        <div className="flex gap-2 justify-center">
          <Button onClick={() => unstable_retry()}>Try again</Button>
          <Button variant="outline" onClick={() => (window.location.href = "/dashboard")}>
            Back to dashboard home
          </Button>
        </div>
      </div>
    </div>
  );
}
