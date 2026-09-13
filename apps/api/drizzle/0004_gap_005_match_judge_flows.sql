ALTER TABLE "judge_sessions" ADD COLUMN "reserved_for_user_id" uuid;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "first_server_method" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "judge_sessions" ADD CONSTRAINT "judge_sessions_reserved_for_user_id_fkey" FOREIGN KEY ("reserved_for_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "judge_sessions_active_user" ON "judge_sessions" USING btree ("user_id") WHERE "judge_sessions"."released_at" IS NULL AND "judge_sessions"."reserved_for_user_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "judge_sessions_reserved_user" ON "judge_sessions" USING btree ("reserved_for_user_id") WHERE "judge_sessions"."released_at" IS NULL AND "judge_sessions"."reserved_for_user_id" IS NOT NULL;