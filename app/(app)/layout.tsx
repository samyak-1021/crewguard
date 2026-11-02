import { Sidebar } from "@/components/sidebar";
import { requireSession } from "@/lib/auth";

// Every page inside (app) needs a signed-in user.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  return (
    <div className="flex min-h-screen">
      {/* the grey column runs the full page height; the sidebar inside it stays put while scrolling */}
      <div className="shrink-0 border-r border-line bg-panel">
        <Sidebar session={session} />
      </div>
      <main className="min-w-0 flex-1 px-10 py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
