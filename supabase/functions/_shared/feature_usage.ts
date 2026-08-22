export interface FeatureReservation {
  allowed: boolean;
  reason: string;
  remainingUses: number | null;
  reservationId: string | null;
}

function firstRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return (data[0] as Record<string, unknown>) ?? null;
  return data && typeof data === "object" ? data as Record<string, unknown> : null;
}

export async function reserveFeatureUse(
  userClient: any,
  featureKey: "bet_optimizer" | "gemini_analysis",
): Promise<FeatureReservation> {
  const { data, error } = await userClient.rpc("reserve_feature_use", {
    p_feature_key: featureKey,
  });
  if (error) throw new Error(`Feature access reservation failed: ${error.message}`);

  const row = firstRow(data);
  return {
    allowed: row?.allowed === true,
    reason: String(row?.reason ?? "access_denied"),
    remainingUses: typeof row?.remaining_uses === "number" ? row.remaining_uses : null,
    reservationId: typeof row?.reservation_id === "string" ? row.reservation_id : null,
  };
}

export async function finalizeFeatureUse(userClient: any, reservationId: string): Promise<void> {
  const { data, error } = await userClient.rpc("finalize_feature_use", {
    p_reservation_id: reservationId,
  });
  if (error) throw new Error(`Feature usage finalization failed: ${error.message}`);
  const row = firstRow(data);
  if (row?.consumed !== true) throw new Error("Feature usage reservation expired before finalization");
}

export async function releaseFeatureUse(userClient: any, reservationId: string): Promise<void> {
  const { error } = await userClient.rpc("release_feature_use", {
    p_reservation_id: reservationId,
  });
  if (error) console.error("[feature-usage] Failed to release reservation", error);
}

export async function responseDeliveredValue(response: Response): Promise<boolean> {
  if (!response.ok) return false;
  const payload = await response.clone().json().catch(() => null);
  if (!payload || payload.error || payload.code) return false;
  if (payload.ticket) return true;
  return Array.isArray(payload.legs) && payload.legs.length > 0;
}
