export const metadata = {
  title: "Converge | Plan your next trip together",
  description: "Find dates, compare availability, and make a trip happen together.",
};

export const dynamic = "force-dynamic";
import {runtimeConfig} from "@/lib/runtime/config";
import {notificationMode} from "@/lib/notifications";
import DemoBar from "@/components/DemoBar";
import {getAppSession} from "@/lib/runtime/session";
import Providers from "@/components/Providers";
import "@/components/converge/ui.css";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const config = runtimeConfig();
  const session = await getAppSession();
  return (
    <html lang="en">
      <body data-actor={session?.user?.actorId || "anonymous"} data-mode={config.mode} style={{ margin: 0, padding: 0, background: "var(--paper)" }}>
        <Providers session={session} runtime={{mode:config.mode,notificationMode:notificationMode()}}>{config.mode === "demo" && <DemoBar/>}{children}</Providers>
        <footer style={{ textAlign: "center", padding: "20px 0 28px", fontSize: 12, color: "#9CA3AF", fontFamily: "-apple-system, sans-serif" }}>
          Make time for a trip together. {" "}
          <a href="/privacy" style={{ color: "#6B7280" }}>Privacy Policy</a>
        </footer>
      </body>
    </html>
  );
}
