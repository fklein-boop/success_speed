import { z } from "zod";
import { getDb } from "@/db";
import { assertUser } from "@/lib/server/auth";
import { AuditError } from "@/lib/server/audits";
import { handle } from "@/lib/server/http";
import { synchroniserGa4 } from "@/lib/server/ga4";
import { Ga4Error } from "@/lib/ga4/client";

export const maxDuration = 300;

const Corps = z.object({ correspondances: z.record(z.string().max(200), z.string().max(20).nullable()).optional() });

/** Synchronisation GA4 avec les rattachements validés (mémorisés pour les synchronisations suivantes). */
export const POST = handle(async (req: Request) => {
  const u = await assertUser(["superadmin"]);
  const { correspondances } = Corps.parse(await req.json().catch(() => ({})));
  try { return await synchroniserGa4(await getDb(), u.id, correspondances); }
  catch (e) { if (e instanceof Ga4Error) throw new AuditError(e.message, e.status); throw e; }
});
