import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { scanCaptures } from "@/db/schema";
import { assertUser } from "@/lib/server/auth";
import { handle } from "@/lib/server/http";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await assertUser();
  const { id } = await ctx.params;
  const [c] = await (await getDb()).select().from(scanCaptures).where(eq(scanCaptures.id, Number(id)));
  if (!c) return new Response("Introuvable", { status: 404 });
  return new Response(Buffer.from(c.data, "base64"), { headers: { "content-type": c.mime, "cache-control": "private, max-age=86400" } });
});
