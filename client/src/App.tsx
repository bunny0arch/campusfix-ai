import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import AccountWorkspaceShell from "./components/AccountWorkspaceShell";
import { ThemeProvider } from "./contexts/ThemeContext";
import { trpc } from "./lib/trpc";
import AccountGate from "./pages/AccountGate";
import AccountProfile from "./pages/AccountProfile";
import NotFound from "./pages/NotFound";
import PublicSupport from "./pages/PublicSupport";

function Router() {
  const account = trpc.account.session.useQuery(undefined, { retry: false, staleTime: 0 });
  if (account.isLoading) return <main className="account-session-loading">Checking your secure CampusFix session…</main>;
  if (!account.data) return <AccountGate onAuthenticated={async () => {
    const refreshed = await account.refetch();
    if (!refreshed.data) throw new Error("Your account was created, but the secure session could not be restored. Please try signing in again.");
  }} />;
  return <AccountWorkspaceShell user={account.data}><div className="account-workspace-enter"><Switch><Route path="/" component={PublicSupport} /><Route path="/profile" component={AccountProfile} /><Route path="/404" component={NotFound} /><Route component={NotFound} /></Switch></div></AccountWorkspaceShell>;
}

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="dark"><TooltipProvider><Toaster theme="dark" /><Router /></TooltipProvider></ThemeProvider></ErrorBoundary>;
}
