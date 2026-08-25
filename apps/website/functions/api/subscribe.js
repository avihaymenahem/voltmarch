const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;
const ALLOWED_SOURCES = new Set(['hero', 'footer', 'site']);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
let schemaReady;

const ensureSchema = (database) => {
  schemaReady ||= database.batch([
    database.prepare("CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('hero', 'footer', 'site')))"),
    database.prepare('CREATE INDEX IF NOT EXISTS subscribers_created_at ON subscribers(created_at DESC)'),
  ]).catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
};

export async function onRequestPost({ request, env }) {
  if (!env.WAITLIST) return json({ error: 'Signup storage is not configured yet.' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  if (typeof body.company === 'string' && body.company.trim().length > 0) return json({ ok: true, existing: false });
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const source = ALLOWED_SOURCES.has(body.source) ? body.source : 'site';
  if (email.length < 5 || email.length > 254 || !EMAIL_PATTERN.test(email)) return json({ error: 'Enter a valid email address.' }, 422);
  try {
    await ensureSchema(env.WAITLIST);
    const result = await env.WAITLIST.prepare('INSERT OR IGNORE INTO subscribers (email, created_at, source) VALUES (?1, ?2, ?3)').bind(email, new Date().toISOString(), source).run();
    return json({ ok: true, existing: result.meta.changes === 0 });
  } catch (error) {
    console.error('waitlist insert failed', error);
    return json({ error: 'The channel did not open. Try again shortly.' }, 500);
  }
}

export function onRequest({ request }) { return json({ error: `Method ${request.method} is not allowed.` }, 405); }
