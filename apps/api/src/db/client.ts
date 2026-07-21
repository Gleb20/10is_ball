import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof drizzlePglite<typeof schema>>;

export async function createPgliteDb(opts?: {
  dataDir?: string;
}): Promise<{
  db: Db;
  client: PGlite;
  close: () => Promise<void>;
}> {
  const dataDir =
    opts?.dataDir ??
    (process.env.PGLITE_DATA_DIR?.trim()
      ? process.env.PGLITE_DATA_DIR.trim()
      : undefined);
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzlePglite(client, { schema });
  await applySchemaSql(client);
  return {
    db: db as unknown as Db,
    client,
    close: async () => {
      await client.close();
    },
  };
}

export async function createPostgresDb(url: string): Promise<{
  db: Db;
  close: () => Promise<void>;
}> {
  const client = postgres(url, { max: 10 });
  const db = drizzlePg(client, { schema });
  return {
    db: db as unknown as Db,
    close: async () => {
      await client.end();
    },
  };
}

/** Baseline DDL for PGlite / fresh installs (mirrors drizzle schema). */
export async function applySchemaSql(
  client: { exec: (sql: string) => Promise<unknown> },
  opts: { withPgcrypto?: boolean } = {},
): Promise<void> {
  const pgcrypto = opts.withPgcrypto
    ? `CREATE EXTENSION IF NOT EXISTS pgcrypto;`
    : `-- pgcrypto skipped (PGlite / tests)`;
  const uuidDefault = opts.withPgcrypto ? "DEFAULT gen_random_uuid()" : "";

  await client.exec(`
    ${pgcrypto}

    DO $$ BEGIN
      CREATE TYPE user_role AS ENUM ('admin', 'user');
    EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN
      CREATE TYPE user_status AS ENUM ('active', 'blocked');
    EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN
      CREATE TYPE avatar_source AS ENUM ('generated', 'uploaded');
    EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN
      CREATE TYPE match_format AS ENUM ('1v1', '2v2');
    EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN
      CREATE TYPE match_status AS ENUM ('waiting', 'in_progress', 'pending_confirmation', 'finished', 'stopped', 'cancelled');
    EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN
      CREATE TYPE match_kind AS ENUM ('standalone', 'tournament', 'tutorial');
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY ${uuidDefault},
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
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email);

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id uuid PRIMARY KEY ${uuidDefault},
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

    CREATE TABLE IF NOT EXISTS temporary_password_issues (
      id uuid PRIMARY KEY ${uuidDefault},
      user_id uuid NOT NULL REFERENCES users(id),
      issued_by_admin_id uuid NOT NULL REFERENCES users(id),
      issued_at timestamptz NOT NULL DEFAULT now(),
      consumed_at timestamptz
    );

    CREATE TABLE IF NOT EXISTS matches (
      id uuid PRIMARY KEY ${uuidDefault},
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

    ALTER TABLE matches ADD COLUMN IF NOT EXISTS judge_display_flipped boolean NOT NULL DEFAULT false;

    CREATE TABLE IF NOT EXISTS match_participants (
      id uuid PRIMARY KEY ${uuidDefault},
      match_id uuid NOT NULL REFERENCES matches(id),
      side text NOT NULL,
      user_id uuid REFERENCES users(id),
      guest_first_name text,
      guest_last_name text,
      guest_avatar_key text,
      is_tutorial_actor boolean NOT NULL DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS judge_sessions (
      id uuid PRIMARY KEY ${uuidDefault},
      match_id uuid NOT NULL REFERENCES matches(id),
      user_id uuid NOT NULL REFERENCES users(id),
      auth_session_id uuid NOT NULL REFERENCES auth_sessions(id),
      acquired_at timestamptz NOT NULL DEFAULT now(),
      last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      released_at timestamptz
    );
    CREATE UNIQUE INDEX IF NOT EXISTS judge_sessions_active_match
      ON judge_sessions (match_id) WHERE released_at IS NULL;

    CREATE TABLE IF NOT EXISTS tournaments (
      id uuid PRIMARY KEY ${uuidDefault},
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

    CREATE TABLE IF NOT EXISTS tournament_participants (
      id uuid PRIMARY KEY ${uuidDefault},
      tournament_id uuid NOT NULL REFERENCES tournaments(id),
      user_id uuid REFERENCES users(id),
      guest_first_name text,
      guest_last_name text,
      guest_avatar_key text,
      seed integer,
      wins_snapshot integer NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS tournament_invitations (
      id uuid PRIMARY KEY ${uuidDefault},
      tournament_id uuid NOT NULL REFERENCES tournaments(id),
      invited_user_id uuid NOT NULL REFERENCES users(id),
      invited_by_user_id uuid NOT NULL REFERENCES users(id),
      status text NOT NULL DEFAULT 'pending',
      expires_at timestamptz NOT NULL,
      responded_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS teams (
      id uuid PRIMARY KEY ${uuidDefault},
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

    CREATE TABLE IF NOT EXISTS team_memberships (
      id uuid PRIMARY KEY ${uuidDefault},
      team_id uuid NOT NULL REFERENCES teams(id),
      user_id uuid NOT NULL REFERENCES users(id),
      joined_at timestamptz NOT NULL DEFAULT now(),
      left_at timestamptz,
      leave_reason text
    );

    CREATE TABLE IF NOT EXISTS team_invitations (
      id uuid PRIMARY KEY ${uuidDefault},
      team_id uuid NOT NULL REFERENCES teams(id),
      invited_user_id uuid NOT NULL REFERENCES users(id),
      invited_by_user_id uuid NOT NULL REFERENCES users(id),
      status text NOT NULL DEFAULT 'pending',
      expires_at timestamptz NOT NULL,
      responded_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id uuid PRIMARY KEY ${uuidDefault},
      user_id uuid NOT NULL REFERENCES users(id),
      type text NOT NULL,
      title text NOT NULL,
      body text NOT NULL,
      payload jsonb,
      read_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id uuid PRIMARY KEY ${uuidDefault},
      actor_user_id uuid REFERENCES users(id),
      action text NOT NULL,
      entity_type text NOT NULL,
      entity_id text,
      meta jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS faq_articles (
      id uuid PRIMARY KEY ${uuidDefault},
      category text NOT NULL,
      title text NOT NULL,
      body text NOT NULL,
      sort_order integer NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS feedback_messages (
      id uuid PRIMARY KEY ${uuidDefault},
      user_id uuid NOT NULL REFERENCES users(id),
      kind text NOT NULL,
      message text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS user_stats (
      user_id uuid PRIMARY KEY REFERENCES users(id),
      wins_all_time integer NOT NULL DEFAULT 0,
      losses_all_time integer NOT NULL DEFAULT 0,
      wins_week integer NOT NULL DEFAULT 0,
      wins_month integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS guest_avatar_key text;
    ALTER TABLE tournament_participants ADD COLUMN IF NOT EXISTS guest_avatar_key text;
    ALTER TABLE matches ADD COLUMN IF NOT EXISTS tournament_bracket_match_id text;
    ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS bracket_state_version integer NOT NULL DEFAULT 0;
    ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS third_place_enabled boolean;
    ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS bracket_construction_algorithm text;
    -- Safe backfill (does not rewrite bracket_json)
    UPDATE tournaments
    SET bracket_construction_algorithm = 'power_of_two'
    WHERE bracket_construction_algorithm IS NULL
      AND bracket_json IS NOT NULL
      AND (bracket_json->>'schemaVersion') = '2'
      AND (
        bracket_json->>'constructionAlgorithm' IS NULL
        OR bracket_json->>'constructionAlgorithm' = 'power_of_two'
      );
    UPDATE tournaments
    SET bracket_construction_algorithm = 'compact'
    WHERE bracket_construction_algorithm IS NULL
      AND bracket_json IS NOT NULL
      AND (bracket_json->>'schemaVersion') = '2'
      AND bracket_json->>'constructionAlgorithm' = 'compact';
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
    -- New rows default to compact (column stays nullable for legacy DE)
    ALTER TABLE tournaments ALTER COLUMN bracket_construction_algorithm SET DEFAULT 'compact';
    CREATE UNIQUE INDEX IF NOT EXISTS matches_tournament_bracket_match_uid
      ON matches (tournament_id, tournament_bracket_match_id)
      WHERE tournament_bracket_match_id IS NOT NULL AND tournament_id IS NOT NULL;
  `);
}
