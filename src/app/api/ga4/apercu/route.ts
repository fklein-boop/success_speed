import { getDb } from "@/db";
import { assertUser } from "@/lib/server/auth";
import { AuditError } from "@/lib/server/audits";
import { handle } from "@/lib/server/http";
import { apercuGa4 } from "@/lib/server/ga4";
import { Ga4Error } from "@/lib/ga4/client";

export const maxDuration = 120;

/** Valeurs de « Nom du client » trouvées dans GA4 et client proposé pour chacune (super admin). */
export const GET = handle(async () => {
  await assertUser(["superadmin"]);
  try { return await apercuGa4(await getDb()); }
  catch (e) { if (e instanceof Ga4Error) throw new AuditError(e.message, e.status); throw e; }
});
