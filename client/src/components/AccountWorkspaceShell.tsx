import { Bot, LayoutGrid, LogOut, Menu, ShieldCheck, UserRound, X } from "lucide-react";
import { ReactNode, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

type AccountUser = { id: number; name: string | null; email: string | null; role: "user" | "admin" };

export default function AccountWorkspaceShell({ user, children }: { user: AccountUser; children: ReactNode }) {
  const [location, navigate] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const logout = trpc.account.logout.useMutation({ onSuccess: () => window.location.assign("/") });
  const items = [{ label: "Dashboard", path: "/", icon: LayoutGrid }, { label: "Profile", path: "/profile", icon: UserRound }];
  const go = (path: string) => { navigate(path); setMobileOpen(false); };
  const displayName = user.name?.trim() || "Campus member";
  const initial = displayName.slice(0, 1).toUpperCase();
  const sidebar = <aside className="account-sidebar">
    <button className="account-sidebar-brand" onClick={() => go("/")}><span className="brand-orbit"><span /></span><span><strong>CampusFix</strong><small>Personal workspace</small></span></button>
    <nav aria-label="Account navigation"><p>WORKSPACE</p>{items.map(item => <button key={item.path} onClick={() => go(item.path)} className={location === item.path ? "active" : ""} aria-current={location === item.path ? "page" : undefined}><item.icon size={17} /><span>{item.label}</span></button>)}</nav>
    <div className="account-sidebar-bottom"><div className="account-sidebar-safety"><ShieldCheck size={15} /><span><strong>Safety stays on</strong><small>Never share passwords or recovery codes in support chat.</small></span></div><div className="account-user"><span className="account-avatar">{initial}</span><span><strong>{displayName}</strong><small>{user.email || "CampusFix account"}</small></span><button aria-label="Sign out" title="Sign out" onClick={() => logout.mutate()}><LogOut size={16} /></button></div></div>
  </aside>;
  return <div className="account-workspace">
    <button className="account-mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open account navigation"><Menu size={20} /></button>
    <div className={`account-mobile-drawer ${mobileOpen ? "is-open" : ""}`}><button aria-label="Close account navigation" onClick={() => setMobileOpen(false)} /><div className="account-mobile-panel">{sidebar}<button className="account-mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={19} /></button></div></div>
    <div className="account-desktop-sidebar">{sidebar}</div>
    <div className="account-workspace-content">{children}</div>
  </div>;
}
