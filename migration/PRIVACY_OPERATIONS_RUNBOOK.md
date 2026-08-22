# TICKET AI privacy request operations

This runbook is for an authorized production operator. A user request is not
permission to skip billing, identity, backup, or legal-retention checks.

## Daily queue review

1. Review pending requests with a service-role/admin-only query. Never expose
   `handled_by` or `resolution_notes` through a user endpoint.
2. Verify the requester owns the Auth identity. Record the request ID and UTC
   timestamps in the restricted operations log.
3. Offer or verify the personal-data export before destructive work.
4. Apply the approved response deadline and retention policy. Legal counsel must
   define which Stripe/tax/audit records must be retained.

## Deletion sequence

1. Confirm a current recoverable backup exists.
2. If `user_entitlements.stripe_subscription_id` is present, cancel the recurring
   Stripe subscription first and wait until the database entitlement status is
   `canceled`. A scheduled end-of-period cancellation is not enough for an
   immediate deletion.
3. Disable new sign-ins and revoke the user's active sessions through the
   supported Supabase Auth Admin controls. Keep the purge and Auth deletion in
   one controlled maintenance window so the user cannot recreate rows between
   them.
4. Using a trusted server-side service-role client, call
   `purge_user_application_data_for_deletion(user_id,
   'PURGE USER APPLICATION DATA')`. Record and review every returned row count.
   This call refuses to run without an open request or while recurring billing
   is not canceled.
5. Delete the identity through the supported Supabase Auth Admin API. Do not
   delete rows directly from `auth.users` in production.
6. Confirm the Auth user is absent and the privacy request's `user_id` became
   `NULL`. Shared market/audit rows retain their business record but their Auth
   references are anonymized by `ON DELETE SET NULL`.
7. Call `complete_account_deletion_request(request_id, resolution_notes)` with a
   non-sensitive completion reference. It refuses completion until Auth deletion
   has cleared the request's user reference.
8. Verify no user-owned rows remain in the tables listed by the purge result,
   the Stripe subscription is canceled, and the request status is `completed`.

## Failure and recovery

- Stop immediately on a Stripe, purge, Auth, or verification error.
- Do not mark the request completed while `user_id` is still present.
- If application rows were purged but Auth deletion failed, keep the request
  `in_progress`, repair the Auth blocker, and resume at step 5. The purge RPC is
  safe to rerun and reports zero for already-removed rows.
- Never restore one deleted user into live production from a general backup
  without a separately approved legal and incident-recovery decision.
