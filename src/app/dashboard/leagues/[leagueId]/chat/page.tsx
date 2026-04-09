"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
} from "lucide-react";
import { format } from "date-fns";
import type { Message, Player, Team, Division } from "@/lib/types";
import { useUnread } from "@/lib/hooks/use-unread";

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
  const { channels: channelUnread, markRead } = useUnread();

  // Build channel list
  const channels = useMemo<Channel[]>(() => {
    const list: Channel[] = [
      { key: "league", label: "League Chat", type: "league", teamId: null, divisionId: null, icon: Hash, section: "General" },
      { key: "organizer", label: "Organizer", type: "organizer", teamId: null, divisionId: null, icon: Shield, section: "General" },
    ];

    // Division channels
    for (const div of divisions) {
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
      // Show DM channels for each team captain
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
      // Check if current player is a captain
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
  }, [teams, divisions, players, currentPlayerId, isOrganizer]);

  const activeChannel = useMemo(() => {
    if (selectedChannelKey) {
      return channels.find((c) => c.key === selectedChannelKey) ?? channels[0] ?? null;
    }
    return channels[0] ?? null;
  }, [channels, selectedChannelKey]);

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
    setSending(true);
    const supabase = createClient();

    const payload: Record<string, unknown> = {
      league_id: leagueId,
      player_id: currentPlayerId || null,
      profile_id: currentProfileId,
      body: body.trim(),
      is_announcement: isAnnouncement,
      channel_type: activeChannel.type,
      team_id: activeChannel.teamId,
      division_id: activeChannel.divisionId,
    };

    if (activeChannel.type === "direct") {
      payload.recipient_profile_id = currentProfileId;
    }

    const { error } = await supabase.from("messages").insert(payload);
    if (error) console.error("Failed to send message:", error);
    setBody("");
    setSending(false);
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
              <div className="ml-auto">
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
                  {canEditDelete(msg) && (
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 ml-auto">
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
                    </div>
                  )}

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
              {(isOrganizer || activeChannel?.type === "league") && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => sendMessage(true)}
                  disabled={sending || !body.trim()}
                  title="Send as announcement"
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
    </div>
  );
}
