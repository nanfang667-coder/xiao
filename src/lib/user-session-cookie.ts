const USER_SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

export function userSessionCookieOptions(nodeEnv = process.env.NODE_ENV) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: USER_SESSION_COOKIE_MAX_AGE,
    secure: nodeEnv === "production",
  };
}
