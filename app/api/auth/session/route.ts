import { NextResponse } from "next/server";
import { createSession, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const token = (input as { idToken?: unknown } | null)?.idToken;
  if (typeof token !== "string" || token.length < 20 || token.length > 10000) return NextResponse.json({ error: "A Firebase sign-in token is required." }, { status: 400 });
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey || !process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) return NextResponse.json({ error: "Authentication is not configured." }, { status: 503 });
  try {
    const result = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: token }), cache: "no-store",
    });
    if (!result.ok) return NextResponse.json({ error: "Your Firebase sign-in could not be verified." }, { status: 401 });
    const payload = await result.json() as { users?: Array<{ localId?: string; email?: string; displayName?: string; disabled?: boolean }> };
    const user = payload.users?.[0];
    if (!user?.localId || !user.email || user.disabled) return NextResponse.json({ error: "This account cannot sign in." }, { status: 401 });
    const name = user.displayName?.trim() || user.email.split("@")[0];
    const response = NextResponse.json({ name, email: user.email });
    response.cookies.set(SESSION_COOKIE, await createSession({ id: user.localId, name, email: user.email }), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 604800 });
    return response;
  } catch (error) {
    console.error("Firebase session verification failed", error);
    return NextResponse.json({ error: "Firebase Authentication is unavailable." }, { status: 503 });
  }
}
