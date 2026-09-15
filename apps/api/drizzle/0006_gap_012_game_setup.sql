ALTER TABLE "tournament_invitations" ADD COLUMN "terminal_reason" text;--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD COLUMN "added_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD COLUMN "addition_source" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD COLUMN "addition_idempotency_key" uuid;--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD COLUMN "addition_request_fingerprint" text;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "require_participant_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_added_by_user_id_fkey" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_participants_add_idempotency_uid" ON "tournament_participants" USING btree ("tournament_id","addition_idempotency_key") WHERE "tournament_participants"."addition_idempotency_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_addition_source_check" CHECK ("tournament_participants"."addition_source" = ANY (ARRAY['legacy'::text, 'organizer_default'::text, 'manual_direct'::text, 'manual_override'::text, 'invitation_accept'::text, 'guest_manual'::text]));
