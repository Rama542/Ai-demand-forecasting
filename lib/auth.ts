const encoder = new TextEncoder();
export const SESSION_COOKIE = "marketmind_session";

function b64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unb64(value: string) { return atob(value.replace(/-/g, "+").replace(/_/g, "/")); }
async function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters.");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export type Session = { sub: string; name: string; email: string; exp: number };
export async function createSession(user: { id: string; name: string; email: string }) {
  const body = b64(encoder.encode(JSON.stringify({ sub: user.id, name: user.name, email: user.email, exp: Math.floor(Date.now() / 1000) + 604800 })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(), encoder.encode(body)));
  return `${body}.${b64(sig)}`;
}
export async function verifySession(token?: string): Promise<Session | null> {
  if (!token) return null;
  try {
    const [body, sig, extra] = token.split(".");
    if (!body || !sig || extra) return null;
    const valid = await crypto.subtle.verify("HMAC", await key(), Uint8Array.from(unb64(sig), c => c.charCodeAt(0)), encoder.encode(body));
    if (!valid) return null;
    const data = JSON.parse(unb64(body)) as Partial<Session>;
    return typeof data.sub === "string" && data.sub.length > 0 && typeof data.name === "string" && typeof data.email === "string" && typeof data.exp === "number" && data.exp > Date.now() / 1000 ? data as Session : null;
  } catch { return null; }
}
