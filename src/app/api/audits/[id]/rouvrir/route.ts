import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { audits } from "@/db/schema";
import { assertUser, HttpError } from "@/lib/server/auth";
import { rouvrirAudit } from "@/lib/server/audits";
import { recomputeAll } from "@/lib/server/recompute";
import { handle } from "@/lib/server/http";
import { logActivity } from "@/lib/server/activity";

export const maxDuration = 120;

export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await assertUser(["superadmin", "csm"]);
  const { id } = await ctx.params;
  const db = await getDb();
  const [a] = await db.select().from(audits).where(eq(audits.id, Number(id)));
  if (a && u.role !== "superadmin" && a.auteurId !== u.id && a.assigneA !== u.id)
    throw new HttpError(403, "Seuls l'auteur, la personne assignée ou un super admin peuvent rouvrir cet audit.");
  await rouvrirAudit(db, Number(id));
  await recomputeAll(db);
  await logActivity(u.id, "audit_rouvert", "audit", id);
  revalidatePath("/", "layout");
  return { ok: true };
});
