import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { assertUser } from "@/lib/server/auth";
import { finaliserAudit } from "@/lib/server/audits";
import { recomputeAll } from "@/lib/server/recompute";
import { handle } from "@/lib/server/http";
import { logActivity } from "@/lib/server/activity";

export const maxDuration = 120;

export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await assertUser(["superadmin", "csm"]);
  const { id } = await ctx.params;
  const db = await getDb();
  const a = await finaliserAudit(db, Number(id));
  await recomputeAll(db); // alertes issues de l'audit (critère légal à NON, baisse de maturité)
  await logActivity(u.id, "audit_finalise", "audit", id, { clientId: a.clientId, score: (a.score as { score: number | null } | null)?.score ?? null });
  revalidatePath("/", "layout");
  return { ok: true };
});
