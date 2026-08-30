import { readAlleyDetailPhoto } from "@/lib/alley-media";
import { isAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  if (!(await isAdmin())) return new Response(null, { status: 404 });

  const { filename } = await params;
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
