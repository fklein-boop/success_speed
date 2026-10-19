"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Onglets d'une section (Pilotage, Administration). */
export function SousNav({ liens, label }: { liens: { href: string; label: string }[]; label: string }) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1 border-b border-gris-clair">
      {liens.map((l) => {
        const actif = path === l.href || (l.href !== liens[0].href && path.startsWith(l.href));
        return (
          <Link key={l.href} href={l.href} aria-current={actif ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${actif ? "border-horizon font-semibold text-horizon" : "border-transparent text-gris-texte hover:text-minuit"}`}>{l.label}</Link>
        );
      })}
    </nav>
  );
}
