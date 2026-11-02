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
  {
    section: "Compliance",
    items: [
      { href: "/runs", label: "Validation runs" },
      { href: "/violations", label: "Violations" },
      { href: "/rules", label: "Rules" },
    ],
  },
  {
    section: "Analytics",
    items: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/activity", label: "Activity log" },
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
    <aside className="sticky top-0 flex h-screen w-60 flex-col px-4 py-6">
      <Link href="/" className="mb-8 flex items-center gap-2.5 px-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 text-sm font-bold text-white">CG</span>
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
                className={`block rounded-lg border-l-[3px] px-2.5 py-1.5 text-sm transition ${
                  isActive(item.href)
                    ? "border-accent bg-white font-medium text-accent ring-1 ring-line"
                    : "border-transparent text-slate-600 hover:bg-white hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="mt-4 rounded-lg border border-line bg-white p-3">
        <p className="truncate text-sm font-medium">{session.username}</p>
        <span className={`mt-1 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
          session.role === "SCHEDULER" ? "bg-blue-50 text-blue-700 ring-blue-200" : "bg-violet-50 text-violet-700 ring-violet-200"
        }`}>
          {session.role === "SCHEDULER" ? "Scheduler" : "Auditor"}
        </span>
        <button onClick={signOut} className="mt-2 block text-xs font-medium text-accent hover:underline">
          Sign out
        </button>
      </div>
    </aside>
  );
}
