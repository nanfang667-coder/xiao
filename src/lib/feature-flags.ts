function featureEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

// Both features stay off unless production explicitly enables them.
export const PAYMENT_FEATURE_ENABLED = featureEnabled(
  process.env.PAYMENT_FEATURE_ENABLED,
);
export const ALLEY_PUBLIC_ENABLED = featureEnabled(
  process.env.ALLEY_PUBLIC_ENABLED,
);
