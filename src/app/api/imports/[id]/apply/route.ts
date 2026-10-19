import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { applyImport } from "@/lib/server/imports";
import { handle } from "@/lib/server/http";
import { assertImporter } from "@/lib/server/import-access";
import { logActivity } from "@/lib/server/activity";
import { sendWeeklyEmail } from "@/lib/server/weekly-email";

export const maxDuration = 300;

const Body = z.object({
  creer: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,20}$/)).optional(),
  rattacher: z.record(z.string(), z.string()).optional(),
});

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await assertImporter();
  const { id } = await ctx.params;
  const decisions = Body.parse(await req.json().catch(() => ({})));
  const db = await getDb();
  const res = await applyImport(db, Number(id), u.id, decisions);
  await logActivity(u.id, "import_applique", "import", id, { nouveaux: res.nouveaux, modifies: res.modifies, reference: res.diff.reference });
  const email = await sendWeeklyEmail(db, res.diff).catch(() => ({ ok: false }));
  revalidatePath("/", "layout");
  return { ...res, emailEnvoye: email.ok };
});
