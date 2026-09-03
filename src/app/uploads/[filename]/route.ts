import { readFile } from "node:fs/promises";
import path from "node:path";
import { isSafeUploadedPhotoFilename } from "@/lib/uploaded-photos";

export const dynamic = "force-dynamic";

function contentType(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "image/jpeg";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  if (!isSafeUploadedPhotoFilename(filename)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const image = await readFile(
      path.join(process.cwd(), "public", "uploads", filename),
    );
    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": contentType(filename),
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": String(image.byteLength),
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
