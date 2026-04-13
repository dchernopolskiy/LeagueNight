https://leaguenight.vercel.app/

An open source (at least for now) scheduler for Recreational Sports Leagues.

# LeagueNight — Feature Roadmap

## What's Built (v1)

- Multi-sport league management (Volleyball, Basketball, Pickleball)
- Divisions, teams, players, captains
- Standings with auto-recalculation + per-set scoring (volleyball)
- Round-robin schedule generation for all teams
- Calendar view with clickable day cells, league/division/sport labels, Open Gym tags
- Single & double elimination playoff brackets + PDF export
- Locations management with conflict detection
- Chat system: league/team/division/direct channels, realtime via Supabase
- Chat moderation: message reporting, moderation queue, content filter
- Announcements broadcast to all channels
- Unread badges (sidebar, league nav, per-channel)
- Role-based permissions: organizer/staff/player with scoped access per league
- Co-organizer RBAC (admin/manager roles, ownership transfer)
- Player role: read-only teams/schedule/standings, own-team chat only, live score → staff review
- Admin panel: global staff management, bulk actions
- Data exports: PDF & Excel for leagues, teams, schedules, standings, rosters
- Profile page: edit info, view permissions, change password
- Public league pages (`/league/{slug}`)
- Player portal with unique token links (`/p/{token}`)
- RSVP system (In/Out/Maybe per game)
- Sub request system
- Email auth with confirmation flow

---

## Phase 2 — Mobile & PWA

- **Progressive Web App** — installable, offline schedule viewing
- **Push notifications** — schedule update, announcements
- **Location services** - TBD

## Phase 3 — Notifications & Communication

### SMS Notifications
- Game reminders (configurable hours before)
- RSVP prompts
- Sub request alerts to available subs
- Schedule change / cancellation notices
- Announcement delivery via SMS for players who opt in

### Email Notifications
- Same triggers as SMS (game reminders, RSVP, sub requests, cancellations)
- Weekly schedule digest
- Payment reminders
- Welcome email on signup
- Co-organizer invitation email

### Push Notifications
- Real-time chat message notifications
- Game day reminders
- Score updates

## Phase 4 — Payments

### Stripe Integration

## Phase 5 — Enhanced Chat & Social

- **@mentions** — tag players/teams in chat, trigger notification
- **Message reactions** — emoji reactions on messages
- **File/image sharing** in chat
- **Sport-wide chat channels** — cross-league channels for all volleyball players, etc.
- **Organizer-wide chat** — channel for all organizers to coordinate
- **Message search** — full-text search across chat history
- **Pin messages** — organizers can pin important messages

---

## Phase 6 — Public Site & Player Experience

- **Public standings widget** — embeddable iframe for league websites
- **Public schedule view** — shareable schedule page per league
- **Player profiles** — stats, game history, teams played for
  - Profiles not visible by default — players opt in to share info
- **Team pages** — roster, record, upcoming games
- **Season archives** — historical standings and brackets
- **Custom league branding** — logo, colors on public page
- **QR code generation** — for player portal links, printed on schedules

---

## Phase 7 — Advanced Scheduling

TBD

---

## Phase 8 — Analytics & Reporting

TBD

---
