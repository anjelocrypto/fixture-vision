// Stripe price IDs for all plans
// IMPORTANT: Keys must match what's stored in user_entitlements.plan
// See memory: payments/plan-key-naming-convention
export const STRIPE_PLANS = {
  monthly: {
    priceId: "price_1SRlmOKAifASkGDzgavNBNlQ",
    name: "Premium Monthly",
    amount: 14_99,
    currency: "usd",
    interval: "month",
    type: "subscription" as const,
  },
  day_pass: {
    priceId: "price_1SS7L9KAifASkGDzgZL5PPOj",
    name: "Day Pass",
    amount: 4_99,
    currency: "usd",
    interval: "day",
    type: "subscription" as const,
  },
  test_pass: {
    priceId: "price_1SS8ONKAifASkGDzSwzZLLW2",
    name: "Test Pass (24h)",
    amount: 51,
    currency: "usd",
    interval: "day",
    type: "subscription" as const,
  },
  three_month: {
    priceId: "price_1SSIuZKAifASkGDzWZxgNYZX",
    name: "3-Month Plan",
    amount: 34_99,
    currency: "usd",
    interval: "month",
    type: "subscription" as const,
  },
  annual: {
    priceId: "price_1SRlocKAifASkGDzemzpW2xL",
    name: "Annual Plan",
    amount: 79_99,
    currency: "usd",
    interval: "year",
    type: "subscription" as const,
  },
} as const;

export type PlanType = keyof typeof STRIPE_PLANS;

// Maps Stripe price IDs back to our plan keys (for webhook processing)
export const PRICE_ID_TO_PLAN: Record<string, PlanType> = {
  "price_1SRlmOKAifASkGDzgavNBNlQ": "monthly",
  "price_1SS7L9KAifASkGDzgZL5PPOj": "day_pass",
  "price_1SS8ONKAifASkGDzSwzZLLW2": "test_pass",
  "price_1SSIuZKAifASkGDzWZxgNYZX": "three_month",
  "price_1SRlocKAifASkGDzemzpW2xL": "annual",
};

export const getPlanConfig = (plan: string) => {
  if (!(plan in STRIPE_PLANS)) {
    throw new Error(`Invalid plan: ${plan}`);
  }
  return STRIPE_PLANS[plan as PlanType];
};
