CREATE TABLE "admin_password_reset_requests" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"actor_admin_id" uuid NOT NULL,
	"actor_auth_session_id" uuid NOT NULL,
	"target_user_id" uuid NOT NULL,
	"expected_last_applied_request_id" uuid,
	"supersedes_request_id" uuid,
	"request_fingerprint" text NOT NULL,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_password_reset_requests_outcome_check" CHECK ("admin_password_reset_requests"."outcome" = ANY (ARRAY['pending'::text, 'applied'::text, 'rejected_state_changed'::text])),
	CONSTRAINT "admin_password_reset_requests_completion_check" CHECK (("admin_password_reset_requests"."outcome" = 'pending' AND "admin_password_reset_requests"."completed_at" IS NULL) OR ("admin_password_reset_requests"."outcome" <> 'pending' AND "admin_password_reset_requests"."completed_at" IS NOT NULL)),
	CONSTRAINT "admin_password_reset_requests_not_self_superseding_check" CHECK ("admin_password_reset_requests"."request_id" <> "admin_password_reset_requests"."supersedes_request_id" OR "admin_password_reset_requests"."supersedes_request_id" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_admin_password_reset_request_id" uuid;--> statement-breakpoint
ALTER TABLE "admin_password_reset_requests" ADD CONSTRAINT "admin_password_reset_requests_actor_admin_id_fkey" FOREIGN KEY ("actor_admin_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_password_reset_requests" ADD CONSTRAINT "admin_password_reset_requests_actor_auth_session_id_fkey" FOREIGN KEY ("actor_auth_session_id") REFERENCES "public"."auth_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_password_reset_requests" ADD CONSTRAINT "admin_password_reset_requests_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_password_reset_requests_target_idx" ON "admin_password_reset_requests" USING btree ("target_user_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_last_admin_password_reset_request_id_fkey" FOREIGN KEY ("last_admin_password_reset_request_id") REFERENCES "public"."admin_password_reset_requests"("request_id") ON DELETE restrict ON UPDATE no action;
