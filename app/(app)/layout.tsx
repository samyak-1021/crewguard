import { Sidebar } from "@/components/sidebar";
import { requireSession } from "@/lib/auth";

// Every page inside (app) needs a signed-in user.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  return (
    <div className="flex">
      <Sidebar session={session} />
      <main className="min-w-0 flex-1 px-10 py-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
