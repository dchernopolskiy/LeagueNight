"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Send,
  Megaphone,
  Hash,
  Shield,
  ShieldAlert,
  Users,
  MoreVertical,
  UserMinus,
  Pencil,
  Trash2,
  Layers,
  MessageCircle,
  BellOff,
  Bell,
  Check,
  X,
  Flag,
  CheckCheck,
} from "lucide-react";
import { format } from "date-fns";
import type { Message, MessageReport, Player, Team, Division } from "@/lib/types";
import { useUnread } from "@/lib/hooks/use-unread";
import { checkMessageContent } from "@/lib/chat/content-filter";

type ChannelType = Message["channel_type"];

interface Channel {
  key: string;
  label: string;
  type: ChannelType;
  teamId: string | null;
  divisionId: string | null;
  icon: typeof Hash;
  section: string;
}

export default function ChatPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null);
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(null);
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [selectedChannelKey, setSelectedChannelKey] = useState<string | null>(null);
  const [mutedChannels, setMutedChannels] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Edit state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  // Delete confirm
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [organizerName, setOrganizerName] = useState<string>("Organizer");

  // Report state
  const [reportingMessageId, setReportingMessageId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState<MessageReport["reason"]>("spam");
  const [reportDetails, setReportDetails] = useState("");
  const [reportStatus, setReportStatus] = useState<string | null>(null);

  // Moderation queue state
  const [modQueueOpen, setModQueueOpen] = useState(false);
  const [pendingReports, setPendingReports] = useState<
    (MessageReport & { message_body?: string; reporter_name?: string })[]
  >([]);

  // Content filter error
  const [filterError, setFilterError] = useState<string | null>(null);

  // Announcement confirmation
  const [announcementStatus, setAnnouncementStatus] = useState<string | null>(null);
  const { channels: channelUnread, markRead, markAllRead } = useUnread();

  // Find the player's team(s) and division(s)
  const myPlayerRecord = useMemo(() => {
    if (!currentPlayerId) return null;
    return players.find((p) => p.id === currentPlayerId) || null;
  }, [currentPlayerId, players]);

  const myTeamIds = useMemo(() => {
    if (!currentPlayerId) return new Set<string>();
    return new Set(
      players
        .filter((p) => p.profile_id === myPlayerRecord?.profile_id && p.team_id)
        .map((p) => p.team_id!)
    );
  }, [currentPlayerId, myPlayerRecord, players]);

  const myDivisionIds = useMemo(() => {
    const divIds = new Set<string>();
    for (const tid of myTeamIds) {
      const team = teams.find((t) => t.id === tid);
      if (team?.division_id) divIds.add(team.division_id);
    }
    return divIds;
  }, [myTeamIds, teams]);

  // Build channel list
  const channels = useMemo<Channel[]>(() => {
    const list: Channel[] = [];

    // League chat — always visible
    list.push({ key: "league", label: "League Chat", type: "league", teamId: null, divisionId: null, icon: Hash, section: "General" });

    // Organizer channel — only for organizers/staff
    if (isOrganizer) {
      list.push({ key: "organizer", label: "Organizer", type: "organizer", teamId: null, divisionId: null, icon: Shield, section: "General" });
    }

    // Division channels
    for (const div of divisions) {
      // Players only see their own division
      if (!isOrganizer && !myDivisionIds.has(div.id)) continue;
      list.push({
        key: `division-${div.id}`,
        label: div.name,
        type: "division",
        teamId: null,
        divisionId: div.id,
        icon: Layers,
        section: "Divisions",
      });
    }

    // Team channels
    for (const team of teams) {
      // Players only see their own team
      if (!isOrganizer && !myTeamIds.has(team.id)) continue;
      list.push({
        key: `team-${team.id}`,
        label: team.name,
        type: "team",
        teamId: team.id,
        divisionId: null,
        icon: Users,
        section: "Teams",
      });
    }

    // Direct messages (captain ↔ organizer) — only show if current user is a captain or organizer
    if (isOrganizer) {
      for (const team of teams) {
        if (team.captain_player_id) {
          const captain = players.find((p) => p.id === team.captain_player_id);
          if (captain) {
            list.push({
              key: `direct-${team.id}`,
              label: `DM: ${captain.name}`,
              type: "direct",
              teamId: team.id,
              divisionId: null,
              icon: MessageCircle,
              section: "Direct Messages",
            });
          }
        }
      }
    } else if (currentPlayerId) {
      const myTeam = teams.find((t) => t.captain_player_id === currentPlayerId);
      if (myTeam) {
        list.push({
          key: `direct-${myTeam.id}`,
          label: "DM: Organizer",
          type: "direct",
          teamId: myTeam.id,
          divisionId: null,
          icon: MessageCircle,
          section: "Direct Messages",
        });
      }
    }

    return list;
  }, [teams, divisions, players, currentPlayerId, isOrganizer, myTeamIds, myDivisionIds]);

  // Resolve initial channel from URL params (?channel=organizer, ?division=id, ?team=id)
  // Only applies if user hasn't manually switched channels this session.
  const urlChannelKey = useMemo(() => {
    const ch = searchParams.get("channel");
    const div = searchParams.get("division");
    const team = searchParams.get("team");
    if (ch) return ch;
    if (div) return `division-${div}`;
    if (team) return `team-${team}`;
    return null;
  }, [searchParams]);

  const activeChannel = useMemo(() => {
    const key = selectedChannelKey ?? urlChannelKey;
    if (key) {
      return channels.find((c) => c.key === key) ?? channels[0] ?? null;
    }
    return channels[0] ?? null;
  }, [channels, selectedChannelKey, urlChannelKey]);

  const isTeamCaptain = useMemo(() => {
    if (!activeChannel || activeChannel.type !== "team" || !currentPlayerId) return false;
    const team = teams.find((t) => t.id === activeChannel.teamId);
    return team?.captain_player_id === currentPlayerId;
  }, [activeChannel, currentPlayerId, teams]);

  // Load initial data
  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, full_name")
          .eq("auth_id", user.id)
          .single();

        if (profile) {
          setCurrentProfileId(profile.id);

          // Check if organizer or co-organizer
          const [leagueCheck, staffCheck] = await Promise.all([
            supabase.from("leagues").select("organizer_id").eq("id", leagueId).single(),
            supabase.from("league_staff").select("id").eq("league_id", leagueId).eq("profile_id", profile.id),
          ]);

          if ((leagueCheck.data && leagueCheck.data.organizer_id === profile.id) || (staffCheck.data && staffCheck.data.length > 0)) {
            setIsOrganizer(true);
            setOrganizerName(profile.full_name || "Organizer");
          }

          const { data: existingPlayer } = await supabase
            .from("players")
            .select("id")
            .eq("league_id", leagueId)
            .eq("profile_id", profile.id)
            .single();

          if (existingPlayer) {
            setCurrentPlayerId(existingPlayer.id);
          }
        }
      }

      const [playersRes, teamsRes, divisionsRes] = await Promise.all([
        supabase.from("players").select("*").eq("league_id", leagueId),
        supabase.from("teams").select("*").eq("league_id", leagueId),
        supabase.from("divisions").select("*").eq("league_id", leagueId).order("level"),
      ]);
      setPlayers((playersRes.data || []) as Player[]);
      setTeams((teamsRes.data || []) as Team[]);
      setDivisions((divisionsRes.data || []) as Division[]);
    }
    load();
  }, [leagueId]);

  // Mark channel as read when switching
  useEffect(() => {
    if (activeChannel) {
      markRead(leagueId, activeChannel.key);
    }
  }, [activeChannel, leagueId, markRead]);

  // Load messages when active channel changes
  useEffect(() => {
    if (!activeChannel) return;

    async function loadMessages() {
      const supabase = createClient();
      let query = supabase
        .from("messages")
        .select("*")
        .eq("league_id", leagueId)
        .eq("channel_type", activeChannel!.type)
        .is("deleted_at", null)
        .order("created_at")
        .limit(100);

      if (activeChannel!.type === "team" && activeChannel!.teamId) {
        query = query.eq("team_id", activeChannel!.teamId);
      } else if (activeChannel!.type === "division" && activeChannel!.divisionId) {
        query = query.eq("division_id", activeChannel!.divisionId);
      } else if (activeChannel!.type === "direct" && activeChannel!.teamId) {
        query = query.eq("team_id", activeChannel!.teamId);
      } else if (activeChannel!.type === "league" || activeChannel!.type === "organizer") {
        query = query.is("team_id", null).is("division_id", null);
      }

      const { data } = await query;
      setMessages((data || []) as Message[]);
    }
    loadMessages();
  }, [activeChannel, leagueId]);

  // Realtime subscription
  useEffect(() => {
    if (!activeChannel) return;

    const supabase = createClient();
    const channelName = `messages:${leagueId}:${activeChannel.key}`;
    const realtimeChannel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `league_id=eq.${leagueId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const newMsg = payload.new as Message;
            if (newMsg.deleted_at) return;
            if (newMsg.channel_type !== activeChannel.type) return;
            if (activeChannel.type === "team" && newMsg.team_id !== activeChannel.teamId) return;
            if (activeChannel.type === "division" && newMsg.division_id !== activeChannel.divisionId) return;
            if (activeChannel.type === "direct" && newMsg.team_id !== activeChannel.teamId) return;
            if ((activeChannel.type === "league" || activeChannel.type === "organizer") && (newMsg.team_id || newMsg.division_id)) return;
            setMessages((prev) => [...prev, newMsg]);
          } else if (payload.eventType === "UPDATE") {
            const updated = payload.new as Message;
            setMessages((prev) =>
              prev.map((m) => (m.id === updated.id ? updated : m)).filter((m) => !m.deleted_at)
            );
          } else if (payload.eventType === "DELETE") {
            const deleted = payload.old as { id: string };
            setMessages((prev) => prev.filter((m) => m.id !== deleted.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(realtimeChannel);
    };
  }, [leagueId, activeChannel]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const playersMap = useMemo(
    () => new Map(players.map((p) => [p.id, p])),
    [players]
  );

  async function sendMessage(isAnnouncement = false) {
    if (!body.trim() || (!currentPlayerId && !isOrganizer) || !activeChannel) return;

    // Content filter check
    const filterResult = checkMessageContent(body);
    if (!filterResult.ok) {
      setFilterError(filterResult.reason || "Message blocked");
      setTimeout(() => setFilterError(null), 3000);
      return;
    }

    setSending(true);
    const supabase = createClient();

    if (isAnnouncement && isOrganizer) {
      // Broadcast announcement to ALL channels in the league
      const messageBase = {
        league_id: leagueId,
        player_id: currentPlayerId || null,
        profile_id: currentProfileId,
        body: body.trim(),
        is_announcement: true,
      };

      // Announcements only go to League Chat and Organizer Chat.
      // Players who check any channel will see it in League Chat.
      // Division/team channels are left clean for focused discussion.
      const payloads: Record<string, unknown>[] = [
        { ...messageBase, channel_type: "league", team_id: null, division_id: null },
        { ...messageBase, channel_type: "organizer", team_id: null, division_id: null },
      ];

      const { error } = await supabase.from("messages").insert(payloads);
      if (error) {
        console.error("Failed to send announcement:", error);
      } else {
        setAnnouncementStatus("Announcement sent to League Chat & Organizer Chat");
        setTimeout(() => setAnnouncementStatus(null), 3000);
      }
    } else {
      const payload: Record<string, unknown> = {
        league_id: leagueId,
        player_id: currentPlayerId || null,
        profile_id: currentProfileId,
        body: body.trim(),
        is_announcement: false,
        channel_type: activeChannel.type,
        team_id: activeChannel.teamId,
        division_id: activeChannel.divisionId,
      };

      if (activeChannel.type === "direct") {
        payload.recipient_profile_id = currentProfileId;
      }

      const { error } = await supabase.from("messages").insert(payload);
      if (error) console.error("Failed to send message:", error);
    }

    setBody("");
    setSending(false);
  }

  async function submitReport() {
    if (!reportingMessageId || !currentProfileId) return;
    const supabase = createClient();
    const { error } = await supabase.from("message_reports").insert({
      message_id: reportingMessageId,
      reporter_profile_id: currentProfileId,
      reason: reportReason,
      details: reportDetails.trim() || null,
    });

    if (error) {
      if (error.code === "23505") {
        setReportStatus("You have already reported this message");
      } else {
        console.error("Failed to submit report:", error);
        setReportStatus("Failed to submit report");
      }
    } else {
      setReportStatus("Report submitted");
    }

    setTimeout(() => {
      setReportStatus(null);
      setReportingMessageId(null);
      setReportReason("spam");
      setReportDetails("");
    }, 2000);
  }

  async function loadPendingReports() {
    const supabase = createClient();

    // Get all message IDs for this league that are pending
    const { data: reports } = await supabase
      .from("message_reports")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (!reports || reports.length === 0) {
      setPendingReports([]);
      return;
    }

    // Get message bodies and reporter names
    const messageIds = [...new Set(reports.map((r: MessageReport) => r.message_id))];
    const reporterIds = [...new Set(reports.map((r: MessageReport) => r.reporter_profile_id))];

    const [messagesRes, profilesRes] = await Promise.all([
      supabase.from("messages").select("id, body, league_id").in("id", messageIds).eq("league_id", leagueId),
      supabase.from("profiles").select("id, full_name").in("id", reporterIds),
    ]);

    const msgMap = new Map((messagesRes.data || []).map((m: { id: string; body: string }) => [m.id, m.body]));
    const profileMap = new Map((profilesRes.data || []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]));

    // Only show reports for messages in this league
    const leagueReports = reports
      .filter((r: MessageReport) => msgMap.has(r.message_id))
      .map((r: MessageReport) => ({
        ...r,
        message_body: msgMap.get(r.message_id) || "(deleted)",
        reporter_name: profileMap.get(r.reporter_profile_id) || "Unknown",
      }));

    setPendingReports(leagueReports);
  }

  async function dismissReport(reportId: string) {
    const supabase = createClient();
    await supabase
      .from("message_reports")
      .update({ status: "dismissed", reviewed_by: currentProfileId, reviewed_at: new Date().toISOString() })
      .eq("id", reportId);
    setPendingReports((prev) => prev.filter((r) => r.id !== reportId));
  }

  async function actionReport(reportId: string, messageId: string) {
    const supabase = createClient();
    // Soft-delete the message
    await supabase.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", messageId);
    // Mark report as actioned
    await supabase
      .from("message_reports")
      .update({ status: "actioned", reviewed_by: currentProfileId, reviewed_at: new Date().toISOString() })
      .eq("id", reportId);
    // Remove from local messages and reports
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    setPendingReports((prev) => prev.filter((r) => r.id !== reportId));
  }

  async function editMessage(messageId: string) {
    if (!editBody.trim()) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("messages")
      .update({ body: editBody.trim(), edited_at: new Date().toISOString() })
      .eq("id", messageId);

    if (!error) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, body: editBody.trim(), edited_at: new Date().toISOString() }
            : m
        )
      );
      setEditingMessageId(null);
      setEditBody("");
    }
  }

  async function deleteMessage(messageId: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", messageId);

    if (!error) {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      setDeleteConfirmId(null);
    }
  }

  async function toggleMute(channelKey: string) {
    setMutedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(channelKey)) {
        next.delete(channelKey);
      } else {
        next.add(channelKey);
      }
      return next;
    });
  }

  async function removeFromTeam(playerId: string) {
    const supabase = createClient();
    await supabase.from("players").update({ team_id: null }).eq("id", playerId);
    setPlayers((prev) => prev.map((p) => (p.id === playerId ? { ...p, team_id: null } : p)));
  }

  function canEditDelete(msg: Message): boolean {
    if (isOrganizer) return true;
    if (msg.player_id && msg.player_id === currentPlayerId) return true;
    if (msg.profile_id && msg.profile_id === currentProfileId) return true;
    return false;
  }

  // Group channels by section
  const channelsBySection = useMemo(() => {
    const map = new Map<string, Channel[]>();
    for (const ch of channels) {
      const arr = map.get(ch.section) || [];
      arr.push(ch);
      map.set(ch.section, arr);
    }
    return map;
  }, [channels]);

  return (
    <div className="flex gap-0 md:gap-4" style={{ height: "calc(100vh - 240px)" }}>
      {/* Channel sidebar */}
      <div className="w-full md:w-60 shrink-0 border-b md:border-b-0 md:border-r overflow-x-auto md:overflow-y-auto">
        <div className="flex md:flex-col gap-0.5 p-2">
          {[...channelsBySection.entries()].map(([section, sectionChannels]) => (
            <div key={section} className="md:mb-2">
              <p className="hidden md:block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-1">
                {section}
              </p>
              {sectionChannels.map((ch) => {
                const isMuted = mutedChannels.has(ch.key);
                const chUnread = channelUnread[`${leagueId}:${ch.key}`] || 0;
                return (
                  <button
                    key={ch.key}
                    onClick={() => setSelectedChannelKey(ch.key)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors w-full text-left ${
                      activeChannel?.key === ch.key
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-muted-foreground hover:bg-accent/50"
                    } ${isMuted ? "opacity-50" : ""}`}
                  >
                    <ch.icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate flex-1">{ch.label}</span>
                    {isMuted && <BellOff className="h-3 w-3 shrink-0" />}
                    {!isMuted && chUnread > 0 && activeChannel?.key !== ch.key && (
                      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary text-primary-foreground text-[9px] font-semibold px-0.5 shrink-0">
                        {chUnread > 99 ? "99+" : chUnread}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Chat area */}
      <Card className="flex-1 flex flex-col min-h-0">
        {/* Channel header */}
        <div className="px-4 py-3 border-b flex items-center gap-2">
          {activeChannel && (
            <>
              <activeChannel.icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{activeChannel.label}</span>
              {activeChannel.type === "organizer" && (
                <Badge variant="secondary" className="text-xs">Organizer Only</Badge>
              )}
              {activeChannel.type === "division" && (
                <Badge variant="outline" className="text-xs">Division</Badge>
              )}
              {activeChannel.type === "direct" && (
                <Badge variant="outline" className="text-xs">Private</Badge>
              )}
              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => markAllRead(leagueId)}
                  title="Mark all channels as read"
                >
                  <CheckCheck className="h-3.5 w-3.5 text-muted-foreground mr-1" />
                  <span className="text-xs">Mark All Read</span>
                </Button>
                {isOrganizer && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => {
                      loadPendingReports();
                      setModQueueOpen(true);
                    }}
                    title="Moderation queue"
                  >
                    <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => toggleMute(activeChannel.key)}
                  title={mutedChannels.has(activeChannel.key) ? "Unmute" : "Mute"}
                >
                  {mutedChannels.has(activeChannel.key) ? (
                    <BellOff className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <Bell className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Messages */}
        <CardContent className="flex-1 overflow-y-auto space-y-3 pb-0 pt-3">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No messages yet. Start the conversation!
            </p>
          )}
          {messages.map((msg) => {
            const sender = msg.player_id ? playersMap.get(msg.player_id) : null;
            const senderName = sender?.name ?? (msg.profile_id === currentProfileId && isOrganizer ? organizerName : "Organizer");
            const isEditing = editingMessageId === msg.id;
            const isOwn = msg.player_id === currentPlayerId || msg.profile_id === currentProfileId;

            if (isEditing) {
              return (
                <div key={msg.id} className="space-y-1 bg-muted/30 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{senderName}</span>
                    <Badge variant="outline" className="text-[10px]">Editing</Badge>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") editMessage(msg.id);
                        if (e.key === "Escape") {
                          setEditingMessageId(null);
                          setEditBody("");
                        }
                      }}
                      autoFocus
                      className="flex-1"
                    />
                    <Button size="sm" onClick={() => editMessage(msg.id)}>
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingMessageId(null);
                        setEditBody("");
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            }

            return (
              <div key={msg.id} className="group space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {senderName}
                  </span>
                  {msg.is_announcement && (
                    <Badge variant="secondary" className="text-xs">
                      <Megaphone className="h-3 w-3 mr-1" />
                      Announcement
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(msg.created_at), "MMM d, h:mm a")}
                  </span>
                  {msg.edited_at && (
                    <span className="text-[10px] text-muted-foreground italic">(edited)</span>
                  )}

                  {/* Message actions */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 ml-auto">
                    {canEditDelete(msg) && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => {
                            setEditingMessageId(msg.id);
                            setEditBody(msg.body);
                          }}
                          title="Edit"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 hover:text-destructive"
                          onClick={() => setDeleteConfirmId(msg.id)}
                          title="Unsend"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </>
                    )}
                    {!isOwn && currentProfileId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 hover:text-orange-500"
                        onClick={() => setReportingMessageId(msg.id)}
                        title="Report"
                      >
                        <Flag className="h-3 w-3" />
                      </Button>
                    )}
                  </div>

                  {/* Captain remove from team */}
                  {isTeamCaptain && sender && sender.id !== currentPlayerId && (
                    <DropdownMenu>
                      <DropdownMenuTrigger>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <MoreVertical className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => removeFromTeam(sender.id)}
                          className="text-destructive"
                        >
                          <UserMinus className="h-4 w-4 mr-2" />
                          Remove from team
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                <p className="text-sm">{msg.body}</p>
              </div>
            );
          })}
          <div ref={scrollRef} />
        </CardContent>

        {/* Message input */}
        <div className="p-4 border-t">
          {filterError && (
            <p className="text-sm text-destructive text-center mb-2">{filterError}</p>
          )}
          {announcementStatus && (
            <p className="text-sm text-green-600 text-center mb-2">{announcementStatus}</p>
          )}
          {!currentPlayerId && !isOrganizer ? (
            <p className="text-sm text-muted-foreground text-center">
              Add yourself as a player or sign in as organizer to participate in chat.
            </p>
          ) : (
            <div className="flex gap-2">
              <Input
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={`Message ${activeChannel?.label || ""}...`}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                disabled={sending}
              />
              <Button
                size="sm"
                onClick={() => sendMessage(false)}
                disabled={sending || !body.trim()}
              >
                <Send className="h-4 w-4" />
              </Button>
              {isOrganizer && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => sendMessage(true)}
                  disabled={sending || !body.trim()}
                  title="Send as announcement to all channels"
                >
                  <Megaphone className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!deleteConfirmId}
        onOpenChange={(open) => !open && setDeleteConfirmId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unsend Message?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This message will be removed for everyone in this channel.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && deleteMessage(deleteConfirmId)}
            >
              Unsend
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Report message dialog */}
      <Dialog
        open={!!reportingMessageId}
        onOpenChange={(open) => {
          if (!open) {
            setReportingMessageId(null);
            setReportReason("spam");
            setReportDetails("");
            setReportStatus(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report Message</DialogTitle>
          </DialogHeader>
          {reportStatus ? (
            <p className="text-sm text-center py-4">{reportStatus}</p>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Reason</Label>
                <div className="space-y-2">
                  {(
                    [
                      { value: "spam", label: "Spam" },
                      { value: "harassment", label: "Harassment" },
                      { value: "inappropriate", label: "Inappropriate Content" },
                      { value: "other", label: "Other" },
                    ] as const
                  ).map((option) => (
                    <label key={option.value} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="report-reason"
                        value={option.value}
                        checked={reportReason === option.value}
                        onChange={() => setReportReason(option.value)}
                        className="accent-primary"
                      />
                      <span className="text-sm">{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Details (optional)</Label>
                <Textarea
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  placeholder="Provide additional context..."
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setReportingMessageId(null)}>
                  Cancel
                </Button>
                <Button onClick={submitReport}>Submit Report</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Moderation queue dialog */}
      <Dialog open={modQueueOpen} onOpenChange={setModQueueOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Moderation Queue</DialogTitle>
          </DialogHeader>
          {pendingReports.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No pending reports.
            </p>
          ) : (
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {pendingReports.map((report) => (
                <div key={report.id} className="border rounded-lg p-3 space-y-2">
                  <p className="text-sm font-medium line-clamp-2">
                    &ldquo;{report.message_body?.slice(0, 120)}
                    {(report.message_body?.length || 0) > 120 ? "..." : ""}&rdquo;
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Reported by: {report.reporter_name}</span>
                    <span>&middot;</span>
                    <Badge variant="outline" className="text-[10px]">{report.reason}</Badge>
                    <span>&middot;</span>
                    <span>{format(new Date(report.created_at), "MMM d, h:mm a")}</span>
                  </div>
                  {report.details && (
                    <p className="text-xs text-muted-foreground italic">{report.details}</p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => dismissReport(report.id)}
                    >
                      Dismiss
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => actionReport(report.id, report.message_id)}
                    >
                      Delete Message
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
