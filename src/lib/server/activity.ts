import { getDb } from "@/db";
import { activityLog } from "@/db/schema";

/** Journal d'activité (connexions, audits, imports, exports, envois). Jamais de secret dans `details`. */
export async function logActivity(userId: number | null, action: string, entite?: string, entiteId?: string, details?: unknown) {
  const db = await getDb();
  await db.insert(activityLog).values({ userId, action, entite, entiteId, details: details ?? null });
}
