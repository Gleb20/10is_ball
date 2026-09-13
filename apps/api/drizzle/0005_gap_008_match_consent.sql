CREATE TABLE "match_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"match_participant_id" uuid,
	"participant_side" text,
	"invited_user_id" uuid NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"expiry_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_invitations_kind_check" CHECK ("match_invitations"."kind" = ANY (ARRAY['player'::text, 'judge'::text])),
	CONSTRAINT "match_invitations_status_check" CHECK ("match_invitations"."status" = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'expired'::text, 'cancelled'::text])),
	CONSTRAINT "match_invitations_side_check" CHECK (("match_invitations"."match_participant_id" IS NOT NULL AND "match_invitations"."participant_side" = ANY (ARRAY['A'::text, 'B'::text]) AND "match_invitations"."kind" = 'player') OR ("match_invitations"."match_participant_id" IS NULL AND "match_invitations"."participant_side" IS NULL AND "match_invitations"."kind" = 'judge'))
);
--> statement-breakpoint
ALTER TABLE "match_invitations" ADD CONSTRAINT "match_invitations_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_invitations" ADD CONSTRAINT "match_invitations_invited_user_id_fkey" FOREIGN KEY ("invited_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_invitations" ADD CONSTRAINT "match_invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "match_invitations_pending_user_kind_uid" ON "match_invitations" USING btree ("match_id","invited_user_id","kind") WHERE "match_invitations"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "match_invitations_pending_participant_uid" ON "match_invitations" USING btree ("match_participant_id") WHERE "match_invitations"."kind" = 'player' AND "match_invitations"."status" = 'pending' AND "match_invitations"."match_participant_id" IS NOT NULL;