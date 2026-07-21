"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/v2/admin", label: "Hub" },
  { href: "/v2/admin/users", label: "Usuários" },
  { href: "/v2/admin/jogos", label: "Jogos" },
  { href: "/v2/app", label: "App membro" },
];

export function V2AdminNav() {
  const path = usePathname();
  return (
    <nav className="v2-admin-nav" aria-label="Admin v2">
      {LINKS.map((l) => {
        const active = path === l.href || path.startsWith(l.href + "/");
        return (
          <Link
            key={l.href}
            href={l.href}
            className={active ? "is-active" : undefined}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
