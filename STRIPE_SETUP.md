# Stripe Integration Setup Guide

## Overview
This app uses your live Stripe products with hardcoded price IDs:
- **Premium Monthly** - $20/month (recurring) - `price_1SNEq4KAifASkGDzr44W6Htn`
- **Day Pass** - 10 GEL one-time (24h access) - `price_1SNEqpKAifASkGDzdydTmEQc`
- **Annual** - 499 GEL/year (recurring) - `price_1SNErcKAifASkGDzCZ71QpQE`

## Prerequisites
1. Stripe account with products already created
2. Secrets configured in Lovable Cloud:
   - `STRIPE_SECRET_KEY` (test mode initially)
   - `STRIPE_WEBHOOK_SECRET`
   - `APP_URL` (https://ticketai.bet)

## Setup Steps

### 1. Configure Stripe Customer Portal
Before users can manage their subscriptions, enable the Stripe Customer Portal:
1. Go to [Stripe Dashboard → Settings → Billing → Customer Portal](https://dashboard.stripe.com/settings/billing/portal)
2. Click **Activate**
3. Configure your portal settings (cancellation policy, allowed actions, etc.)

### 2. Configure Webhook in Stripe
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
5. Copy the **Signing secret** (starts with `whsec_`) and update `STRIPE_WEBHOOK_SECRET` in Lovable Cloud

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

When ready to switch from test to live mode:

1. Switch to **Live Mode** in Stripe Dashboard
2. Get live price IDs from your products
3. Update `supabase/functions/_shared/stripe_plans.ts` with live price IDs
4. Update `STRIPE_SECRET_KEY` secret to live key in Lovable Cloud
5. Update webhook endpoint in Stripe to use live mode signing secret
6. Update `STRIPE_WEBHOOK_SECRET` in Lovable Cloud with live webhook secret
7. Test with real cards (start with small test purchases)

## Support

For Stripe-related issues:
- [Stripe Dashboard](https://dashboard.stripe.com/)
- [Stripe Docs](https://stripe.com/docs)
- [Webhook Testing](https://dashboard.stripe.com/test/webhooks)
