const BASE_CSP_DIRECTIVES = [
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
];

export function securityHeaders(nodeEnv: string | undefined = process.env.NODE_ENV) {
  const cspDirectives = [...BASE_CSP_DIRECTIVES];
  if (nodeEnv === "production") cspDirectives.push("upgrade-insecure-requests");

  return [
    { key: "Content-Security-Policy", value: cspDirectives.join("; ") },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];
}
