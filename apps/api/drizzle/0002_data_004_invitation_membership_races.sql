-- A bracket stores participant row IDs. Never silently withdraw a duplicate
-- from an already generated/started tournament: that requires an explicit repair.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM tournament_participants AS participant
    JOIN tournaments AS tournament ON tournament.id = participant.tournament_id
    WHERE participant.user_id IS NOT NULL AND participant.status = 'active'
      AND (tournament.bracket_json IS NOT NULL OR tournament.status <> 'collecting')
    GROUP BY participant.tournament_id, participant.user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'DATA_004_DUPLICATE_BRACKET_PARTICIPANTS';
  END IF;
END $$;--> statement-breakpoint

-- Preserve the earliest active membership/participant and close later duplicate
-- rows before adding the partial unique backstops. Historical rows remain in
-- place and are explicitly classified rather than deleted.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY team_id, user_id ORDER BY joined_at ASC, id ASC
  ) AS duplicate_rank
  FROM team_memberships
  WHERE left_at IS NULL
)
UPDATE team_memberships AS membership
SET left_at = membership.joined_at,
    leave_reason = COALESCE(membership.leave_reason, 'data_004_duplicate')
FROM ranked
WHERE membership.id = ranked.id AND ranked.duplicate_rank > 1;--> statement-breakpoint
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY tournament_id, user_id ORDER BY id ASC
  ) AS duplicate_rank
  FROM tournament_participants
  WHERE user_id IS NOT NULL AND status = 'active'
)
UPDATE tournament_participants AS participant
SET status = 'withdrawn'
FROM ranked
WHERE participant.id = ranked.id AND ranked.duplicate_rank > 1;--> statement-breakpoint

-- A current member is not also pending acceptance. Re-invites remain separate
-- historical rows after their prior invitation reaches a terminal state.
UPDATE team_invitations AS invitation
SET status = 'cancelled',
    responded_at = COALESCE(invitation.responded_at, invitation.created_at)
WHERE invitation.status = 'pending'
  AND EXISTS (
    SELECT 1 FROM team_memberships AS membership
    WHERE membership.team_id = invitation.team_id
      AND membership.user_id = invitation.invited_user_id
      AND membership.left_at IS NULL
  );--> statement-breakpoint
UPDATE tournament_invitations AS invitation
SET status = 'cancelled',
    responded_at = COALESCE(invitation.responded_at, invitation.created_at)
WHERE invitation.status = 'pending'
  AND EXISTS (
    SELECT 1 FROM tournament_participants AS participant
    WHERE participant.tournament_id = invitation.tournament_id
      AND participant.user_id = invitation.invited_user_id
      AND participant.status = 'active'
  );--> statement-breakpoint

-- Keep the newest pending invitation for each pair; older duplicate pending
-- rows become non-actionable history.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY team_id, invited_user_id ORDER BY created_at DESC, id DESC
  ) AS duplicate_rank
  FROM team_invitations
  WHERE status = 'pending'
)
UPDATE team_invitations AS invitation
SET status = 'cancelled',
    responded_at = COALESCE(invitation.responded_at, invitation.created_at)
FROM ranked
WHERE invitation.id = ranked.id AND ranked.duplicate_rank > 1;--> statement-breakpoint
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY tournament_id, invited_user_id ORDER BY created_at DESC, id DESC
  ) AS duplicate_rank
  FROM tournament_invitations
  WHERE status = 'pending'
)
UPDATE tournament_invitations AS invitation
SET status = 'cancelled',
    responded_at = COALESCE(invitation.responded_at, invitation.created_at)
FROM ranked
WHERE invitation.id = ranked.id AND ranked.duplicate_rank > 1;--> statement-breakpoint

CREATE UNIQUE INDEX "team_invitations_pending_user_uid" ON "team_invitations" USING btree ("team_id","invited_user_id") WHERE "team_invitations"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "team_memberships_active_user_uid" ON "team_memberships" USING btree ("team_id","user_id") WHERE "team_memberships"."left_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_invitations_pending_user_uid" ON "tournament_invitations" USING btree ("tournament_id","invited_user_id") WHERE "tournament_invitations"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_participants_active_user_uid" ON "tournament_participants" USING btree ("tournament_id","user_id") WHERE "tournament_participants"."user_id" IS NOT NULL AND "tournament_participants"."status" = 'active';
