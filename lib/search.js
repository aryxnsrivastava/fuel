// Web search (Tavily free plan: 1,000 credits/month, no card). Only ever called after the
// user taps "Allow" on a search request in the chat.
export async function webSearch(query) {
  if (process.env.MOCK_AI === '1') {
    return [{ title: 'Mock result', url: 'https://example.com', content: `Mock nutrition info for "${query}": 540 kcal, 30 g protein.` }];
  }
  const key = process.env.TAVILY_API_KEY;
  if (!key) {
    const e = new Error('TAVILY_API_KEY missing');
    e.status = 400; e.publicMessage = 'Web search is not set up (TAVILY_API_KEY missing).';
    throw e;
  }
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query: String(query).slice(0, 300), search_depth: 'basic', max_results: 5, include_answer: false }),
  });
  if (!r.ok) {
    const e = new Error(`Tavily ${r.status}: ${(await r.text()).slice(0, 200)}`);
    e.publicMessage = r.status === 432 || r.status === 429 ? 'Free web-search credits are used up for this month.' : 'Web search failed.';
    throw e;
  }
  const j = await r.json();
  const out = (j.results || []).map((x) => ({ title: x.title, url: x.url, content: String(x.content || '').slice(0, 1200) }));
  return out;
}
