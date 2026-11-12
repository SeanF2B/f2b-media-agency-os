import { headers } from "next/headers";
import { chatGPTSignInPath, getChatGPTUser } from "./chatgpt-auth";
import { AgencyAppShell } from "../components/agency-app-shell";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  if (!user) {
    const requestHeaders = await headers();
    const host = requestHeaders.get("host") || "";
    const isIndependentWorker = host.endsWith(".workers.dev");
    return (
      <main className="sign-in-page">
        <div className="sign-in-card">
          <div className="brand-mark">F2B</div>
          <p className="eyebrow">F2B MEDIA · AGENCY OS</p>
          <h1>Your agency,<br />in one place.</h1>
          <p className="muted">Sign in securely to manage clients, delivery, time and profitability.</p>
          {isIndependentWorker ? (
            <p className="tiny-note">🔐 Sign-in is managed by F2B's Cloudflare Access. If you can see this message, the app's private sign-in policy still needs to be enabled.</p>
          ) : (
            <a className="primary-button sign-in-button" href={chatGPTSignInPath("/")} target="_top">Continue with ChatGPT <span>↗</span></a>
          )}
          <p className="tiny-note">Private workspace · Your agency data stays behind sign-in</p>
        </div>
      </main>
    );
  }
  return <AgencyAppShell />;
}
