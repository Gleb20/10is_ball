-- DATA-003 adoption baseline.
--
-- This migration is intentionally additive and idempotent so an unversioned
-- database created by the historical boot-time DDL can adopt the Drizzle
-- migration ledger without dropping or rewriting sporting records.

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('active', 'blocked');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE avatar_source AS ENUM ('generated', 'uploaded');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE match_format AS ENUM ('1v1', '2v2');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE match_status AS ENUM ('waiting', 'in_progress', 'pending_confirmation', 'finished', 'stopped', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE match_kind AS ENUM ('standalone', 'tournament', 'tutorial');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS users (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL,
  password_hash text NOT NULL,
  role user_role NOT NULL DEFAULT 'user',
  status user_status NOT NULL DEFAULT 'active',
  first_name text NOT NULL,
  last_name text NOT NULL,
  birth_date text,
  organization_text text DEFAULT 'Moscow transport',
  position_text text,
  avatar_source avatar_source NOT NULL DEFAULT 'generated',
  generated_avatar_key text,
  uploaded_avatar_path text,
  must_change_password boolean NOT NULL DEFAULT true,
  onboarding_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  blocked_at timestamptz,
  last_login_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL,
  user_agent text,
  ip_fingerprint text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS temporary_password_issues (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  issued_by_admin_id uuid NOT NULL REFERENCES users(id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS matches (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  kind match_kind NOT NULL DEFAULT 'standalone',
  status match_status NOT NULL DEFAULT 'waiting',
  format match_format NOT NULL DEFAULT '1v1',
  points_to_win integer NOT NULL DEFAULT 11,
  mercy_enabled boolean NOT NULL DEFAULT false,
  mercy_points integer,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  tournament_id uuid,
  tournament_slot_id text,
  tournament_bracket_match_id text,
  score_a integer NOT NULL DEFAULT 0,
  score_b integer NOT NULL DEFAULT 0,
  current_server_participant_id text,
  serve_sequence_index integer NOT NULL DEFAULT 0,
  deuce_mode boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  finished_at timestamptz,
  winner_side text,
  finish_reason text,
  stop_reason_code text,
  stop_reason_text text,
  event_log jsonb NOT NULL DEFAULT '[]',
  idempotency_keys jsonb NOT NULL DEFAULT '[]',
  judge_display_flipped boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS match_participants (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES matches(id),
  side text NOT NULL,
  user_id uuid REFERENCES users(id),
  guest_first_name text,
  guest_last_name text,
  guest_avatar_key text,
  is_tutorial_actor boolean NOT NULL DEFAULT false
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS judge_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES matches(id),
  user_id uuid NOT NULL REFERENCES users(id),
  auth_session_id uuid NOT NULL REFERENCES auth_sessions(id),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  released_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS judge_sessions_active_match
  ON judge_sessions (match_id) WHERE released_at IS NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS tournaments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'collecting',
  format text NOT NULL DEFAULT 'single_elimination',
  organizer_participates boolean NOT NULL DEFAULT true,
  points_to_win integer NOT NULL DEFAULT 11,
  mercy_enabled boolean NOT NULL DEFAULT true,
  mercy_points integer DEFAULT 5,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  default_judge_user_id uuid REFERENCES users(id),
  bracket_json jsonb,
  bracket_state_version integer NOT NULL DEFAULT 0,
  third_place_enabled boolean,
  bracket_construction_algorithm text,
  stop_reason_code text,
  stop_reason_text text,
  started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS tournament_participants (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id uuid NOT NULL REFERENCES tournaments(id),
  user_id uuid REFERENCES users(id),
  guest_first_name text,
  guest_last_name text,
  guest_avatar_key text,
  seed integer,
  wins_snapshot integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active'
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS tournament_invitations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id uuid NOT NULL REFERENCES tournaments(id),
  invited_user_id uuid NOT NULL REFERENCES users(id),
  invited_by_user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS teams (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  slogan text,
  welcome_text text,
  captain_user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS team_memberships (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES teams(id),
  user_id uuid NOT NULL REFERENCES users(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  leave_reason text
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS team_invitations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES teams(id),
  invited_user_id uuid NOT NULL REFERENCES users(id),
  invited_by_user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  payload jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS faq_articles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  category text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS feedback_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS user_stats (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  wins_all_time integer NOT NULL DEFAULT 0,
  losses_all_time integer NOT NULL DEFAULT 0,
  wins_week integer NOT NULL DEFAULT 0,
  wins_month integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Adoption repairs for every column added after the original v1.0 boot schema.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS judge_display_flipped boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE matches ADD COLUMN IF NOT EXISTS tournament_slot_id text;
--> statement-breakpoint
ALTER TABLE matches ADD COLUMN IF NOT EXISTS tournament_bracket_match_id text;
--> statement-breakpoint
ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS guest_avatar_key text;
--> statement-breakpoint
ALTER TABLE tournament_participants ADD COLUMN IF NOT EXISTS guest_avatar_key text;
--> statement-breakpoint
ALTER TABLE tournament_participants ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS organizer_participates boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS points_to_win integer NOT NULL DEFAULT 11;
--> statement-breakpoint
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS mercy_enabled boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS mercy_points integer DEFAULT 5;
--> statement-breakpoint
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS stop_reason_code text;
--> statement-breakpoint
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS stop_reason_text text;
--> statement-breakpoint
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS started_at timestamptz;
--> statement-breakpoint
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS finished_at timestamptz;
--> statement-breakpoint
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS bracket_state_version integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS third_place_enabled boolean;
--> statement-breakpoint
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS bracket_construction_algorithm text;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS generated_avatar_key text;
--> statement-breakpoint

-- Safe classification backfill. It does not rewrite bracket_json and leaves
-- unclassified legacy DE rows nullable per ADR D25.
UPDATE tournaments
SET bracket_construction_algorithm = 'power_of_two'
WHERE bracket_construction_algorithm IS NULL
  AND bracket_json IS NOT NULL
  AND (bracket_json->>'schemaVersion') = '2'
  AND (
    bracket_json->>'constructionAlgorithm' IS NULL
    OR bracket_json->>'constructionAlgorithm' = 'power_of_two'
  );
--> statement-breakpoint
UPDATE tournaments
SET bracket_construction_algorithm = 'compact'
WHERE bracket_construction_algorithm IS NULL
  AND bracket_json IS NOT NULL
  AND (bracket_json->>'schemaVersion') = '2'
  AND bracket_json->>'constructionAlgorithm' = 'compact';
--> statement-breakpoint
UPDATE tournaments
SET bracket_construction_algorithm = 'compact'
WHERE bracket_construction_algorithm IS NULL
  AND bracket_json IS NOT NULL
  AND (
    bracket_json->>'schemaVersion' IS NULL
    OR bracket_json->>'schemaVersion' = '1'
  )
  AND bracket_json->>'format' = 'single_elimination'
  AND jsonb_typeof(bracket_json->'slots') = 'array';
--> statement-breakpoint
ALTER TABLE tournaments ALTER COLUMN bracket_construction_algorithm SET DEFAULT 'compact';
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS matches_tournament_bracket_match_uid
  ON matches (tournament_id, tournament_bracket_match_id)
  WHERE tournament_bracket_match_id IS NOT NULL AND tournament_id IS NOT NULL;
