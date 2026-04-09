"use client";

import { useEffect, useState, useCallback } from "react";

interface UnreadData {
  leagues: Record<string, number>;
  channels: Record<string, number>;
}

let cachedData: UnreadData = { leagues: {}, channels: {} };
let listeners: Set<() => void> = new Set();
let fetchTimer: ReturnType<typeof setInterval> | null = null;

async function fetchUnread() {
  try {
    const res = await fetch("/api/chat/unread");
    if (res.ok) {
      cachedData = await res.json();
      listeners.forEach((fn) => fn());
    }
  } catch {}
}

function startPolling() {
  if (fetchTimer) return;
  fetchUnread();
  fetchTimer = setInterval(fetchUnread, 30_000); // poll every 30s
}

function stopPolling() {
  if (fetchTimer && listeners.size === 0) {
    clearInterval(fetchTimer);
    fetchTimer = null;
  }
}

export function useUnread() {
  const [data, setData] = useState<UnreadData>(cachedData);

  useEffect(() => {
    const update = () => setData({ ...cachedData });
    listeners.add(update);
    startPolling();
    return () => {
      listeners.delete(update);
      stopPolling();
    };
  }, []);

  const markRead = useCallback(async (leagueId: string, channelKey: string) => {
    await fetch("/api/chat/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leagueId, channelKey }),
    });
    // Optimistically clear
    const fullKey = `${leagueId}:${channelKey}`;
    const channelCount = cachedData.channels[fullKey] || 0;
    if (channelCount > 0 && cachedData.leagues[leagueId]) {
      cachedData.leagues[leagueId] = Math.max(0, cachedData.leagues[leagueId] - channelCount);
    }
    delete cachedData.channels[fullKey];
    listeners.forEach((fn) => fn());
  }, []);

  const refresh = useCallback(() => fetchUnread(), []);

  const totalUnread = Object.values(data.leagues).reduce((a, b) => a + b, 0);

  return { ...data, totalUnread, markRead, refresh };
}
