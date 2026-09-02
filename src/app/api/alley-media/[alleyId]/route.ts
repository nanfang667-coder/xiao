import { readAlleyDetailPhoto } from "@/lib/alley-media";
import { isActiveMember } from "@/lib/membership";
import { getCurrentUser } from "@/lib/user-auth";
import { ALLEY_DIRECT_ACCESS_ENABLED } from "@/lib/feature-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ alleyId: string }> },
) {
  const user = await getCurrentUser();
  if (!ALLEY_DIRECT_ACCESS_ENABLED || !isActiveMember(user)) {
    return new Response(null, { status: 404 });
  }

  const { alleyId: filename } = await params;
  const image = await readAlleyDetailPhoto(filename);
  if (!image) return new Response(null, { status: 404 });

  return new Response(new Uint8Array(image), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
