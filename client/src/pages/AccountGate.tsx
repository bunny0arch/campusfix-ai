import { ArrowLeft, ArrowRight, KeyRound, LoaderCircle, ShieldCheck, UserRound } from "lucide-react";
import { FormEvent, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { accountSuccessFeedback } from "@/lib/account-feedback";

type AccountMode = "choice" | "login" | "register";

export default function AccountGate({ onAuthenticated }: { onAuthenticated: () => Promise<void> | void }) {
  const [mode, setMode] = useState<AccountMode>("choice");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const register = trpc.account.register.useMutation();
  const login = trpc.account.login.useMutation();
  const busy = register.isPending || login.isPending;

  const selectMode = (next: Exclude<AccountMode, "choice">) => {
    setError(null);
    setPassword("");
    setMode(next);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      if (mode === "choice") return;
      const completedMode: "login" | "register" = mode;
      if (completedMode === "register") await register.mutateAsync({ username, password });
      else await login.mutateAsync({ username, password });
      const feedback = accountSuccessFeedback(completedMode);
      toast.success(feedback.title, { description: feedback.description });
      await onAuthenticated();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "We could not complete that request.";
      setError(message);
      toast.error("Account access could not be completed", { description: message });
    }
  };

  return <main className="account-gate" aria-labelledby="account-gate-title">
    <div className="account-gate-grid" aria-hidden="true" />
    <header className="account-gate-header">
      <div className="brand-lockup"><span className="brand-orbit"><span /></span><span>CampusFix</span><span className="brand-subtitle">IT support, simplified</span></div>
      <p><ShieldCheck size={14} /> Private account access</p>
    </header>
    <section className={`account-choice-wrap ${mode !== "choice" ? "mode-selected" : ""}`}>
      <div className="account-copy motion-enter">
        <p className="section-kicker">YOUR CAMPUSFIX WORKSPACE</p>
        <h1 id="account-gate-title">A quieter way to get <em>unstuck.</em></h1>
        <p>Use your own CampusFix account to return to support from another device, keep your profile current, and access help in one familiar place.</p>
      </div>
      <div className="account-stage" aria-live="polite">
        {mode === "choice" ? <div className="account-choice-card account-pop-in">
          <p className="panel-label">WELCOME BACK OR START HERE</p>
          <h2>How would you like to continue?</h2>
          <div className="account-paths">
            <button type="button" onClick={() => selectMode("login")} className="account-path existing"><span className="account-path-icon"><KeyRound size={19} /></span><span><strong>I’m an existing user</strong><small>Sign in with your username and password.</small></span><ArrowRight size={17} /></button>
            <button type="button" onClick={() => selectMode("register")} className="account-path new"><span className="account-path-icon"><UserRound size={19} /></span><span><strong>I’m new to CampusFix</strong><small>Create a private account in a moment.</small></span><ArrowRight size={17} /></button>
          </div>
        </div> : <form onSubmit={submit} className="account-form-card account-pop-in">
          <button type="button" className="account-back" onClick={() => { setMode("choice"); setError(null); }}><ArrowLeft size={15} /> Back</button>
          <p className="panel-label">{mode === "login" ? "EXISTING USER" : "NEW USER"}</p>
          <h2>{mode === "login" ? "Welcome back." : "Set up your space."}</h2>
          <p className="account-form-intro">{mode === "login" ? "Enter the credentials you created for CampusFix." : "Choose a username and a password with at least 12 characters."}</p>
          <label>Username<input autoFocus autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_.-]*" required placeholder="e.g. alex.chen" /></label>
          <label>Password<input autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={event => setPassword(event.target.value)} minLength={12} maxLength={128} required type="password" placeholder="At least 12 characters" /></label>
          {error && <p className="account-form-error" role="alert">{error}</p>}
          <button className="account-submit" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={16} /> Checking securely</> : <>{mode === "login" ? "Sign in to CampusFix" : "Create secure account"}<ArrowRight size={16} /></>}</button>
          <p className="account-security-note"><ShieldCheck size={13} /> Passwords are salted and hashed; they are never saved as readable text.</p>
        </form>}
      </div>
    </section>
    <footer className="account-gate-footer"><span>CampusFix uses safe first-level guidance. It will never request passwords or recovery codes.</span><span>Need campus IT help? Your support workspace is ready after sign-in.</span></footer>
  </main>;
}
