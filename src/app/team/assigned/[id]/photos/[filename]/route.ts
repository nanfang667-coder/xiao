import { getTeamAccount } from "@/lib/team-auth";
import { prisma } from "@/lib/prisma";
import { isPartnerImportAssignmentReady } from "@/lib/partner-import-assignment-readiness";
import { isPartnerPhotoKey, parsePartnerPhotoKeys, readPartnerPrivatePhoto } from "@/lib/partner-import-photos";
import { readPartnerPhotoCover } from "@/lib/partner-import-photo-cover";
import { renderPartnerPhotoCover } from "@/lib/partner-import-photo-cover-render";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; filename: string }> }) {
  try {
    const account = await getTeamAccount();
    if (!account) return new Response("Unauthorized", { status: 401, headers: privateHeaders });
    if (!(await isPartnerImportAssignmentReady())) return new Response("Not found", { status: 404, headers: privateHeaders });
    const { id, filename } = await params;
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || !isPartnerPhotoKey(filename)) {
      return new Response("Not found", { status: 404, headers: privateHeaders });
    }
    const draft = await prisma.partnerImportDraft.findFirst({
      where: { id: Number(id), teamAccountId: account.id, status: { in: ["assigned", "returned", "submitted", "published"] } },
      select: { photos: true, fields: true, status: true },
    });
    if (!draft || !parsePartnerPhotoKeys(draft.photos).includes(filename)) {
      return new Response("Not found", { status: 404, headers: privateHeaders });
    }
    // Team members always see the administrator's saved cover configuration.
    const cover = readPartnerPhotoCover(draft.fields, draft.status !== "published");
    const original = await readPartnerPrivatePhoto(filename);
    const image = cover ? await renderPartnerPhotoCover(original, cover) : original;
    return new Response(new Uint8Array(image), {
      headers: { ...privateHeaders, "Content-Type": "image/jpeg", "Content-Length": String(image.byteLength) },
    });
  } catch {
    return new Response("Not found", { status: 404, headers: privateHeaders });
  }
}
