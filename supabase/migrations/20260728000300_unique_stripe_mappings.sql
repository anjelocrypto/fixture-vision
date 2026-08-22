-- Each Stripe object must belong to at most one application user. These
-- constraints intentionally fail if source data is ambiguous so it can be
-- reconciled before the billing hardening is deployed.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.user_entitlements
    WHERE stripe_customer_id IS NOT NULL
    GROUP BY stripe_customer_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate stripe_customer_id mappings must be reconciled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_entitlements
    WHERE stripe_subscription_id IS NOT NULL
    GROUP BY stripe_subscription_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate stripe_subscription_id mappings must be reconciled';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS user_entitlements_stripe_customer_unique
  ON public.user_entitlements (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_entitlements_stripe_subscription_unique
  ON public.user_entitlements (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

COMMIT;
