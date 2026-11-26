// Fuel: single-page PWA. Pages: #today, #chat, #recipes, #progress, #plan
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.round(n).toLocaleString();
try { localStorage.removeItem('passcode'); } catch {} // old versions kept the passcode here

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// ---------- API ----------
async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api/' + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-tz': TZ },
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) { showLogin(); throw new Error('locked'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

function showLogin(err) {
  // several requests can come back "locked" at once: never rebuild the form while it's on screen
  if (!err && $('#pc')) return;
  view.className = '';
  $('#title').textContent = 'Fuel';
  $('#topbar-extra').innerHTML = '';
  view.innerHTML = `<div class="login">
    <p class="muted">Enter your passcode to unlock your data.</p>
    <div class="pc-row"><input id="pc" type="password" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Passcode" /><button type="button" class="btn ghost small" id="pcshow">Show</button></div>
    <button class="btn block" id="pcgo">Unlock</button>
    ${err ? `<p class="small" style="color:var(--bad)">${esc(err)}</p>` : ''}</div>`;
  const go = async () => {
    const btn = $('#pcgo'); btn.disabled = true;
    const r = await fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode: $('#pc').value.trim() }) }).catch(() => null);
    if (r && r.ok) route();
    else showLogin(r ? (await r.json().catch(() => ({}))).error || 'Wrong passcode' : 'No connection');
  };
  $('#pcgo').onclick = go;
  $('#pcshow').onclick = () => { const i = $('#pc'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; $('#pcshow').textContent = show ? 'Hide' : 'Show'; i.focus(); };
  $('#pc').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
}

// ---------- shared bits ----------
const icon = {
  trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 11v6M14 11v6M7 7l1 12h8l1-12M9 7V4h6v3"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24"><path d="M7 4h10v16l-5-4-5 4z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
};

function meter(value, max, cls = '') {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return `<div class="meter ${cls} ${value > max * 1.05 && cls !== 'protein' ? 'over' : ''}"><i style="width:${pct}%"></i></div>`;
}

function recipeCard(r, { saveable = false, deletable = false, open = false } = {}) {
  const tags = [
    `<span class="pill accent num">${fmt(r.kcal)} kcal</span>`,
    `<span class="pill num">P ${fmt(r.protein)}g</span>`,
    `<span class="pill num">C ${fmt(r.carbs)}g</span>`,
    `<span class="pill num">F ${fmt(r.fat)}g</span>`,
    r.sugar != null ? `<span class="pill num">Sugar ${fmt(r.sugar)}g</span>` : '',
    r.time_min ? `<span class="pill">${fmt(r.time_min)} min</span>` : '',
    r.uses_pantry ? '<span class="pill">uses your pantry</span>' : '',
    r.servings > 1 ? `<span class="pill">per serving · makes ${r.servings}</span>` : '',
  ].join('');
  const data = esc(JSON.stringify(r));
  return `<details class="recipe" ${open ? 'open' : ''}>
    <summary>
      <div class="row between"><div class="grow">
        ${r.slot ? `<div class="slot">${esc(r.slot)}</div>` : ''}
        <div class="name">${esc(r.name)}</div>
      </div>
      ${saveable ? `<button class="iconbtn" data-save='${data}' aria-label="Save recipe">${icon.bookmark}</button>` : ''}
      ${deletable ? `<button class="iconbtn" data-del-recipe="${r.id}" aria-label="Delete recipe">${icon.trash}</button>` : ''}
      </div>
      <div class="macros">${tags}</div>
    </summary>
    <div class="body">
      ${r.ingredients?.length ? `<h4>Ingredients</h4><ul>${r.ingredients.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
      ${r.steps?.length ? `<h4>Steps</h4><ol>${r.steps.map((i) => `<li>${esc(i)}</li>`).join('')}</ol>` : ''}
    </div>
  </details>`;
}

function wireRecipeButtons(root, after) {
  root.querySelectorAll('[data-save]').forEach((b) => b.onclick = async (e) => {
    e.preventDefault(); e.stopPropagation();
    const r = JSON.parse(b.dataset.save);
    await api('recipes', { method: 'POST', body: { save: r } });
    toast('Saved to your recipes'); after?.();
  });
  root.querySelectorAll('[data-del-recipe]').forEach((b) => b.onclick = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!confirm('Delete this saved recipe?')) return;
    await api('recipes?id=' + b.dataset.delRecipe, { method: 'DELETE' });
    toast('Recipe deleted'); after?.();
  });
}

// ======================= CHAT =======================
let chat = { messages: [], today: null, logOpen: false, busy: false };

async function renderChat() {
  view.className = 'chat-mode';
  view.innerHTML = `
    <div class="today-strip" id="strip"><div class="tiny">Loading…</div></div>
    <div class="messages" id="msgs"></div>
    <form class="composer" id="composer">
      <textarea id="input" rows="1" placeholder="Message" enterkeyhint="send"></textarea>
      <button class="send" id="sendbtn" aria-label="Send">${icon.send}</button>
    </form>`;
  const input = $('#input');
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; };
  input.oninput = grow;
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); sendChat(); } };
  $('#composer').onsubmit = (e) => { e.preventDefault(); sendChat(); };
  drawMessages();
  if (chat.today) drawStrip();
  try {
    const d = await api('chat');
    chat.messages = d.messages; chat.today = d.today;
    drawMessages(); drawStrip();
  } catch (e) { if (e.message !== 'locked') $('#strip').innerHTML = `<div class="tiny">${esc(e.message)}</div>`; }
}

function drawStrip() {
  const t = chat.today, el = $('#strip');
  if (!t || !el) return;
  const basis = { logged: 'uses logged training', planned: 'uses your plan', typical: 'assumes light training until you log it' }[t.exerciseBasis];
  el.innerHTML = `
    <div class="stats">
      <div><div class="stat-label"><span>kcal</span><b class="num">${fmt(t.eaten.kcal)}/${fmt(t.target)}</b></div>${meter(t.eaten.kcal, t.target)}</div>
      <div><div class="stat-label"><span>Protein</span><b class="num">${fmt(t.eaten.protein)}/${fmt(t.protein)}g</b></div>${meter(t.eaten.protein, t.protein, 'protein')}</div>
      <div><div class="stat-label"><span>Fat</span><b class="num">${fmt(t.eaten.fat)}/${fmt(t.fat)}g</b></div>${meter(t.eaten.fat, t.fat, 'fat')}</div>
      <div><div class="stat-label"><span>Sugar</span><b class="num">${fmt(t.eaten.sugar || 0)}/${fmt(t.sugarLimit)}g</b></div>${meter(t.eaten.sugar || 0, t.sugarLimit, 'sweet')}</div>
    </div>
    <button class="toggle" id="logtoggle">${chat.logOpen ? '▾' : '▸'} Today's log (${t.entries.length}) · burned ~${fmt(t.exerciseKcal)} · treats left ${fmt(t.treats.left)}</button>
    ${chat.logOpen ? `<div class="today-log">
      ${t.entries.length ? t.entries.map((e) => `<div class="log-item">
        <span>${e.kind === 'food' ? (e.sweet ? '🍫' : '🍽️') : e.kind === 'workout' ? (e.type === 'swim' ? '🏊' : '🏋️') : '⚖️'}</span>
        <span class="grow">${esc(e.name || e.description || e.type || '')}${e.kind === 'weight' ? `${e.kg} kg` : ''}</span>
        <span class="k num">${e.kind === 'food' ? `${e.kcal} kcal · ${e.protein}g${e.sugar >= 5 ? ` · ${e.sugar}g sug` : ''}` : e.kind === 'workout' ? `−${e.kcal + (e.commute_kcal || 0)} kcal` : ''}</span>
        <button class="iconbtn" data-del="${e.id}" aria-label="Delete entry">${icon.trash}</button>
      </div>`).join('') : '<div class="tiny" style="padding:6px 0">Nothing logged yet today.</div>'}
      <div class="tiny" style="padding-top:6px">Target ${basis}${t.adjustment ? ` · ${t.adjustment > 0 ? '+' : ''}${t.adjustment}: ${esc(t.adjReason || 'rebalance')}` : ''}</div>
    </div>` : ''}`;
  $('#logtoggle').onclick = () => { chat.logOpen = !chat.logOpen; drawStrip(); };
  el.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    chat.today = await api('data?id=' + b.dataset.del, { method: 'DELETE' }); drawStrip(); toast('Entry removed');
  });
}

function messageHTML(m) {
  if (m.role === 'user') return `<div class="msg user"><div class="text">${esc(m.content)}</div></div>`;
  const meta = m.meta || {};
  const changes = (meta.changes || []).filter((c) => c.kind !== 'recipe' || !meta.recipes?.length);
  let html = `<div class="msg assistant ${m.error ? 'error' : ''}"><div class="text">${esc(m.content)}</div>`;
  if (changes.length) html += `<div class="changes">${changes.map((c) => `<div class="change">${esc(c.text)}</div>`).join('')}</div>`;
  for (const r of meta.recipes || []) html += recipeCard(r);
  if (meta.search) {
    const s = meta.search;
    html += `<div class="card" style="margin:10px 0 0;background:var(--bg)">
      <div class="small"><b>Search the web?</b> “${esc(s.query)}”</div>
      ${s.reason ? `<div class="tiny" style="margin-top:2px">${esc(s.reason)}</div>` : ''}
      ${s.status === 'pending'
        ? `<div class="row" style="margin-top:10px"><button class="btn" data-search="${m.id}" data-allow="1">Allow</button><button class="btn secondary" data-search="${m.id}" data-allow="0">No</button></div>`
        : `<div class="tiny" style="margin-top:6px">${s.status === 'approved' ? 'Approved ✓' : 'Declined'}</div>`}
    </div>`;
  }
  if (meta.searched?.length) html += `<div class="tiny" style="margin-top:6px">Sources: ${meta.searched.slice(0, 3).map((s) => esc(new URL(s.url).hostname.replace('www.', ''))).join(', ')}</div>`;
  return html + '</div>';
}

function drawMessages() {
  const el = $('#msgs');
  if (!el) return;
  el.innerHTML = chat.messages.map(messageHTML).join('') + (chat.busy ? '<div class="typing"><span class="spinner"></span> thinking…</div>' : '');
  wireRecipeButtons(el, () => {});
  el.querySelectorAll('[data-search]').forEach((b) => b.onclick = () => decideSearch(Number(b.dataset.search), b.dataset.allow === '1'));
  el.scrollTop = el.scrollHeight;
}

async function decideSearch(messageId, allow) {
  const m = chat.messages.find((x) => x.id === messageId);
  if (m?.meta?.search) m.meta.search.status = allow ? 'approved' : 'declined';
  chat.busy = allow; drawMessages();
  try {
    const d = await api('chat', { method: 'POST', body: { searchDecision: { messageId, allow } } });
    if (d.message) { chat.messages.push(d.message); chat.today = d.today; drawStrip(); }
  } catch (e) {
    if (e.message !== 'locked') chat.messages.push({ role: 'assistant', content: e.message, error: true });
  }
  chat.busy = false; drawMessages();
}

async function sendChat() {
  const input = $('#input');
  const text = input.value.trim();
  if (!text || chat.busy) return;
  input.value = ''; input.style.height = 'auto';
  chat.messages.push({ role: 'user', content: text });
  chat.busy = true; drawMessages();
  $('#sendbtn').disabled = true;
  try {
    const d = await api('chat', { method: 'POST', body: { message: text } });
    chat.messages.push(d.message); chat.today = d.today;
    recipesCache = null; // plan may need refreshing
    drawStrip();
  } catch (e) {
    if (e.message !== 'locked') chat.messages.push({ role: 'assistant', content: `Couldn't process that: ${e.message}`, error: true });
  }
  chat.busy = false; drawMessages();
  const sb = $('#sendbtn'); if (sb) sb.disabled = false;
}

// ======================= TODAY =======================
let todayData = null, todayChat = null; // todayChat: { user, reply } for the latest exchange

async function renderToday() {
  view.className = 'chat-mode';
  view.innerHTML = `
    <div class="messages today-page" id="tscroll"><div class="empty"><span class="spinner"></span></div></div>
    <form class="composer" id="tcomposer">
      <textarea id="tinput" rows="1" placeholder="Message" enterkeyhint="send"></textarea>
      <button class="send" id="tsend" aria-label="Send">${icon.send}</button>
    </form>`;
  const input = $('#tinput');
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; };
  input.oninput = grow;
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); sendToday(); } };
  $('#tcomposer').onsubmit = (e) => { e.preventDefault(); sendToday(); };
  if (todayData) drawToday();
  try { todayData = await api('data?view=day'); if (!todayData.setupDone) return showSetup(); drawToday(); }
  catch (e) { if (e.message !== 'locked') $('#tscroll').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

// First run on a fresh install: a few numbers so the targets mean something from day one.
function showSetup() {
  view.className = '';
  $('#title').textContent = 'Set up Fuel';
  view.innerHTML = `
    <form class="card goals" id="setup">
      <p class="muted" style="margin-top:0">A few numbers so your targets fit you. Change any of it later on the Plan page or just tell the chat.</p>
      <div class="two">
        <div><label>Sex</label><select name="sex"><option value="male">Male</option><option value="female">Female</option></select></div>
        <div><label>Goal</label><select name="mode"><option value="recomp">Recomp</option><option value="cut">Cut</option><option value="bulk">Lean bulk</option></select></div>
      </div>
      <div class="two">
        <div><label>Height cm</label><input name="heightCm" type="number" inputmode="numeric" required placeholder="175" /></div>
        <div><label>Weight kg</label><input name="weightKg" type="number" step="0.1" inputmode="decimal" required placeholder="70" /></div>
      </div>
      <div class="two">
        <div><label>Body fat % (guess high)</label><input name="bodyFatPct" type="number" step="0.5" inputmode="decimal" required placeholder="20" /></div>
        <div><label>Workouts / week</label><input name="sessionsPerWeek" type="number" inputmode="numeric" required value="4" /></div>
      </div>
      <label>About you (the coach reads this)</label><textarea name="about" rows="3" maxlength="500" placeholder="Age, city, gym, schedule, foods you eat, where you shop"></textarea>
      <button class="btn block" style="margin-top:16px">Start</button>
    </form>`;
  $('#setup').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target), v = (k) => f.get(k);
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try {
      await api('data', { method: 'PUT', body: { setup: true, sex: v('sex'), goal: { mode: v('mode') }, heightCm: Number(v('heightCm')), weightKg: Number(v('weightKg')), bodyFatPct: Number(v('bodyFatPct')), sessionsPerWeek: Number(v('sessionsPerWeek')), about: v('about') || '' } });
      todayData = null; route();
    } catch (err) { btn.disabled = false; toast(err.message); }
  };
}

async function sendToday() {
  const input = $('#tinput');
  const text = input.value.trim();
  if (!text || chat.busy) return;
  input.value = ''; input.style.height = 'auto';
  chat.busy = true; todayChat = { user: text, reply: null }; drawToday();
  $('#tsend').disabled = true;
  try {
    const d = await api('chat', { method: 'POST', body: { message: text } });
    chat.messages.push({ role: 'user', content: text }, d.message); chat.today = d.today; // same thread as Chat
    todayChat.reply = d.message; recipesCache = null;
    todayData = await api('data?view=day');
  } catch (e) {
    if (e.message !== 'locked') todayChat.reply = { role: 'assistant', content: `Couldn't process that: ${e.message}`, error: true };
  }
  chat.busy = false; drawToday();
  const sb = $('#tsend'); if (sb) sb.disabled = false;
}

// "13:05" or an ISO timestamp -> "1:05 pm"; sort key in minutes
function entryTime(e) {
  let h, m;
  if (e.at) [h, m] = e.at.split(':').map(Number);
  else if (e.created_at) { const d = new Date(e.created_at); h = d.getHours(); m = d.getMinutes(); }
  else return { label: '', key: 9999 };
  return { label: `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`, key: h * 60 + m };
}

const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + fmt(Math.abs(n));

function drawToday() {
  const el = $('#tscroll'), d = todayData;
  if (!el || !d) return;
  const n = d.now, L = n.left, W = d.why, wk = W.week;
  const bar = (label, eaten, target, cls) => `<div><div class="stat-label"><span>${label}</span><b class="num">${fmt(eaten)}/${fmt(target)}g</b></div>${meter(eaten, target, cls)}</div>`;
  const basisTxt = { logged: 'logged', planned: 'planned', typical: 'assumed light' }[W.basis];
  const row = (k, v, cls = '') => `<div class="kv ${cls}"><span>${k}</span><span class="num">${v}</span></div>`;

  const can = [];
  can.push(L.kcal >= 0 ? `🍽️ <b>${fmt(L.kcal)} kcal</b> · <b>${fmt(Math.max(0, L.protein))} g</b> protein to go` : `🛑 Over by <b>${fmt(-L.kcal)} kcal</b>. Kitchen's closed.`);
  if (d.can.nextMeal) can.push(`➡️ <a href="#recipes">${esc(d.can.nextMeal.name)}</a> · ${fmt(d.can.nextMeal.kcal)} kcal`);
  can.push(d.can.unlockKcal > 0 ? `🏋️ Train + log it: <b>+${fmt(d.can.unlockKcal)} kcal</b>` : '🏋️ Training logged ✓');
  can.push(L.sugar >= 10 && d.can.treatsLeft >= 150 ? `🍫 Sweet room: ≤${fmt(L.sugar)} g sugar` : '🍫 No sweets today');

  const past = W.past.length ? `<div class="chips past">${W.past.map((p) => `<span class="chip ${p.diff > 150 ? 'bad' : p.diff < -400 ? 'warnc' : 'ok'}">${p.weekday.slice(0, 3)} ${signed(p.diff)}${p.trained ? ' 🏋️' : ''}</span>`).join('')}</div>` : '<div class="tiny">No logs in the last 3 days.</div>';

  el.innerHTML = `
    ${todayChat ? `<div class="today-exchange">
      <div class="msg user"><div class="text">${esc(todayChat.user)}</div></div>
      ${todayChat.reply ? messageHTML(todayChat.reply) : '<div class="typing"><span class="spinner"></span> thinking…</div>'}
    </div>` : ''}
    <div class="card hero">
      <div class="hero-top"><div><div class="big num">${fmt(L.kcal)}</div><div class="l">kcal left of ${fmt(n.target)}</div></div>
      <div class="burn"><div class="num">${fmt(n.burned || n.exerciseUsed)}</div><div class="l">${n.burned ? 'burned (logged)' : 'training assumed'}</div></div></div>
      <div class="stats">${bar('Protein', n.eaten.protein, n.targets.protein, 'protein')}${bar('Carbs', n.eaten.carbs, n.targets.carbs, '')}${bar('Fat', n.eaten.fat, n.targets.fat, 'fat')}${bar('Sugar', n.eaten.sugar, n.targets.sugar, 'sweet')}</div>
    </div>
    <div class="card"><h2>Had today</h2>
      ${d.log.length ? d.log.map((e) => ({ e, t: entryTime(e) })).sort((a, b) => a.t.key - b.t.key).map(({ e, t }) => `<div class="log-item">
        <span class="t num">${t.label}</span>
        <span class="grow">${esc(e.name || e.description || e.type || '')}${e.kind === 'weight' ? `${e.kg} kg` : ''}</span>
        <span class="k num">${e.kind === 'food' ? `${e.kcal} · ${e.protein}g${e.sugar >= 5 ? ` · ${e.sugar}g sug` : ''}` : e.kind === 'workout' ? `−${e.kcal + (e.commute_kcal || 0)}` : ''}</span>
        <button class="iconbtn" data-tdel="${e.id}" aria-label="Delete entry">${icon.trash}</button>
      </div>`).join('') : '<div class="tiny">Nothing yet.</div>'}
    </div>
    <div class="card"><h2>Today you can</h2>${can.map((c) => `<div class="can-line">${c}</div>`).join('')}</div>
    <div class="card"><h2>Why ${fmt(n.target)} kcal</h2>
      ${row('Body + daily life', fmt(W.base))}
      ${row(`Training (${basisTxt})`, signed(W.training))}
      ${row('Goal', W.goal === 0 ? '±0 (maintenance)' : signed(W.goal))}
      ${W.payback ? row(`Payback: ${esc(W.reason || '')}`, signed(W.payback)) : ''}
      ${W.floored ? row('Raised to safety floor', '✓') : ''}
      ${row('Today', fmt(n.target), 'total')}
      <div class="sub-h">Last 3 days vs target</div>${past}
      <div class="sub-h">This week (${wk.daysLeft} day${wk.daysLeft === 1 ? '' : 's'} left)</div>
      ${row('Sugar today', `≤${fmt(wk.sugarToday)} g (${wk.sugarSpare >= 0 ? `${fmt(wk.sugarSpare)} g spare` : `${fmt(-wk.sugarSpare)} g over`})`)}
      ${row('Fat today', `${fmt(wk.fatToday)} g (${wk.fatToday < wk.fatBase - 2 ? 'trimmed' : wk.fatToday > wk.fatBase + 2 ? 'extra' : 'normal'})`)}
    </div>
    <div class="card"><h2>Next days</h2>
      ${d.next.map((x) => row(`${x.weekday.slice(0, 3)}${x.planned ? ` · ${x.planned.length ? x.planned.map((a) => a.type).join(' + ') : 'rest'}` : ''}`, `${fmt(x.target)} kcal · ${fmt(x.protein)}g P`)).join('')}
      ${L.kcal < 0 && d.next[0] ? `<div class="can-line warn-line">Over by ${fmt(-L.kcal)} today → ${d.next[0].weekday.slice(0, 3)} ≈ ${fmt(d.next[0].target - Math.min(300, Math.round(-L.kcal / 3)))} kcal</div>` : ''}
      <div class="tiny" style="margin-top:6px">If you land today on target. Unplanned days assume light training.</div>
    </div>`;
  el.querySelectorAll('[data-tdel]').forEach((b) => b.onclick = async () => {
    await api('data?id=' + b.dataset.tdel, { method: 'DELETE' }); chat.today = null;
    todayData = await api('data?view=day'); drawToday(); toast('Entry removed');
  });
  el.querySelectorAll('[data-search]').forEach((b) => b.onclick = async () => { await decideSearch(Number(b.dataset.search), b.dataset.allow === '1'); todayChat = null; renderToday(); });
  if (todayChat) el.scrollTop = 0;
}

// ======================= RECIPES =======================
let recipesCache = null;
let regenTried = '';

async function renderRecipes() {
  view.className = '';
  $('#topbar-extra').innerHTML = `<button class="iconbtn" id="regen" aria-label="Regenerate plan">${icon.refresh}</button>`;
  if (!recipesCache) view.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
  else drawRecipes(recipesCache);
  try {
    const d = await api('recipes');
    recipesCache = d; drawRecipes(d);
    const sig = JSON.stringify(d.context?.today?.remaining) + d.generatedAt;
    if (d.stale && regenTried !== sig) { regenTried = sig; regenerate(); }
  } catch (e) { if (e.message !== 'locked') view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  $('#regen').onclick = () => regenerate();
}

async function regenerate(request) {
  const box = $('#planbox');
  if (box) box.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
  try {
    const d = await api('recipes', { method: 'POST', body: request !== undefined ? { request } : {} });
    recipesCache = { ...recipesCache, ...d };
    if (location.hash === '#recipes') drawRecipes(recipesCache);
  } catch (e) {
    if (box) box.innerHTML = `<div class="empty">${esc(e.message)}<br><button class="btn secondary" style="margin-top:10px" onclick="location.reload()">Retry</button></div>`;
  }
}

function chipList(key, items) {
  return `<div class="chips">${items.map((x, i) => `<span class="chip">${esc(x)}<span class="x" data-rm="${key}" data-i="${i}" role="button" aria-label="Remove">×</span></span>`).join('') }</div>
    <div class="add-row"><input data-add="${key}" placeholder="Add" enterkeyhint="done" /><button class="btn secondary" data-addbtn="${key}">Add</button></div>`;
}

function drawRecipes(d) {
  const c = d.context, p = d.plan;
  if (!c) return;
  const rem = c.today.remaining;
  view.innerHTML = `
    <div class="card">
      <h2>Today</h2>
      <div class="targets">
        <div class="target-box"><div class="v num">${fmt(Math.max(0, rem.kcal))}</div><div class="l">kcal left</div></div>
        <div class="target-box"><div class="v num">${fmt(Math.max(0, rem.protein))}g</div><div class="l">protein left</div></div>
        <div class="target-box"><div class="v num">${fmt(d.treats.left)}</div><div class="l">treat kcal / wk</div></div>
      </div>
      <div class="tiny" style="margin-top:10px">Tomorrow: ${fmt(c.tomorrow.target.kcal)} kcal · ${fmt(c.tomorrow.target.protein)}g</div>
    </div>
    <div id="planbox">
      ${p ? `
        ${p.headline ? `<div class="headline">${esc(p.headline)}</div>` : ''}
        ${p.why ? `<p class="small muted" style="margin:2px 0 12px">${esc(p.why)}</p>` : ''}
        ${p.request ? `<div class="row small" style="margin-bottom:10px"><span class="pill accent">Your request: ${esc(p.request)}</span><button class="btn ghost small" id="clearreq">Clear</button></div>` : ''}
        ${p.today.length ? `<div class="section-title">Rest of today</div>${p.today.map((r) => recipeCard(r, { saveable: true })).join('')}` : '<div class="card small muted">Done eating for today.</div>'}
        ${p.treat ? `<div class="section-title">This week's treat</div>${recipeCard(p.treat, { saveable: true })}` : ''}
        ${p.tomorrow.length ? `<div class="section-title">Tomorrow</div>${p.tomorrow.map((r) => recipeCard(r, { saveable: true })).join('')}` : ''}
      ` : `<div class="empty">${d.needsFood ? 'Log food first.' : 'No plan yet.'}</div>`}
    </div>
    ${p ? `<div class="add-row" style="margin:4px 0 6px"><input id="req" placeholder="Change the plan" /><button class="btn" id="reqgo">Go</button></div>` : ''}
    ${d.saved?.length ? `<div class="section-title">Saved recipes (${d.saved.length})</div>${d.saved.map((r) => recipeCard(r, { deletable: true })).join('')}` : ''}
    <div class="section-title">Your kitchen</div>
    <div class="card"><h2>Pantry</h2>${chipList('pantry', c.pantry)}</div>
    <div class="card"><h2>Loves</h2>${chipList('likes', c.likes)}</div>
    <div class="card"><h2>Hates</h2>${chipList('dislikes', c.dislikes)}</div>`;

  wireRecipeButtons(view, () => { recipesCache = null; renderRecipes(); });
  const go = () => { const v = $('#req').value.trim(); if (v) regenerate(v); };
  if ($('#req')) { $('#reqgo').onclick = go; $('#req').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } }; }
  const cr = $('#clearreq'); if (cr) cr.onclick = () => regenerate('');
  const lists = { pantry: [...c.pantry], likes: [...c.likes], dislikes: [...c.dislikes] };
  const saveList = async (key) => {
    await api('data', { method: 'PUT', body: { [key]: lists[key] } });
    recipesCache = null; renderRecipes();
  };
  view.querySelectorAll('[data-rm]').forEach((x) => x.onclick = () => { lists[x.dataset.rm].splice(Number(x.dataset.i), 1); saveList(x.dataset.rm); });
  view.querySelectorAll('[data-addbtn]').forEach((b) => {
    const key = b.dataset.addbtn, inp = view.querySelector(`[data-add="${key}"]`);
    const add = () => { const v = inp.value.split(',').map((s) => s.trim()).filter(Boolean); if (!v.length) return; lists[key].push(...v); saveList(key); };
    b.onclick = add; inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  });
}

// ======================= PROGRESS =======================
let charts = [];
let weekOffset = 0; // 0 = this week, up to 3 weeks back
const WEEK_LABELS = ['This week', 'Last week', '2 weeks ago', '3 weeks ago'];
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const shortDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });

async function renderProgress() {
  view.className = '';
  $('#topbar-extra').innerHTML = `<div class="weeknav"><button class="iconbtn" id="wkprev" aria-label="Previous week" ${weekOffset >= 3 ? 'disabled' : ''}>‹</button><span>${WEEK_LABELS[weekOffset]}</span><button class="iconbtn" id="wknext" aria-label="Next week" ${weekOffset <= 0 ? 'disabled' : ''}>›</button></div>`;
  $('#wkprev').onclick = () => { if (weekOffset < 3) { weekOffset++; renderProgress(); } };
  $('#wknext').onclick = () => { if (weekOffset > 0) { weekOffset--; renderProgress(); } };
  view.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
  let d;
  try { d = await api('data?view=progress'); } catch (e) { if (e.message !== 'locked') view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

  // the selected Mon–Sun week, every day shown (future / unlogged days stay empty)
  const byDay = new Map(d.days.map((x) => [x.day, x]));
  const t0 = new Date(d.today + 'T12:00:00Z');
  const monday = new Date(t0.getTime() - (((t0.getUTCDay() + 6) % 7) + 7 * weekOffset) * 864e5);
  const days = [...Array(7)].map((_, i) => {
    const day = new Date(monday.getTime() + i * 864e5).toISOString().slice(0, 10);
    return byDay.get(day) || { day, kcal: 0, protein: 0, fat: 0, sugar: 0, target: null, fatTarget: null, exerciseKcal: 0, sessions: [], logged: false };
  });
  const logged = days.filter((x) => x.logged);
  const last7 = d.days.slice(-8, -1).filter((x) => x.logged);
  const avg7 = last7.length ? last7.reduce((s, x) => s + x.kcal, 0) / last7.length : null;
  const avgT7 = last7.length ? last7.reduce((s, x) => s + x.target, 0) / last7.length : null;
  const thisWeek = d.weeks.at(-1) || { gym: 0, swim: 0, other: 0 };
  const dw = d.est.weightKg - d.startWeightKg;

  view.innerHTML = `
    <div class="card report"><h2>Daily report</h2>${(d.report || []).map((l) => `<div class="report-line">${esc(l)}</div>`).join('')}</div>
    <div class="card report"><h2>Weekly brief</h2>${(d.weekly || []).map((l) => `<div class="report-line">${esc(l)}</div>`).join('')}</div>
    <div class="tiles">
      <div class="tile"><div class="l">Weight (5-pt avg)</div><div class="v num">${d.est.weightKg} kg</div><div class="d">${dw === 0 ? 'starting point' : `${dw > 0 ? '+' : ''}${dw.toFixed(1)} kg since start`}</div></div>
      <div class="tile"><div class="l">Est. body fat</div><div class="v num">${d.est.bodyFatPct}%</div><div class="d">lean mass ~${d.est.lbm} kg</div></div>
      <div class="tile"><div class="l">Avg intake, last 7d</div><div class="v num">${avg7 ? fmt(avg7) : '—'}</div><div class="d">${avgT7 ? `target ${fmt(avgT7)}` : 'log meals to see this'}</div></div>
      <div class="tile"><div class="l">Sessions this week</div><div class="v num">${thisWeek.gym + thisWeek.swim + thisWeek.other}</div><div class="d">${thisWeek.gym} gym · ${thisWeek.swim} swim</div></div>
    </div>
    <div class="card"><h2>Weight trend</h2>
      <div class="legend"><span><i style="background:var(--s1)"></i>Weigh-ins</span><span><i class="line" style="background:var(--s1)"></i>7-day average</span><span><i class="dash" style="border-color:var(--text-3)"></i>Projected if on track</span></div>
      <div class="chart-wrap"><canvas id="cw"></canvas></div>
      
    </div>
    <div class="card"><h2>Calories vs target</h2>
      <div class="legend"><span><i style="background:var(--s1)"></i>Eaten</span><span><i class="dash" style="border-color:var(--text-2)"></i>Target</span></div>
      <div class="chart-wrap"><canvas id="ck"></canvas></div>
    </div>
    <div class="card"><h2>Protein (g)</h2>
      <div class="legend"><span><i style="background:var(--s3)"></i>Eaten</span><span><i class="dash" style="border-color:var(--text-2)"></i>Target ${d.proteinTarget} g</span></div>
      <div class="chart-wrap"><canvas id="cp"></canvas></div>
    </div>
    <div class="card"><h2>Fat (g)</h2>
      <div class="legend"><span><i style="background:var(--s1)"></i>Eaten</span><span><i class="dash" style="border-color:var(--text-2)"></i>Target</span></div>
      <div class="chart-wrap"><canvas id="cf"></canvas></div>
    </div>
    <div class="card"><h2>Added sugar (g)</h2>
      <div class="legend"><span><i style="background:var(--s2)"></i>Eaten</span><span><i class="dash" style="border-color:var(--text-2)"></i>Cap ${d.sugarLimit} g</span></div>
      <div class="chart-wrap"><canvas id="cs"></canvas></div>
    </div>
    <div class="card"><h2>Training per week</h2>
      <div class="legend"><span><i style="background:var(--s1)"></i>Gym</span><span><i style="background:var(--s2)"></i>Swim</span><span><i style="background:var(--s3)"></i>Other</span></div>
      <div class="chart-wrap"><canvas id="ct"></canvas></div>
    </div>`;
  drawCharts(d, days);
}

function drawCharts(d, days) {
  charts.forEach((c) => c.destroy()); charts = [];
  if (!window.Chart) { view.insertAdjacentHTML('beforeend', '<div class="tiny">Charts need an internet connection to load.</div>'); return; }
  const C = window.Chart;
  const text2 = css('--text-2'), text3 = css('--text-3'), grid = css('--grid'), s1 = css('--s1'), s2 = css('--s2'), s3 = css('--s3'), surface = css('--surface');
  C.defaults.font.family = '-apple-system, BlinkMacSystemFont, sans-serif';
  C.defaults.font.size = 11;
  C.defaults.color = text3;
  const base = {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: false }, tooltip: { backgroundColor: css('--text'), titleColor: css('--bg'), bodyColor: css('--bg'), padding: 8, cornerRadius: 8, displayColors: false } },
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6 }, border: { color: grid } },
      y: { grid: { color: grid }, border: { display: false }, ticks: { maxTicksLimit: 5 } },
    },
  };
  const labels = days.map((x) => new Date(x.day + 'T12:00:00Z').toLocaleDateString('en-CA', { weekday: 'short', timeZone: 'UTC' }));

  // weight: linear x axis in days from first point, so weigh-ins and projection share one scale
  const monthAgo = new Date(Date.parse(d.today) - 28 * 864e5).toISOString().slice(0, 10);
  const w = d.weights.filter((x) => x.day >= monthAgo); // last 4 weeks
  const origin = w.length ? w[0].day : d.projection[0].day;
  const dx = (day) => Math.round((Date.parse(day) - Date.parse(origin)) / 864e5);
  const pts = w.map((x) => ({ x: dx(x.day), y: x.kg, day: x.day }));
  const avg = pts.map((p) => {
    const win = pts.filter((q) => q.x <= p.x && q.x > p.x - 7);
    return { x: p.x, y: +(win.reduce((s, q) => s + q.y, 0) / win.length).toFixed(2), day: p.day };
  });
  const proj = d.projection.slice(0, 5).map((p) => ({ x: dx(p.day), y: p.weightKg, day: p.day, bf: p.bodyFatPct }));
  charts.push(new C($('#cw'), {
    type: 'scatter',
    data: { datasets: [
      { label: 'Weigh-in', data: pts, backgroundColor: s1, borderColor: surface, borderWidth: 2, pointRadius: 4.5, pointHoverRadius: 6 },
      { label: '7-day avg', data: avg, type: 'line', borderColor: s1, borderWidth: 2, pointRadius: 0, tension: 0.3 },
      { label: 'Projected', data: proj, type: 'line', borderColor: text3, borderDash: [5, 4], borderWidth: 2, pointRadius: 0 },
    ] },
    options: { ...base, interaction: { mode: 'nearest', intersect: false },
      plugins: { ...base.plugins, tooltip: { ...base.plugins.tooltip, callbacks: {
        title: (it) => shortDate(it[0].raw.day),
        label: (it) => `${it.dataset.label}: ${it.raw.y} kg${it.raw.bf ? ` · ~${it.raw.bf}% BF` : ''}`,
      } } },
      scales: { ...base.scales, x: { ...base.scales.x, type: 'linear', ticks: { ...base.scales.x.ticks, callback: (v) => { const dd = new Date(Date.parse(origin) + v * 864e5); return dd.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }); } } } } },
  }));

  const weekScales = { ...base.scales, x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, autoSkip: false, maxTicksLimit: 7 } } };
  const barStyle = (color) => ({ backgroundColor: color, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 18, categoryPercentage: 0.8, barPercentage: 0.9 });
  const targetLine = (data, label) => ({ type: 'line', label, data, borderColor: text2, borderDash: [5, 4], borderWidth: 2, pointRadius: 0, stepped: 'middle' });
  charts.push(new C($('#ck'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Eaten', data: days.map((x) => (x.logged ? x.kcal : null)), ...barStyle(s1) },
      targetLine(days.map((x) => x.target), 'Target'),
    ] },
    options: { ...base, scales: weekScales, plugins: { ...base.plugins, tooltip: { ...base.plugins.tooltip, callbacks: { label: (it) => `${it.dataset.label}: ${it.raw == null ? 'not logged' : fmt(it.raw) + ' kcal'}` } } } },
  }));
  charts.push(new C($('#cp'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Protein', data: days.map((x) => (x.logged ? x.protein : null)), ...barStyle(s3) },
      targetLine(days.map(() => d.proteinTarget), 'Target'),
    ] },
    options: { ...base, scales: weekScales, plugins: { ...base.plugins, tooltip: { ...base.plugins.tooltip, callbacks: { label: (it) => `${it.dataset.label}: ${it.raw == null ? 'not logged' : it.raw + ' g'}` } } } },
  }));
  charts.push(new C($('#cf'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Fat', data: days.map((x) => (x.logged ? x.fat : null)), ...barStyle(s1) },
      targetLine(days.map((x) => x.fatTarget), 'Target'),
    ] },
    options: { ...base, scales: weekScales, plugins: { ...base.plugins, tooltip: { ...base.plugins.tooltip, callbacks: { label: (it) => `${it.dataset.label}: ${it.raw == null ? 'not logged' : it.raw + ' g'}` } } } },
  }));
  charts.push(new C($('#cs'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Sugar', data: days.map((x) => (x.logged ? x.sugar || 0 : null)), ...barStyle(s2) },
      targetLine(days.map(() => d.sugarLimit), 'Cap'),
    ] },
    options: { ...base, scales: weekScales, plugins: { ...base.plugins, tooltip: { ...base.plugins.tooltip, callbacks: { label: (it) => `${it.dataset.label}: ${it.raw == null ? 'not logged' : it.raw + ' g'}` } } } },
  }));
  const weeks = d.weeks.slice(-4);
  const stack = (label, key, color) => ({ label, data: weeks.map((x) => x[key]), backgroundColor: color, borderColor: surface, borderWidth: { top: 2 }, borderSkipped: 'bottom', borderRadius: 4, maxBarThickness: 28, stack: 's' });
  charts.push(new C($('#ct'), {
    type: 'bar',
    data: { labels: weeks.map((x) => 'wk ' + shortDate(x.week)), datasets: [stack('Gym', 'gym', s1), stack('Swim', 'swim', s2), stack('Other', 'other', s3)] },
    options: { ...base, scales: { ...base.scales, x: { ...base.scales.x, stacked: true }, y: { ...base.scales.y, stacked: true, ticks: { stepSize: 1 } } } },
  }));
}

// ======================= PLAN =======================
async function renderPlan() {
  view.className = '';
  view.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
  let d;
  try { d = await api('data?view=plan'); } catch (e) { if (e.message !== 'locked') view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  drawPlan(d);
}

function drawPlan(d) {
  const p = d.profile, n = d.numbers, pr = d.projection, est = d.est;
  const actionable = d.suggestions.filter((s) => s.level !== 'good');
  const onTrack = actionable.length === 0;
  const modeName = { cut: 'Lean cut', recomp: 'Recomp', bulk: 'Lean bulk' }[p.goal.mode];
  const dateStr = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  const sign = (v) => (v > 0 ? '+' : '') + v;
  const radio = (name, val, label, cur) => `<label><input type="radio" name="${name}" value="${val}" ${cur === val ? 'checked' : ''}/><span>${label}</span></label>`;

  view.innerHTML = `
    <div class="card">
      <div class="status ${onTrack ? 'good' : 'warn'}">
        <div class="dot">${onTrack ? '✓' : actionable.length}</div>
        <div><h3>${onTrack ? "On track" : `${actionable.length} thing${actionable.length > 1 ? 's' : ''} to tighten up`}</h3>
        <div class="small muted">${onTrack ? 'Don\'t get comfortable.' : 'Last 7 days'}</div></div>
      </div>
      ${d.suggestions.map((s) => `<div class="sugg ${s.level}"><b><span class="tag">${s.level === 'warn' ? 'Fix' : s.level === 'good' ? 'Nice' : 'Tip'}</span>${esc(s.title)}</b><span class="small muted">${esc(s.body)}</span></div>`).join('')}
    </div>

    <div class="card">
      <h2>If you stay on track · ${esc(modeName)}, ${esc(p.goal.pace)}</h2>
      <div class="targets" style="margin-bottom:12px">
        <div class="target-box"><div class="v num">${sign(pr.weeklyWeightKg)}</div><div class="l">kg / week (${sign(pr.weeklyPctBW)}%)</div></div>
        <div class="target-box"><div class="v num">${pr.etaDay ? `${pr.etaWeek} wk` : '—'}</div><div class="l">${p.goal.mode === 'bulk' ? 'to target weight' : `to ~${p.goal.targetBodyFatPct}% BF${p.goal.mode === 'recomp' ? ' (abs)' : ''}`}</div></div>
        <div class="target-box"><div class="v num">${pr.end.weightKg}</div><div class="l">kg at ${pr.etaDay ? dateStr(pr.etaDay).replace(/, \d{4}/, '') : 'end'}</div></div>
      </div>
      <table class="mile"><thead><tr><th>Week</th><th>Date</th><th>Weight</th><th>Body fat</th></tr></thead><tbody>
        <tr><td>Now</td><td>today</td><td class="num">${est.weightKg} kg</td><td class="num">${est.bodyFatPct}%</td></tr>
        ${pr.milestones.map((m) => `<tr><td>${m.week}</td><td>${dateStr(m.day).replace(/, \d{4}/, '')}</td><td class="num">${m.weightKg} kg</td><td class="num">${m.bodyFatPct}%</td></tr>`).join('')}
      </tbody></table>
      <p class="tiny" style="margin:10px 0 0">If you hit your targets.${p.goal.mode === 'cut' ? ' Then lean bulk 6–9 months for the frame.' : p.goal.mode === 'recomp' ? ' Then it switches to lean bulk automatically.' : ''}</p>
    </div>

    <div class="card">
      <h2>Your numbers</h2>
      <div class="kv"><span>Estimated maintenance</span><span class="num">${fmt(n.maintenance)} kcal</span></div>
      <div class="kv"><span>${n.effectiveOffset === 0 ? 'Daily balance' : n.effectiveOffset < 0 ? 'Daily deficit' : 'Daily surplus'}</span><span class="num">${fmt(Math.abs(n.effectiveOffset))} kcal${n.effectiveOffset !== n.offset ? ' (capped for safety)' : ''}</span></div>
      <div class="kv"><span>Average daily target</span><span class="num">${fmt(n.avgTarget)} kcal</span></div>
      <div class="kv"><span>Protein</span><span class="num">${n.protein} g (${n.proteinPerKgFFM} g/kg lean)</span></div>
      <div class="kv"><span>Training burn (low-balled)</span><span class="num">${fmt(n.typicalExercise)} kcal/day</span></div>
      <div class="kv"><span>Sessions / week</span><span class="num">${n.avgSessions}</span></div>
      <div class="kv"><span>Self-calibration</span><span class="num">${n.calibration ? `${sign(n.calibration.adjust)} kcal` : 'after 2 wks of data'}</span></div>
    </div>

    <details class="card fold" id="goalsfold">
      <summary><h2 style="margin:0">Goals & settings</h2></summary>
      <form class="goals" id="goals">
        <label>Phase</label>
        <div class="segpick">${radio('mode', 'cut', 'Cut', p.goal.mode)}${radio('mode', 'recomp', 'Recomp', p.goal.mode)}${radio('mode', 'bulk', 'Lean bulk', p.goal.mode)}</div>
        <label>Pace</label>
        <div class="segpick">${radio('pace', 'steady', 'Steady', p.goal.pace)}${radio('pace', 'moderate', 'Moderate', p.goal.pace)}${radio('pace', 'aggressive', 'Aggressive', p.goal.pace)}</div>
        <div class="two">
          <div><label>Target body fat %</label><input name="targetBodyFatPct" type="number" step="0.5" inputmode="decimal" value="${p.goal.targetBodyFatPct}" /></div>
          <div><label>Target weight (bulk) kg</label><input name="targetWeightKg" type="number" step="0.5" inputmode="decimal" value="${p.goal.targetWeightKg ?? ''}" placeholder="optional" /></div>
        </div>
        <div class="two">
          <div><label>Body fat now % (re-anchor)</label><input name="bodyFatPct" type="number" step="0.5" inputmode="decimal" value="${p.bodyFatPct}" /></div>
          <div><label>…at weight kg</label><input name="currentWeightKg" type="number" step="0.1" inputmode="decimal" value="${est.weightKg}" /></div>
        </div>
        <div class="two">
          <div><label>Sugar cap g/day (max ${d.sugarMax || 36})</label><input name="sugarLimitG" type="number" step="1" min="15" max="${d.sugarMax || 36}" inputmode="numeric" value="${p.sugarLimitG ?? d.sugarMax ?? 36}" /></div>
        </div>
        <div class="two">
          <div><label>Weekly treat budget kcal</label><input name="weeklyTreatKcal" type="number" step="50" inputmode="numeric" value="${p.weeklyTreatKcal}" /></div>
          <div><label>Walk to gym km (one way)</label><input name="commuteKmOneWay" type="number" step="0.1" inputmode="decimal" value="${p.commuteKmOneWay}" /></div>
        </div>
        <div class="two">
          <div><label>Protein g/kg lean mass</label><input name="proteinPerKgFFM" type="number" step="0.1" inputmode="decimal" value="${p.proteinPerKgFFM ?? ''}" placeholder="auto (${n.proteinPerKgFFM})" /></div>
          <div><label>Height cm</label><input name="heightCm" type="number" inputmode="numeric" value="${p.heightCm}" /></div>
        </div>
        <div class="two">
          <div><label>Sex (sets sugar cap)</label><select name="sex"><option value="male" ${p.sex !== 'female' ? 'selected' : ''}>Male</option><option value="female" ${p.sex === 'female' ? 'selected' : ''}>Female</option></select></div>
          <div><label>Workouts / week</label><input name="sessionsPerWeek" type="number" inputmode="numeric" value="${p.sessionsPerWeek ?? 4}" /></div>
        </div>
        <label>Training split</label><input name="split" value="${esc(p.split)}" />
        <label>About you (the coach reads this)</label><textarea name="about" rows="3" maxlength="500" placeholder="Age, city, gym, schedule, where you shop">${esc(p.about || '')}</textarea>
        <button class="btn block" style="margin-top:16px">Save</button>
      </form>
    </details>

    <details class="card fold">
      <summary><h2 style="margin:0">Sources</h2></summary>
      <div style="margin-top:8px">${d.sources.map((s) => `<div class="source"><b>${esc(s.what)}</b><div>${esc(s.cite)}</div></div>`).join('')}</div>
      <p class="tiny">Estimates, not medical advice.</p>
    </details>
    ${d.passcodeOn ? '' : '<p class="tiny" style="text-align:center;color:var(--warn,#f0b44c)">No passcode set: anyone with this link can see your data. Add APP_PASSCODE in Vercel.</p>'}
    <p class="tiny" style="text-align:center">Or just tell the chat.${d.passcodeOn ? ' · <a href="#" id="lock" style="color:inherit">Lock app</a>' : ''}</p>`;

  $('#goals').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const v = (k) => f.get(k);
    const body = {
      goal: { mode: v('mode'), pace: v('pace'), targetBodyFatPct: Number(v('targetBodyFatPct')), targetWeightKg: v('targetWeightKg') ? Number(v('targetWeightKg')) : null },
      bodyFatPct: Number(v('bodyFatPct')), currentWeightKg: Number(v('currentWeightKg')),
      weeklyTreatKcal: Number(v('weeklyTreatKcal')), sugarLimitG: Number(v('sugarLimitG')), commuteKmOneWay: Number(v('commuteKmOneWay')),
      proteinPerKgFFM: v('proteinPerKgFFM') ? Number(v('proteinPerKgFFM')) : null,
      heightCm: Number(v('heightCm')), split: v('split'), about: v('about') || '', sex: v('sex'), sessionsPerWeek: Number(v('sessionsPerWeek')),
    };
    const nd = await api('data', { method: 'PUT', body });
    recipesCache = null; toast('Goals updated'); drawPlan(nd);
  };
  const lock = $('#lock'); if (lock) lock.onclick = async (e) => { e.preventDefault(); await fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{"logout":true}' }); showLogin(); };
}

// ======================= ROUTER =======================
const pages = { today: ['Today', renderToday], chat: ['Chat', renderChat], recipes: ['Recipes', renderRecipes], progress: ['Progress', renderProgress], plan: ['Plan', renderPlan] };
function route() {
  const key = (location.hash || '#today').slice(1);
  const [title, fn] = pages[key] || pages.today;
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === (pages[key] ? key : 'today')));
  $('#title').textContent = title;
  $('#topbar-extra').innerHTML = '';
  charts.forEach((c) => c.destroy()); charts = [];
  fn();
}
window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('/sw.js').catch(() => {});
