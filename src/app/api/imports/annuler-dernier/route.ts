import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { undoLastImport } from "@/lib/server/imports";
import { handle } from "@/lib/server/http";
import { assertUser } from "@/lib/server/auth";
import { logActivity } from "@/lib/server/activity";

export const maxDuration = 300;

export const POST = handle(async () => {
  const u = await assertUser(["superadmin"]);
  const res = await undoLastImport(await getDb());
  await logActivity(u.id, "import_annule", "import", String(res.importId), { reference: res.diff.reference });
  revalidatePath("/", "layout");
  return res;
});
