import { z } from "zod";
import { getDb } from "@/db";
import { assertUser } from "@/lib/server/auth";
import { createAudit } from "@/lib/server/audits";
import { handle } from "@/lib/server/http";
import { logActivity } from "@/lib/server/activity";

export const maxDuration = 60;

export const POST = handle(async (req: Request) => {
  const u = await assertUser(["superadmin", "csm"]);
  const { clientId } = z.object({ clientId: z.string().min(1) }).parse(await req.json());
  const r = await createAudit(await getDb(), clientId, u.id);
  if (!r.existant) await logActivity(u.id, "audit_cree", "audit", String(r.id), { clientId });
  return r;
});
