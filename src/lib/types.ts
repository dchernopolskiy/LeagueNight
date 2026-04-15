export interface Profile {
  id: string;
  auth_id: string;
  email: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface League {
  id: string;
  organizer_id: string;
  name: string;
  slug: string;
  sport: string | null;
  description: string | null;
  season_name: string | null;
  timezone: string;
  is_public: boolean;
  settings: LeagueSettings;
  created_at: string;
  season_start: string | null;
  season_end: string | null;
  archived_at: string | null;
}

export interface LeagueSettings {
  tiebreakers?: ("h2h" | "point_diff" | "points_for")[];
  max_subs_per_game?: number;
  subs_in_playoffs?: boolean;
  availability_check_day_offset?: number;
  availability_check_time?: string;
  reminder_hours_before?: number;
  scoring_mode?: "game" | "sets"; // "game" = simple W/L, "sets" = volleyball-style set scoring
  sets_to_win?: number; // e.g. 2 for best-of-3
}

export type ScoringMode = "game" | "sets";

export interface Division {
  id: string;
  league_id: string;
  name: string;
  level: number;
  color: string | null;
  created_at: string;
}

export interface DivisionCrossPlay {
  id: string;
  league_id: string;
  division_a_id: string;
  division_b_id: string;
  created_at: string;
}

export interface Person {
  id: string;
  email: string | null;
  phone: string | null;
  full_name: string;
  profile_id: string | null;
  created_at: string;
}

export interface Bracket {
  id: string;
  league_id: string;
  division_id: string | null;
  name: string;
  format: "single_elimination" | "double_elimination";
  num_teams: number;
  seed_by: "record" | "points";
  default_location_id: string | null;
  default_start_time: string | null;
  default_duration_minutes: number | null;
  start_date: string | null;
  days_of_week: number[] | null;
  created_at: string;
}

export interface BracketSlot {
  id: string;
  bracket_id: string;
  round: number;
  position: number;
  team_id: string | null;
  seed: number | null;
  game_id: string | null;
  winner_to: string | null;
  loser_to: string | null;
  created_at: string;
}

export interface TeamPreferences {
  preferred_time?: "early" | "late" | null;
  preferred_days?: string[];
  bye_dates?: string[];
  week_preferences?: Record<string, "early" | "late">;
  notes?: string;
}

export interface Team {
  id: string;
  league_id: string;
  name: string;
  color: string | null;
  captain_player_id: string | null;
  division_id: string | null;
  preferences?: TeamPreferences;
  created_at: string;
}

export interface Player {
  id: string;
  token: string;
  league_id: string;
  team_id: string | null;
  profile_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  is_sub: boolean;
  notification_pref: "sms" | "email" | "push" | "none";
  person_id: string | null;
  sub_availability: { days?: number[]; notes?: string } | null;
  created_at: string;
}

export interface GameDayPattern {
  id: string;
  league_id: string;
  day_of_week: number;          // single day (legacy + used by scheduler)
  days_of_week: number[] | null; // all days in this group (display grouping)
  group_id: string | null;       // patterns created together share a group_id
  start_time: string;
  end_time: string | null;
  venue: string | null;
  court_count: number;
  duration_minutes: number;
  starts_on: string;
  ends_on: string | null;
  location_ids: string[];
  // Scheduling settings stored so regeneration is self-contained
  games_per_team: number;
  games_per_session: number;
  matchup_frequency: number;
  mix_divisions: boolean;
  skip_dates: string[];
}

export interface PreferenceApplied {
  home_team?: string[]; // Which preferences were applied for home team
  away_team?: string[]; // Which preferences were applied for away team
}

export interface Game {
  id: string;
  league_id: string;
  home_team_id: string;
  away_team_id: string;
  scheduled_at: string;
  venue: string | null;
  court: string | null;
  status: "scheduled" | "cancelled" | "completed" | "rescheduled";
  cancel_reason: string | null;
  home_score: number | null;
  away_score: number | null;
  is_playoff: boolean;
  week_number: number | null;
  location_id: string | null;
  preference_applied?: PreferenceApplied | null;
  scheduling_notes?: string | null;
  created_at: string;
}

export interface Rsvp {
  id: string;
  game_id: string;
  player_id: string;
  response: "yes" | "no" | "maybe";
  responded_at: string;
}

export interface SubRequest {
  id: string;
  game_id: string;
  team_id: string;
  requested_by: string;
  claimed_by: string | null;
  status: "open" | "claimed" | "cancelled";
  notes: string | null;
  created_at: string;
  claimed_at: string | null;
}

export interface LeagueFee {
  id: string;
  league_id: string;
  amount_cents: number;
  currency: string;
  per: "player" | "team";
  description: string | null;
  due_date: string | null;
}

export interface Payment {
  id: string;
  league_fee_id: string;
  player_id: string;
  amount_cents: number;
  status: "pending" | "paid" | "failed" | "refunded";
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  league_id: string;
  team_id: string | null;
  division_id: string | null;
  player_id: string | null;
  profile_id: string | null;
  recipient_profile_id: string | null;
  body: string;
  is_announcement: boolean;
  channel_type: "league" | "team" | "organizer" | "division" | "direct";
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface Location {
  id: string;
  organizer_id: string;
  name: string;
  address: string | null;
  court_count: number;
  notes: string | null;
  tags: string[];
  created_at: string;
}

export interface LocationUnavailability {
  id: string;
  location_id: string;
  unavailable_date: string;
  reason: string | null;
  created_at: string;
}

export interface OpenGymSession {
  id: string;
  organizer_id: string;
  location_id: string | null;
  title: string;
  sport: string | null;
  description: string | null;
  day_of_week: number | null;
  start_time: string;
  end_time: string;
  specific_date: string | null;
  recurring_start: string | null;
  recurring_end: string | null;
  capacity: number | null;
  fee_amount_cents: number;
  fee_description: string | null;
  court_numbers: string[];
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

export interface OpenGymRsvp {
  id: string;
  session_id: string;
  player_name: string;
  player_email: string | null;
  player_phone: string | null;
  session_date: string;
  status: "confirmed" | "waitlist" | "cancelled";
  created_at: string;
}

export interface MessageReport {
  id: string;
  message_id: string;
  reporter_profile_id: string;
  reason: 'spam' | 'harassment' | 'inappropriate' | 'other';
  details: string | null;
  status: 'pending' | 'reviewed' | 'dismissed' | 'actioned';
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface ChatReadCursor {
  id: string;
  profile_id: string;
  league_id: string;
  channel_key: string;
  last_read_at: string;
}

export interface LeagueStaff {
  id: string;
  league_id: string;
  profile_id: string;
  role: "admin" | "manager";
  invited_by: string | null;
  created_at: string;
}

export interface Standing {
  id: string;
  league_id: string;
  team_id: string;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  h2h_record: Record<string, { w: number; l: number }>;
  rank: number | null;
  updated_at: string;
}
