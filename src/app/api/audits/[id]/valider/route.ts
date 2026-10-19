import { getDb } from "@/db";
import { assertUser } from "@/lib/server/auth";
import { validerPropositions } from "@/lib/server/audits";
import { handle } from "@/lib/server/http";
import { logActivity } from "@/lib/server/activity";

export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await assertUser(["superadmin", "csm"]);
  const { id } = await ctx.params;
  const r = await validerPropositions(await getDb(), Number(id), u.id);
  await logActivity(u.id, "audit_modifie", "audit", id, { validationAuto: r.valides });
  return r;
});
