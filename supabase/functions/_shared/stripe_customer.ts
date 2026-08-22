import type { User } from "npm:@supabase/supabase-js@2";

interface ResolveStripeCustomerOptions {
  stripe: any;
  supabase: any;
  user: User;
  allowLegacyEmailRecovery?: boolean;
}

async function persistStripeCustomerId(
  supabase: any,
  userId: string,
  customerId: string,
): Promise<void> {
  const { error } = await supabase
    .from("user_entitlements")
    .update({
      stripe_customer_id: customerId,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .is("stripe_customer_id", null);

  if (error) {
    throw new Error(`Unable to persist billing customer mapping: ${error.message}`);
  }
}

export async function resolveStripeCustomerId({
  stripe,
  supabase,
  user,
  allowLegacyEmailRecovery = false,
}: ResolveStripeCustomerOptions): Promise<string | null> {
  const { data: entitlement, error: entitlementError } = await supabase
    .from("user_entitlements")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (entitlementError) {
    throw new Error(`Unable to resolve billing customer: ${entitlementError.message}`);
  }

  if (entitlement?.stripe_customer_id) {
    const customer = await stripe.customers.retrieve(entitlement.stripe_customer_id);
    if (customer.deleted) {
      throw new Error("The mapped Stripe customer has been deleted");
    }

    const ownerId = customer.metadata?.user_id;
    if (ownerId && ownerId !== user.id) {
      throw new Error("Stripe customer ownership mismatch");
    }

    if (!ownerId) {
      await stripe.customers.update(customer.id, {
        metadata: { ...customer.metadata, user_id: user.id },
      });
    }

    return customer.id;
  }

  if (!user.email) {
    return null;
  }

  const customers = await stripe.customers.list({ email: user.email, limit: 10 });
  const ownedCustomer = customers.data.find(
    (customer: any) => !customer.deleted && customer.metadata?.user_id === user.id,
  );
  if (ownedCustomer) {
    await persistStripeCustomerId(supabase, user.id, ownedCustomer.id);
    return ownedCustomer.id;
  }

  if (!allowLegacyEmailRecovery) {
    return null;
  }

  const unclaimedCustomers = customers.data.filter(
    (customer: any) => !customer.deleted && !customer.metadata?.user_id,
  );
  if (unclaimedCustomers.length !== 1) {
    return null;
  }

  const legacyCustomer = unclaimedCustomers[0];
  await stripe.customers.update(legacyCustomer.id, {
    metadata: { ...legacyCustomer.metadata, user_id: user.id },
  });
  await persistStripeCustomerId(supabase, user.id, legacyCustomer.id);
  return legacyCustomer.id;
}
