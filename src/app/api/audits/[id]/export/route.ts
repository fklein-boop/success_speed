import { getDb } from "@/db";
import { assertUser } from "@/lib/server/auth";
import { csvAudit } from "@/lib/server/exports";
import { handle } from "@/lib/server/http";
import { logActivity } from "@/lib/server/activity";

export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await assertUser();
  const { id } = await ctx.params;
  const version = new URL(req.url).searchParams.get("version") === "interne" ? "interne" : "client";
  const { filename, content } = await csvAudit(await getDb(), Number(id), version);
  await logActivity(u.id, "export_csv", "audit", id, { version, fichier: filename });
  return new Response(content, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
    },
  });
});
