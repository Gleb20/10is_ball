ALTER TABLE "users" ADD COLUMN "onboarding_step" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Existing active accounts predate reliable onboarding state. Do not force the
-- guide on every legacy session after deploy; only accounts still waiting for
-- their first password change remain incomplete.
UPDATE "users"
SET "onboarding_completed_at" = COALESCE("onboarding_completed_at", "updated_at")
WHERE "must_change_password" = false
  AND "onboarding_completed_at" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_onboarding_step_range" CHECK ("users"."onboarding_step" BETWEEN 0 AND 6);
