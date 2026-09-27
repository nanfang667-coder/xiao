import { NextRequest } from "next/server";
import { referralRedirect } from "@/lib/referral";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  return referralRedirect(req, code);
}
