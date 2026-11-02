"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Session } from "@/lib/session";

const NAV = [
  {
    section: "Roster",
    items: [
      { href: "/", label: "Overview" },
      { href: "/crew", label: "Crew" },
      { href: "/flights", label: "Flights" },
      { href: "/roster", label: "Duty roster" },
      { href: "/reference", label: "Airports & fleet" },
    ],
  },
];

export function Sidebar({ session }: { session: Session }) {
  const pathname = usePathname();
  const router = useRouter();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-line bg-white/70 px-4 py-6 backdrop-blur-xl">
      <Link href="/" className="mb-8 flex items-center gap-2.5 px-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent text-sm font-bold text-white">CG</span>
        <span className="text-[17px] font-semibold tracking-tight">CrewGuard</span>
      </Link>

      <nav className="flex-1 space-y-6 overflow-y-auto">
        {NAV.map((group) => (
          <div key={group.section}>
            <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{group.section}</p>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-lg px-2 py-1.5 text-sm transition ${
                  isActive(item.href) ? "bg-accent/10 font-medium text-accent" : "text-ink hover:bg-zinc-100"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="mt-4 rounded-xl bg-zinc-50 p-3">
        <p className="truncate text-sm font-medium">{session.username}</p>
        <p className="text-xs text-muted">{session.role === "SCHEDULER" ? "Scheduler" : "Auditor"}</p>
        <button onClick={signOut} className="mt-2 text-xs font-medium text-accent hover:underline">
          Sign out
        </button>
      </div>
    </aside>
  );
}
