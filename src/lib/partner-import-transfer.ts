import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import { saveUploadedPhotos } from "./image-upload";
import { parsePartnerPhotoKeys, partnerPrivateDirectory, readPartnerPrivatePhoto, removePartnerPrivatePhotos } from "./partner-import-photos";
import { readPartnerPhotoCover } from "./partner-import-photo-cover";
import { MAX_TRANSFER_LINE_BYTES, MAX_TRANSFER_POSTS, TRANSFER_FORMAT, parseTransferRecord } from "./partner-import-transfer-format";

export async function receiveTransferredDraft(sourceId: number, input: unknown) {
  const source = await prisma.partnerImportSource.findUnique({ where: { id: sourceId }, select: { id: true, origin: true } });
  if (!source) throw new Error("INVALID_TRANSFER");
  const record = parseTransferRecord(input, source.origin);
  const contentHash = createHash("sha256").update("transfer-v1:").update(JSON.stringify({
    fields: record.fields, cover: record.cover,
    photos: record.photos.map(bytes => createHash("sha256").update(bytes).digest("hex")),
  })).digest("hex");
  let keys: string[] = [];
  let retained = false;
  try {
    const paths = await saveUploadedPhotos(record.photos.map(bytes => new File([new Uint8Array(bytes)], "photo.jpg")), partnerPrivateDirectory());
    keys = paths.map(value => value.slice("/uploads/".length));
    const result = await prisma.$transaction(async tx => {
      const post = await tx.partnerImportedPost.upsert({
        where: { sourceId_sourceUrl: { sourceId: source.id, sourceUrl: record.sourceUrl } },
        create: { sourceId: source.id, sourceUrl: record.sourceUrl }, update: {},
      });
      const existing = await tx.partnerImportDraft.findUnique({
        where: { postId_contentHash: { postId: post.id, contentHash } }, select: { id: true },
      });
      if (existing) return "skipped" as const;
      await tx.partnerImportDraft.create({
        data: { postId: post.id, contentHash, status: "pending", baseRevision: post.revision,
          fields: JSON.stringify({ ...record.fields, _photoCover: record.cover }), photos: JSON.stringify(keys) },
        select: { id: true },
      });
      return "imported" as const;
    });
    retained = result === "imported";
    return result;
  } finally {
    if (!retained && keys.length) await removePartnerPrivatePhotos(keys);
  }
}

export async function exportTransferredJob(jobId: string) {
  if (!/^[0-9a-f-]{36}$/.test(jobId)) throw new Error("INVALID_TRANSFER");
  const job = await prisma.partnerImportJob.findUnique({
    where: { id: jobId },
    select: { sourceId: true, source: { select: { origin: true } },
      items: { where: { status: { in: ["imported", "skipped"] }, draftId: { not: null } }, take: MAX_TRANSFER_POSTS,
        orderBy: { id: "asc" }, select: { draftId: true } } },
  });
  if (!job) throw new Error("INVALID_TRANSFER");
  const ids = [...new Set(job.items.map(item => item.draftId).filter((id): id is number => id !== null))];
  const drafts = await prisma.partnerImportDraft.findMany({
    where: { id: { in: ids }, status: "pending", post: { sourceId: job.sourceId } },
    orderBy: { id: "asc" }, take: MAX_TRANSFER_POSTS, select: { id: true, version: true },
  });
  if (!drafts.length) throw new Error("EMPTY_TRANSFER");
  let position = -1;
  const encoder = new TextEncoder();
  const line = (value: unknown) => {
    const bytes = encoder.encode(JSON.stringify(value) + "\n");
    if (bytes.byteLength > MAX_TRANSFER_LINE_BYTES) throw new Error("INVALID_TRANSFER");
    return bytes;
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (position === -1) {
          position = 0;
          controller.enqueue(line({ format: TRANSFER_FORMAT, kind: "header", count: drafts.length }));
          return;
        }
        if (position === drafts.length) {
          controller.enqueue(line({ format: TRANSFER_FORMAT, kind: "end", count: drafts.length }));
          controller.close();
          return;
        }
        const snapshot = drafts[position++];
        const draft = await prisma.partnerImportDraft.findFirst({
          where: { id: snapshot.id, version: snapshot.version, status: "pending", post: { sourceId: job.sourceId } },
          select: { fields: true, photos: true, post: { select: { sourceUrl: true } } },
        });
        if (!draft) throw new Error("INVALID_TRANSFER");
        const photos: string[] = [];
        let total = 0;
        for (const key of parsePartnerPhotoKeys(draft.photos)) {
          const bytes = await readPartnerPrivatePhoto(key);
          total += bytes.length;
          if (bytes.length > 5 * 1024 * 1024 || total > 12 * 1024 * 1024) throw new Error("INVALID_TRANSFER");
          photos.push(bytes.toString("base64"));
        }
        controller.enqueue(line({ format: TRANSFER_FORMAT, kind: "post", origin: job.source.origin,
          sourceUrl: draft.post.sourceUrl, fields: JSON.parse(draft.fields),
          cover: readPartnerPhotoCover(draft.fields, true), photos }));
      } catch {
        controller.error(new Error("中转文件生成未完成，请重新下载。"));
      }
    },
  });
}
