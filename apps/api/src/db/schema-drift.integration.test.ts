import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { applySchemaSql } from "./client.js";

/**
 * Simulates Neon/prod: tournaments table created at v1.0.0 bootstrap
 * (no organizer_participates / participant status), then boot migrate.
 */
describe("schema drift migrate (Neon parity)", () => {
  it("ALTER adds tournament columns missing from old CREATE TABLE", async () => {
    const client = new PGlite();
    await client.exec(`
      CREATE TABLE tournaments (
        id text PRIMARY KEY,
        title text NOT NULL,
        status text NOT NULL DEFAULT 'collecting',
        format text NOT NULL DEFAULT 'single_elimination',
        created_by_user_id text NOT NULL,
        default_judge_user_id text,
        bracket_json jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE tournament_participants (
        id text PRIMARY KEY,
        tournament_id text NOT NULL,
        user_id text,
        guest_first_name text,
        guest_last_name text,
        seed integer,
        wins_snapshot integer NOT NULL DEFAULT 0
      );
      CREATE TABLE matches (
        id text PRIMARY KEY,
        title text NOT NULL,
        kind text NOT NULL DEFAULT 'standalone',
        status text NOT NULL DEFAULT 'waiting',
        format text NOT NULL DEFAULT '1v1',
        points_to_win integer NOT NULL DEFAULT 11,
        mercy_enabled boolean NOT NULL DEFAULT false,
        mercy_points integer,
        created_by_user_id text NOT NULL,
        tournament_id text,
        score_a integer NOT NULL DEFAULT 0,
        score_b integer NOT NULL DEFAULT 0,
        serve_sequence_index integer NOT NULL DEFAULT 0,
        deuce_mode boolean NOT NULL DEFAULT false,
        version integer NOT NULL DEFAULT 0,
        event_log jsonb NOT NULL DEFAULT '[]',
        idempotency_keys jsonb NOT NULL DEFAULT '[]',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE users (
        id text PRIMARY KEY,
        email text NOT NULL,
        password_hash text NOT NULL,
        role text NOT NULL DEFAULT 'user',
        status text NOT NULL DEFAULT 'active',
        first_name text NOT NULL,
        last_name text NOT NULL,
        avatar_source text NOT NULL DEFAULT 'generated',
        must_change_password boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE match_participants (
        id text PRIMARY KEY,
        match_id text NOT NULL,
        side text NOT NULL,
        user_id text,
        guest_first_name text,
        guest_last_name text,
        is_tutorial_actor boolean NOT NULL DEFAULT false
      );
    `);

    await applySchemaSql(client);

    const cols = await client.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'tournaments'
        AND column_name IN (
          'organizer_participates', 'points_to_win', 'mercy_enabled',
          'mercy_points', 'stop_reason_code', 'started_at', 'finished_at',
          'bracket_state_version', 'third_place_enabled',
          'bracket_construction_algorithm'
        )
      ORDER BY column_name
    `);
    expect(cols.rows.map((r) => r.column_name)).toEqual([
      "bracket_construction_algorithm",
      "bracket_state_version",
      "finished_at",
      "mercy_enabled",
      "mercy_points",
      "organizer_participates",
      "points_to_win",
      "started_at",
      "stop_reason_code",
      "third_place_enabled",
    ]);

    const partCols = await client.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'tournament_participants'
        AND column_name IN ('status', 'guest_avatar_key')
      ORDER BY column_name
    `);
    expect(partCols.rows.map((r) => r.column_name)).toEqual([
      "guest_avatar_key",
      "status",
    ]);

    const matchCols = await client.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'matches'
        AND column_name IN ('tournament_slot_id', 'tournament_bracket_match_id')
      ORDER BY column_name
    `);
    expect(matchCols.rows.map((r) => r.column_name)).toEqual([
      "tournament_bracket_match_id",
      "tournament_slot_id",
    ]);

    await client.close();
  });
});
