import { parsePartnerPhotoCover, readPartnerPhotoCover } from "@/lib/partner-import-photo-cover";
import { renderPartnerPhotoCover } from "@/lib/partner-import-photo-cover-render";
import { isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isPartnerPhotoKey, parsePartnerPhotoKeys, readPartnerPrivatePhoto } from "@/lib/partner-import-photos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
};

export async function GET(request: Request, { params }: { params: Promise<{ draftId: string; filename: string }> }) {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401, headers: privateHeaders });
  const { draftId, filename } = await params;
  const id = Number(draftId);
  if (!Number.isSafeInteger(id) || id < 1 || !isPartnerPhotoKey(filename)) {
    return new Response("Not found", { status: 404, headers: privateHeaders });
  }
  try {
    const draft = await prisma.partnerImportDraft.findUnique({ where: { id }, select: { photos: true, fields: true, status: true } });
    if (!draft || !parsePartnerPhotoKeys(draft.photos).includes(filename)) {
      return new Response("Not found", { status: 404, headers: privateHeaders });
    }
    const parameter = new URL(request.url).searchParams.get("cover");
    let cover;
    try {
      if (parameter !== null && parameter.length > 1024) throw new Error("INVALID_PHOTO_COVER");
      cover = parameter === "off" ? null : parameter === null ? readPartnerPhotoCover(draft.fields, draft.status === "pending")
        : parsePartnerPhotoCover(JSON.parse(parameter));
    } catch { return new Response("Invalid photo cover", { status: 400, headers: privateHeaders }); }
    const original = await readPartnerPrivatePhoto(filename);
    const image = cover ? await renderPartnerPhotoCover(original, cover) : original;
    return new Response(new Uint8Array(image), {
      headers: { ...privateHeaders, "Content-Type": "image/jpeg", "Content-Length": String(image.byteLength) },
    });
  } catch { return new Response("Not found", { status: 404, headers: privateHeaders }); }
}
