"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, signOut } from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { firebaseAuth } from "@/lib/firebase";

function firebaseMessage(error: unknown) {
  if (!(error instanceof FirebaseError)) return "Could not connect to Firebase Authentication.";
  switch (error.code) {
    case "auth/email-already-in-use": return "An account with that email already exists.";
    case "auth/invalid-email": return "Enter a valid email address.";
    case "auth/weak-password": return "Choose a stronger password.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found": return "Incorrect email or password.";
    case "auth/operation-not-allowed": return "Email and password sign-in is not enabled in Firebase yet.";
    case "auth/too-many-requests": return "Too many attempts. Please try again later.";
    default: return "Firebase sign-in failed. Please try again.";
  }
}

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const email = String(form.get("email") || "").trim();
      const password = String(form.get("password") || "");
      const credential = mode === "signup"
        ? await createUserWithEmailAndPassword(firebaseAuth, email, password)
        : await signInWithEmailAndPassword(firebaseAuth, email, password);
      if (mode === "signup") await updateProfile(credential.user, { displayName: String(form.get("name") || "").trim() });
      const idToken = await credential.user.getIdToken(true);
      const response = await fetch("/api/auth/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) { await signOut(firebaseAuth); setError(data.error || "Could not start your session."); return; }
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
      router.refresh();
    } catch (error) { setError(firebaseMessage(error)); }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><div className="tp-fx" aria-hidden="true" /><div className="auth-wrap">
    <Link href="/" className="landing-brand"><span className="brand-mark">M</span><span className="brand-name">Market<em>Mind</em> AI</span></Link>
    <div className="auth-card"><span className="eyebrow">YOUR RESEARCH WORKSPACE</span><h1>{mode === "login" ? "Welcome back" : "Create your account"}</h1><p>{mode === "login" ? "Sign in to continue your market research." : "Start exploring the market with more clarity."}</p>
      <form onSubmit={submit}>{mode === "signup" && <label>Full name<input name="name" type="text" autoComplete="name" required maxLength={80} placeholder="Your name" /></label>}
        <label>Email address<input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" /></label>
        <label>Password<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "signup" ? 8 : undefined} maxLength={128} placeholder={mode === "signup" ? "At least 8 characters" : "Your password"} /></label>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
      </form><div className="auth-switch">{mode === "login" ? "New to MarketMind?" : "Already have an account?"} <Link href={mode === "login" ? "/signup" : "/login"}>{mode === "login" ? "Create an account" : "Sign in"}</Link></div>
    </div><Link href="/" className="auth-back">← Back to home</Link></div></main>;
}
