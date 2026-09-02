"use server";

import { redirect } from "next/navigation";
import { loginTeamAccount, logoutTeamAccount } from "@/lib/team-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";

export async function teamLogin(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const ip = await getClientIp();

  if (
    !username ||
    !password ||
    (ip !== "unknown" &&
      !checkRateLimit(`team-login:${ip}`, 10, 15 * 60 * 1000))
  ) {
    redirect("/team/login?error=1");
  }
  if (!(await loginTeamAccount(username, password))) {
    redirect("/team/login?error=1");
  }
  redirect("/team");
}

export async function teamLogout() {
  await logoutTeamAccount();
  redirect("/team/login");
}
