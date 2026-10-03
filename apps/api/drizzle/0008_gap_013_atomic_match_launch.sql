CREATE TABLE "match_launch_requests" (
	"actor_user_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"originating_auth_session_id" uuid NOT NULL,
	"request_fingerprint" text NOT NULL,
	"match_id" uuid NOT NULL,
	"initial_server_participant_id" uuid NOT NULL,
	"slot_map" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "match_launch_requests_actor_request_uid" ON "match_launch_requests" USING btree ("actor_user_id","request_id");
