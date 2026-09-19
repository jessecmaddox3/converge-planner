import path from "node:path";

export type RuntimeConfig = {
  mode: "demo" | "production";
  origin: string;
  port: number;
  dataDirectory: string;
  namespace: string;
  operator: string;
  contact: string;
};

/** Missing hosting configuration never selects the account-free local mode. */
export function runtimeConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  const mode = env.CONVERGE_MODE;
  if (mode !== "demo" && mode !== "production") throw new Error("Choose CONVERGE_MODE=demo or production. The Start launcher chooses the local demo.");
  const port = Number(env.PORT || "5075");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("PORT must be an integer from 1024 to 65535.");
  const origin = new URL(env.CONVERGE_ORIGIN || (mode === "demo" ? `http://127.0.0.1:${port}` : ""));
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error("CONVERGE_ORIGIN must contain only an HTTP(S) origin.");
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  if (mode === "demo") {
    if (!local || env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME) throw new Error("The demo must run on your computer at a loopback address.");
    if (Number(origin.port || (origin.protocol === 'https:' ? 443 : 80)) !== port) throw new Error("The demo origin and PORT must agree.");
    return { mode, origin: origin.origin, port, dataDirectory: path.resolve(env.CONVERGE_DATA_DIR || '.local/demo'), namespace: 'converge-demo.invalid', operator: 'Local demo', contact: '' };
  }
  if (!local && origin.protocol !== 'https:') throw new Error("Hosted installations require HTTPS.");
  for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'NEXTAUTH_SECRET', 'ACTOR_KEY_SECRET', 'CONVERGE_NAMESPACE', 'CONVERGE_OPERATOR', 'CONVERGE_CONTACT']) {
    if (!env[name]?.trim()) throw new Error(`Production setup is missing ${name}. See docs/HOSTING.md.`);
  }
  if (env.NEXTAUTH_SECRET!.length < 32 || env.ACTOR_KEY_SECRET!.length < 32) throw new Error("Session and actor secrets must each contain at least 32 characters.");
  if (env.NEXTAUTH_URL !== origin.origin) throw new Error("NEXTAUTH_URL must equal CONVERGE_ORIGIN.");
  const database = new URL(env.SUPABASE_URL!);
  if (database.protocol !== 'https:' || database.username || database.password || database.search || database.hash || database.pathname !== '/') throw new Error("SUPABASE_URL must be an HTTPS service origin.");
  if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i.test(env.CONVERGE_NAMESPACE!)) throw new Error("Choose a stable DNS-style CONVERGE_NAMESPACE for calendar and message identities.");
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(env.CONVERGE_CONTACT!)) throw new Error("CONVERGE_CONTACT must be your installation's contact email.");
  return { mode, origin: origin.origin, port, dataDirectory: '', namespace: env.CONVERGE_NAMESPACE!, operator: env.CONVERGE_OPERATOR!, contact: env.CONVERGE_CONTACT! };
}

export function isDemo(): boolean { return process.env.CONVERGE_MODE === 'demo'; }

export function requireHost(request: Request, config = runtimeConfig()) {
  if (request.headers.get('host') !== new URL(config.origin).host) throw new Error('Open this installation at its configured address.');
}

export function requireSameOrigin(request: Request, config = runtimeConfig()) {
  requireHost(request, config);
  if (request.headers.get('origin') !== config.origin) throw new Error('Changes must come from this installation.');
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw new Error('Cross-site changes are not allowed.');
}
