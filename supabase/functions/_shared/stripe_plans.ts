// Stripe price IDs for all plans
export const STRIPE_PLANS = {
  premium_monthly: {
    priceId: "price_1SNEq4KAifASkGDzr44W6Htn",
    name: "Premium Monthly",
    amount: 20_00,
    currency: "usd",
    interval: "month",
    type: "subscription" as const,
  },
  day_pass: {
    priceId: "price_1SNEqpKAifASkGDzdydTmEQc",
    name: "Day Pass",
    amount: 10_00,
    currency: "gel",
    type: "payment" as const,
  },
  annual: {
    priceId: "price_1SNErcKAifASkGDzCZ71QpQE",
    name: "Annual Plan",
    amount: 499_00,
    currency: "gel",
    interval: "year",
    type: "subscription" as const,
  },
} as const;

export type PlanType = keyof typeof STRIPE_PLANS;

export const getPlanConfig = (plan: string) => {
  if (!(plan in STRIPE_PLANS)) {
    throw new Error(`Invalid plan: ${plan}`);
  }
  return STRIPE_PLANS[plan as PlanType];
};
