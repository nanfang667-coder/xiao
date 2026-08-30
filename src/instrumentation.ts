export async function register() {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    process.env.NODE_ENV !== "production"
  ) {
    return;
  }

  const { PAYMENT_FEATURE_ENABLED } = await import("@/lib/feature-flags");
  if (!PAYMENT_FEATURE_ENABLED) return;

  const { verifyPaymentStartupConfiguration } =
    await import("@/lib/payment-startup");
  verifyPaymentStartupConfiguration();
}
