export const TERMS_VERSION = "2026-08-22";
export const PRIVACY_VERSION = "2026-08-22";

export function signupLegalAttestation() {
  const acceptedAt = new Date().toISOString();
  return {
    age_18_or_over_confirmed: true,
    age_confirmed_at: acceptedAt,
    terms_accepted_at: acceptedAt,
    terms_version: TERMS_VERSION,
    privacy_accepted_at: acceptedAt,
    privacy_version: PRIVACY_VERSION,
  };
}
