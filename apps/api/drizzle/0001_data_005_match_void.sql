ALTER TYPE "public"."match_status" ADD VALUE 'voided';--> statement-breakpoint
CREATE TABLE "match_void_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"prior_status" text NOT NULL,
	"prior_version" integer NOT NULL,
	"prior_result" jsonb NOT NULL,
	"prior_event_log" jsonb NOT NULL,
	"reason_text" text,
	"compensation" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_void_audits" ADD CONSTRAINT "match_void_audits_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_void_audits" ADD CONSTRAINT "match_void_audits_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "match_void_audits_match_uid" ON "match_void_audits" USING btree ("match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_void_audits_idempotency_uid" ON "match_void_audits" USING btree ("match_id","actor_user_id","idempotency_key");--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_match_void_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'match_void_audits is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER match_void_audits_immutable
BEFORE UPDATE OR DELETE ON match_void_audits
FOR EACH ROW
EXECUTE FUNCTION reject_match_void_audit_mutation();
