import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { audits } from "@/db/schema";
import { assertUser } from "@/lib/server/auth";
import { changesSince, heartbeat } from "@/lib/server/audits";
import { handle } from "@/lib/server/http";

/** Synchronisation entre collègues : présence + évaluations modifiées depuis la dernière synchro. */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await assertUser();
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const depuis = new Date(url.searchParams.get("depuis") ?? 0);
  const db = await getDb();
  const maintenant = new Date().toISOString();
  const [presents, changes, [audit]] = await Promise.all([
    u.role === "lecture" ? Promise.resolve([]) : heartbeat(db, Number(id), u.id, url.searchParams.get("critere")),
    changesSince(db, Number(id), isNaN(depuis.getTime()) ? new Date(0) : depuis),
    db.select({ statut: audits.statut, score: audits.score, assigneA: audits.assigneA }).from(audits).where(eq(audits.id, Number(id))),
  ]);
  return { maintenant, presents, changes, audit };
});
