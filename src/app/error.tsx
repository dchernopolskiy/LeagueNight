"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // TODO: pipe to Sentry / error tracker once wired up.
    // For now, just log with the digest so it's grep-able in Vercel logs.
    console.error("[app error]", error.digest, error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-4">
        <AlertTriangle className="h-10 w-10 mx-auto text-destructive" />
        <h2 className="text-xl font-semibold">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">
          An unexpected error occurred. You can try again or head back to the dashboard.
        </p>
        {error.digest && (
          <p className="text-xs font-mono text-muted-foreground">
            Reference: {error.digest}
          </p>
        )}
        <div className="flex gap-2 justify-center">
          <Button onClick={() => unstable_retry()}>Try again</Button>
          <Button variant="outline" onClick={() => (window.location.href = "/dashboard")}>
            Go to dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
