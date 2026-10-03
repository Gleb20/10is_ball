CREATE TABLE "guest_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"avatar_key" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_identities_first_name_check" CHECK (length(btrim("guest_identities"."first_name")) BETWEEN 1 AND 100),
	CONSTRAINT "guest_identities_last_name_check" CHECK (length(btrim("guest_identities"."last_name")) BETWEEN 1 AND 100),
	CONSTRAINT "guest_identities_avatar_key_check" CHECK ("guest_identities"."avatar_key" ~ '^avatar_([1-9]|10)$'),
	CONSTRAINT "guest_identities_version_check" CHECK ("guest_identities"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "guest_identity_requests" (
	"actor_user_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"guest_identity_id" uuid NOT NULL,
	"request_fingerprint" text NOT NULL,
	"resulting_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_identity_requests_operation_check" CHECK ("guest_identity_requests"."operation" = ANY (ARRAY['create'::text, 'rename'::text])),
	CONSTRAINT "guest_identity_requests_resulting_version_check" CHECK ("guest_identity_requests"."resulting_version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "match_participants" ADD COLUMN "guest_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD COLUMN "guest_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "guest_identities" ADD CONSTRAINT "guest_identities_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_identity_requests" ADD CONSTRAINT "guest_identity_requests_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_identity_requests" ADD CONSTRAINT "guest_identity_requests_guest_identity_id_fkey" FOREIGN KEY ("guest_identity_id") REFERENCES "public"."guest_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_identities_catalog_idx" ON "guest_identities" USING btree ("last_name","first_name","id");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_identity_requests_actor_request_uid" ON "guest_identity_requests" USING btree ("actor_user_id","request_id");--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_guest_identity_id_fkey" FOREIGN KEY ("guest_identity_id") REFERENCES "public"."guest_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_guest_identity_id_fkey" FOREIGN KEY ("guest_identity_id") REFERENCES "public"."guest_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "match_participants_guest_identity_uid" ON "match_participants" USING btree ("match_id","guest_identity_id") WHERE "match_participants"."guest_identity_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_participants_active_guest_identity_uid" ON "tournament_participants" USING btree ("tournament_id","guest_identity_id") WHERE "tournament_participants"."guest_identity_id" IS NOT NULL AND "tournament_participants"."status" = 'active';--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_guest_identity_snapshot_check" CHECK ("match_participants"."guest_identity_id" IS NULL OR ("match_participants"."user_id" IS NULL AND "match_participants"."guest_first_name" IS NOT NULL AND "match_participants"."guest_last_name" IS NOT NULL AND "match_participants"."guest_avatar_key" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_guest_identity_snapshot_check" CHECK ("tournament_participants"."guest_identity_id" IS NULL OR ("tournament_participants"."user_id" IS NULL AND "tournament_participants"."guest_first_name" IS NOT NULL AND "tournament_participants"."guest_last_name" IS NOT NULL AND "tournament_participants"."guest_avatar_key" IS NOT NULL));
