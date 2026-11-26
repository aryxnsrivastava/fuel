// Groq (free tier) chat completions in JSON mode.
// Groq retires models often and rate-limits each model separately (tokens per minute),
// so the app discovers which models the key can use and falls through them in order.
const BASE = 'https://api.groq.com/openai/v1';

// Best first. Anything not offered by Groq right now is skipped automatically.
const PREFERRED = [
  'openai/gpt-oss-120b',
  'moonshotai/kimi-k2-instruct-0905',
  'moonshotai/kimi-k2-instruct',
  'qwen/qwen3-32b',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'openai/gpt-oss-20b',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
];
const SKIP = /whisper|tts|guard|embed|vision|compound|playai|orpheus|allam|gemma|-[1-9]b\b|instant/i;
// unknown newer models are only tried if they come from a capable family
const CAPABLE = /gpt-oss-120b|kimi|qwen|llama-4|deepseek|llama-3\.3/i;

let cache = { at: 0, list: null };

async function availableModels(key) {
  if (cache.list && Date.now() - cache.at < 6 * 3600e3) return cache.list;
  let ids = [];
  try {
    const r = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${key}` } });
    if (r.ok) ids = ((await r.json()).data || []).filter((m) => m.active !== false).map((m) => m.id);
  } catch {}
  let list;
  if (ids.length) {
    const avail = new Set(ids);
    const ranked = PREFERRED.filter((m) => avail.has(m));
    const rest = ids.filter((m) => !ranked.includes(m) && !SKIP.test(m) && CAPABLE.test(m)).sort();
    list = [...ranked, ...rest];
  } else {
    list = [...PREFERRED];
  }
  if (process.env.GROQ_MODEL) list = [process.env.GROQ_MODEL, ...list.filter((m) => m !== process.env.GROQ_MODEL)];
  cache = { at: Date.now(), list };
  if (process.env.DEBUG_AI === '1') console.log('[groq] models:', list.slice(0, 6).join(', '));
  return list;
}

export async function groqJSON(messages, opts = {}) {
  try { return await groqOnce(messages, opts); }
  catch (e) {
    // all models rate-limited: wait out Groq's cooldown once (capped) and retry
    if (e.status === 429 && e.waitS != null && e.waitS <= 25) {
      await new Promise((r) => setTimeout(r, (e.waitS + 1) * 1000));
      return groqOnce(messages, opts);
    }
    throw e;
  }
}

async function groqOnce(messages, { temperature = 0.4, maxTokens = 1500, mock, textReply = false } = {}) {
  if (process.env.MOCK_AI === '1' && mock) return mock(messages);
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    const e = new Error('GROQ_API_KEY missing');
    e.status = 500; e.publicMessage = 'The AI key is not set up yet (GROQ_API_KEY).';
    throw e;
  }
  const models = (await availableModels(key)).slice(0, 5);
  let lastErr, rateLimited = 0, waitS = null;
  for (const model of models) {
    const r = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, response_format: { type: 'json_object' } }),
    });
    if (r.ok) {
      const j = await r.json();
      const text = j.choices?.[0]?.message?.content || '{}';
      if (process.env.DEBUG_AI === '1') console.log('[groq]', model, j.choices?.[0]?.finish_reason, text.slice(0, 600));
      try { return JSON.parse(text); }
      catch { const m = text.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch {} } lastErr = new Error('Bad JSON from model'); continue; }
    }
    const body = await r.text();
    if (process.env.DEBUG_AI === '1') console.log('[groq-fail]', model, r.status, body.slice(0, 1200));
    lastErr = new Error(`Groq ${r.status} (${model}): ${body.slice(0, 200)}`);
    // model answered in plain text instead of JSON (common when it refuses something)
    if (r.status === 400 && body.includes('json_validate_failed')) {
      let gen = '';
      try { gen = JSON.parse(body).error?.failed_generation || ''; } catch {}
      try { if (gen) return JSON.parse(gen); } catch {}
      if (textReply && gen && gen.length < 1200) return { reply: gen.trim(), actions: [] };
    }
    if (r.status === 401) { lastErr.publicMessage = 'The Groq API key was rejected. Check GROQ_API_KEY.'; throw lastErr; }
    if (r.status === 404) cache.at = 0; // model retired: refresh the list next time
    if (r.status === 429) { rateLimited++; const w = body.match(/try again in ([\d.]+)s/); waitS = Math.min(waitS ?? 99, w ? Number(w[1]) : 20); }
    // 400 / 404 / 413 / 429 / 5xx -> try the next model (each has its own rate limit)
  }
  if (rateLimited) { lastErr.status = 429; lastErr.waitS = waitS; lastErr.publicMessage = 'Free AI limit hit for this minute. Try again in ~30s.'; }
  lastErr.publicMessage ||= 'The AI service failed. Try again in a moment.';
  throw lastErr;
}
