ALTER TABLE "judge_sessions" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "initial_server_participant_id" uuid;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "playing_elapsed_ms" bigint;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "playing_segment_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "judge_history_complete" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "judge_sessions_match_activated_idx" ON "judge_sessions" USING btree ("match_id","activated_at");--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_playing_elapsed_nonnegative_check" CHECK ("matches"."playing_elapsed_ms" IS NULL OR "matches"."playing_elapsed_ms" >= 0);--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_playing_segment_requires_elapsed_check" CHECK ("matches"."playing_segment_started_at" IS NULL OR "matches"."playing_elapsed_ms" IS NOT NULL);--> statement-breakpoint
UPDATE "matches" AS "match"
SET "initial_server_participant_id" = "receipt"."initial_server_participant_id"
FROM "match_launch_requests" AS "receipt"
WHERE "receipt"."match_id" = "match"."id"
  AND "match"."initial_server_participant_id" IS NULL
  AND "match"."current_server_participant_id" = "receipt"."initial_server_participant_id"::text
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE("match"."event_log", '[]'::jsonb)) AS "event"
    WHERE "event"->>'type' IN ('point_awarded', 'point_undone', 'manual_correction')
  );
