import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "./lib/auth";
const publicPaths = new Set(["/", "/login", "/signup"]);
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const id = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (publicPaths.has(path)) {
    if (id && path !== "/") return NextResponse.redirect(new URL("/dashboard", request.url));
    return NextResponse.next();
  }
  if (id) return NextResponse.next();
  const login = new URL("/login", request.url);
  login.searchParams.set("next", path);
  return NextResponse.redirect(login);
}
export const config = { matcher: ["/((?!api|_next|favicon.ico|icon.svg).*)"] };
