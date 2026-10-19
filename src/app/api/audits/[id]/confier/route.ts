import { z } from "zod";
import { getDb } from "@/db";
import { assertUser } from "@/lib/server/auth";
import { confierAudit } from "@/lib/server/audits";
import { handle } from "@/lib/server/http";
import { logActivity } from "@/lib/server/activity";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await assertUser(["superadmin", "csm"]);
  const { id } = await ctx.params;
  const { userId } = z.object({ userId: z.number().int() }).parse(await req.json());
  const cible = await confierAudit(await getDb(), Number(id), userId);
  await logActivity(u.id, "audit_confie", "audit", id, { a: cible.email });
  return { ok: true };
});
