function featureEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

// Temporary free-access mode: payments stay off until this code-level switch is restored.
export const PAYMENT_FEATURE_ENABLED = false;
export const ALLEY_PUBLIC_ENABLED = featureEnabled(
  process.env.ALLEY_PUBLIC_ENABLED,
);
export const ALLEY_DIRECT_ACCESS_ENABLED = featureEnabled(
  process.env.ALLEY_DIRECT_ACCESS_ENABLED ?? "true",
);
