"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  const actif = href === "/" ? path === "/" || path.startsWith("/clients") || path.startsWith("/audits") : path.startsWith(href);
  return (
    <Link href={href} aria-current={actif ? "page" : undefined}
      className={`rounded-full px-3 py-1.5 ${actif ? "bg-white/15 font-semibold text-white" : "text-white/80 hover:bg-white/10 hover:text-white"}`}>
      {children}
    </Link>
  );
}
