import { assertQianheStartupConfiguration } from "@/lib/qianhe-payment";

export function verifyPaymentStartupConfiguration(): void {
  try {
    assertQianheStartupConfiguration();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown payment configuration error";
    process.stderr.write(
      `[payment] Invalid startup configuration: ${message}\n`,
    );
    process.exit(1);
  }
}
