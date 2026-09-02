import { canAccessAlleyPost } from "@/lib/alley-access";
import { readAlleyDetailPhoto } from "@/lib/alley-media";
import { publishedAlleyHasDetailPhoto } from "@/lib/alleys";
import { ALLEY_DIRECT_ACCESS_ENABLED } from "@/lib/feature-flags";
import { getCurrentUser } from "@/lib/user-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ alleyId: string; filename: string }> },
) {
  if (!ALLEY_DIRECT_ACCESS_ENABLED) {
    return new Response(null, { status: 404 });
  }

  const { alleyId: rawAlleyId, filename } = await params;
  const alleyPostId = Number(rawAlleyId);
  if (!Number.isSafeInteger(alleyPostId) || alleyPostId <= 0) {
    return new Response(null, { status: 404 });
  }

  const user = await getCurrentUser();
  const [canAccess, belongsToPost] = await Promise.all([
    canAccessAlleyPost(user, alleyPostId),
    publishedAlleyHasDetailPhoto(alleyPostId, filename),
  ]);
  if (!canAccess || !belongsToPost) {
    return new Response(null, { status: 404 });
  }

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
