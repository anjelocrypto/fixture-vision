# Stripe Integration Setup Guide

## Overview
This app implements Stripe for subscriptions and one-time payments with three plans:
- **Premium Monthly** - $20/month (recurring)
- **Day Pass** - 10 GEL one-time (24h access)
- **Annual** - 499 GEL/year (recurring)

## Prerequisites
1. Stripe account (test or live mode)
2. Secrets configured in Lovable Cloud:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `APP_URL`

## Setup Steps

### 1. Configure Stripe Customer Portal
Before users can manage their subscriptions, enable the Stripe Customer Portal:
1. Go to [Stripe Dashboard → Settings → Billing → Customer Portal](https://dashboard.stripe.com/settings/billing/portal)
2. Click **Activate**
3. Configure your portal settings (cancellation policy, allowed actions, etc.)

### 2. Run Bootstrap Function
The bootstrap function creates products and prices in Stripe:

```bash
# Call the bootstrap function (dev/admin only)
curl -X POST https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/stripe-bootstrap
```

This will return price IDs like:
```json
{
  "productIds": {
    "premium_monthly": "prod_...",
    "day_pass": "prod_...",
    "annual": "prod_..."
  },
  "priceIds": {
    "premium_monthly": "price_...",
    "day_pass": "price_...",
    "annual": "price_..."
  }
}
```

### 3. Update Price IDs in Code
Edit `supabase/functions/create-checkout-session/index.ts` and replace the placeholder price IDs:

```typescript
const PRICE_IDS: Record<string, string> = {
  premium_monthly: "price_XXXXXX", // Replace with actual ID
  day_pass: "price_XXXXXX",        // Replace with actual ID
  annual: "price_XXXXXX",          // Replace with actual ID
};
```

### 4. Configure Webhook in Stripe
1. Go to [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click **Add endpoint**
3. Set endpoint URL: `https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/stripe-webhook`
4. Select events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `charge.succeeded`
5. Copy the **Signing secret** and update `STRIPE_WEBHOOK_SECRET` in Lovable Cloud

### 5. Test the Integration

#### Test Cards (Stripe Test Mode)
- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- Use any future expiry date and any CVC

#### Test Flows
1. **Monthly Subscription**:
   - Go to `/pricing`
   - Click "Premium Monthly"
   - Complete checkout
   - Verify in `/account` that status shows "Active"

2. **Day Pass**:
   - Purchase Day Pass
   - Verify 24-hour access
   - After 24h, access should be revoked

3. **Annual Subscription**:
   - Purchase Annual plan
   - Verify billing shows 499 GEL/year

4. **Billing Portal**:
   - Go to `/account`
   - Click "Manage Billing"
   - Test cancellation/plan changes

## Architecture

### Edge Functions
- **stripe-bootstrap** - Creates products/prices (run once, dev only)
- **create-checkout-session** - Creates Stripe checkout sessions
- **billing-portal** - Opens Stripe customer portal for subscription management
- **stripe-webhook** - Handles Stripe webhook events

### Database
- **user_entitlements** - Stores subscription status per user
- **webhook_events** - Tracks processed webhook events (idempotency)

### Access Control
- `user_has_access()` function checks if user has active subscription
- `useAccess()` hook provides client-side access status
- `PaywallGate` component gates premium features

### Premium Features
All gated by subscription:
- Ticket Creator (AI-powered)
- Optimizer (Safe/Standard/Risky modes)
- Filterizer (Advanced selection filtering)
- Gemini Analyzer (AI fixture analysis)
- My Ticket (Personal ticket management)

## Troubleshooting

### Webhook Not Firing
- Verify webhook URL is correct
- Check endpoint is receiving POST requests
- Review webhook delivery attempts in Stripe Dashboard
- Ensure `STRIPE_WEBHOOK_SECRET` matches Stripe

### User Can't Access Features After Payment
- Check `user_entitlements` table for user's row
- Verify `status = 'active'` and `current_period_end > now()`
- Click "Refresh Status" in `/account`
- Check webhook logs for processing errors

### Day Pass Not Expiring
- Verify `current_period_end` is set to 24 hours from purchase
- Check that access polling is running (every 5 minutes)

### Customer Portal Not Working
- Ensure portal is activated in Stripe Dashboard
- Verify customer exists in Stripe with correct metadata
- Check that user has an active or canceled subscription

## Security Notes

✅ **Implemented**:
- All secrets stored server-side only
- Webhook signature verification
- Idempotency for webhook processing
- RLS policies on all tables
- Service role for webhook DB writes
- No secrets logged or exposed to client

⚠️ **Important**:
- Never log full Stripe payloads (contain PII)
- Never expose `STRIPE_SECRET_KEY` to client
- Always use `service_role` for webhook database operations
- Rotate keys if compromised

## Going Live

1. Switch to **Live Mode** in Stripe Dashboard
2. Update `STRIPE_SECRET_KEY` to live key
3. Update webhook endpoint to use live key signing secret
4. Update `APP_URL` to production domain
5. Re-run bootstrap or manually create live products/prices
6. Update price IDs in code with live IDs
7. Test with real cards (small amounts first)

## Support

For Stripe-related issues:
- [Stripe Dashboard](https://dashboard.stripe.com/)
- [Stripe Docs](https://stripe.com/docs)
- [Webhook Testing](https://dashboard.stripe.com/test/webhooks)
