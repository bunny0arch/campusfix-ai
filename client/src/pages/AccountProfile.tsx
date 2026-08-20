import { ArrowLeft, Check, KeyRound, LoaderCircle, Save, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

type ProfileForm = { name: string; email: string; campusId: string; campusRole: "student" | "faculty" | "it_staff"; department: string; program: string; yearOfStudy: string };
const emptyProfile: ProfileForm = { name: "", email: "", campusId: "", campusRole: "student", department: "", program: "", yearOfStudy: "" };

export default function AccountProfile() {
  const [, navigate] = useLocation();
  const profile = trpc.account.profile.useQuery();
  const utils = trpc.useUtils();
  const update = trpc.account.updateProfile.useMutation({ onSuccess: () => utils.account.profile.invalidate() });
  const changePassword = trpc.account.changePassword.useMutation();
  const [form, setForm] = useState<ProfileForm>(emptyProfile);
  const [saved, setSaved] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordStatus, setPasswordStatus] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (!profile.data) return;
    const { user, profile: details } = profile.data;
    setForm({ name: user?.name ?? "", email: user?.email ?? "", campusId: details?.campusId ?? "", campusRole: details?.campusRole ?? "student", department: details?.department ?? "", program: details?.program ?? "", yearOfStudy: details?.yearOfStudy ?? "" });
  }, [profile.data]);

  const updateField = <Key extends keyof ProfileForm>(key: Key, value: ProfileForm[Key]) => setForm(current => ({ ...current, [key]: value }));
  const saveProfile = async (event: FormEvent) => { event.preventDefault(); setSaved(false); await update.mutateAsync(form); setSaved(true); window.setTimeout(() => setSaved(false), 2400); };
  const savePassword = async (event: FormEvent) => {
    event.preventDefault(); setPasswordError(null); setPasswordStatus(false);
    if (newPassword !== confirmPassword) { setPasswordError("The new passwords do not match."); return; }
    try { await changePassword.mutateAsync({ oldPassword, newPassword }); setOldPassword(""); setNewPassword(""); setConfirmPassword(""); setPasswordStatus(true); } catch (caught) { setPasswordError(caught instanceof Error ? caught.message : "Unable to update your password."); }
  };

  if (profile.isLoading) return <main className="profile-page"><div className="profile-loading"><LoaderCircle className="spin" /> Loading your profile</div></main>;
  return <main className="profile-page"><header className="profile-heading"><button onClick={() => navigate("/")}><ArrowLeft size={16} /> Dashboard</button><p className="section-kicker">ACCOUNT SETTINGS</p><h1>Your CampusFix profile.</h1><p>Keep only the information that helps Campus IT understand your support context. You can update it any time.</p></header><div className="profile-grid">
    <form className="profile-card" onSubmit={saveProfile}><div className="profile-card-head"><span className="profile-icon"><Save size={17} /></span><span><p className="panel-label">BASIC INFORMATION</p><h2>Your support context</h2></span></div><div className="profile-fields"><label>Name<input value={form.name} onChange={event => updateField("name", event.target.value)} maxLength={120} placeholder="Your name" /></label><label>Email<input value={form.email} onChange={event => updateField("email", event.target.value)} type="email" maxLength={320} placeholder="you@university.edu" /></label><label>Campus ID<input value={form.campusId} onChange={event => updateField("campusId", event.target.value)} maxLength={64} placeholder="Optional" /></label><label>Campus role<select value={form.campusRole} onChange={event => updateField("campusRole", event.target.value as ProfileForm["campusRole"])}><option value="student">Student</option><option value="faculty">Faculty</option><option value="it_staff">IT staff</option></select></label><label>Department<input value={form.department} onChange={event => updateField("department", event.target.value)} maxLength={140} placeholder="Optional" /></label><label>Programme / course<input value={form.program} onChange={event => updateField("program", event.target.value)} maxLength={160} placeholder="Optional" /></label><label>Year of study<input value={form.yearOfStudy} onChange={event => updateField("yearOfStudy", event.target.value)} maxLength={32} placeholder="Optional" /></label></div>{update.error && <p className="profile-error">{update.error.message}</p>}<button className="profile-submit" disabled={update.isPending}>{update.isPending ? <><LoaderCircle className="spin" size={16} /> Saving</> : saved ? <><Check size={16} /> Saved</> : <><Save size={16} /> Save profile</>}</button></form>
    <form className="profile-card password-card" onSubmit={savePassword}><div className="profile-card-head"><span className="profile-icon"><KeyRound size={17} /></span><span><p className="panel-label">PASSWORD</p><h2>Change your password</h2></span></div><p className="profile-card-copy">For your protection, confirm the current password before choosing a new one. Updating it signs out any other devices.</p><div className="profile-fields one-column"><label>Current password<input value={oldPassword} onChange={event => setOldPassword(event.target.value)} autoComplete="current-password" minLength={12} maxLength={128} type="password" required /></label><label>New password<input value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} type="password" required placeholder="At least 12 characters" /></label><label>Confirm new password<input value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} type="password" required /></label></div>{passwordError && <p className="profile-error">{passwordError}</p>}{passwordStatus && <p className="profile-success"><Check size={15} /> Password updated. Other devices are signed out.</p>}<button className="profile-submit ember" disabled={changePassword.isPending}>{changePassword.isPending ? <><LoaderCircle className="spin" size={16} /> Updating</> : <><ShieldCheck size={16} /> Update password</>}</button></form>
  </div></main>;
}
