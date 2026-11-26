import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
export async function GET() {
  const user = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ id: user.sub, name: user.name, email: user.email }, { headers: { "Cache-Control": "no-store" } });
}
