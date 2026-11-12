import { AgencyAppShell } from "../components/agency-app-shell";

// The app shell is entirely client-rendered and all sensitive workspace data
// is fetched from authenticated APIs. Keep the landing document static so the
// Worker does not spend its 10 ms free-plan CPU budget doing per-request SSR.
export const dynamic = "force-static";

export default function Home() {
  return <AgencyAppShell />;
}
