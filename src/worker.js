// Transcript GPA AI: the AI only reads the transcript; all maths happens in gpa.js.
// POST /api/extract  { pages: ["data:image/jpeg;base64,...", ...] }
//   -> { terms: [{ term, courses: [{ code, name, credits, grade }] }], reported: [...], cumulative, model }
// Everything else is served from ./public.

import { termKey } from '../public/gpa.js';

// Chosen after comparing vision models on real transcripts (see README)
const MODEL = '@cf/qwen/qwen3.8-27b';
const MAX_PAGES = 4;
const MAX_PAGE_BYTES = 2_500_000; // per data URL, about a 1.8 MB JPEG

// The model copies rows in reading order; grouping into semesters is done in code
// (models are good at transcribing, unreliable at keeping track of which column belongs to which term).
const SCHEMA = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      description: 'Every row in reading order: whole first column top to bottom, then the next column',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['term', 'course'], description: '"term" for a semester heading row, "course" for a course row' },
          label: { type: 'string', description: 'For a term heading: the heading exactly as printed, e.g. "ปีการศึกษา 2567 ภาคเรียนที่ 1" or "ภาคเรียนที่ 1/2567"' },
          code: { type: 'string', description: 'Course code exactly as printed, e.g. "ท31101", "ค32208", "I30201", "ก30965"' },
          credits: { type: 'number' },
          grade: { type: 'string', description: 'Grade exactly as printed: 4, 3.5, 3, 2.5, 2, 1.5, 1, 0, ผ, มผ, ร, มส' },
        },
        required: ['kind'],
      },
    },
    reported: {
      type: 'array',
      description: 'Per-semester totals printed by the school, if any',
      items: {
        type: 'object',
        properties: { term: { type: 'string' }, credits: { type: 'number' }, gpa: { type: 'number' } },
        required: ['term'],
      },
    },
    cumulative: { type: 'number', description: 'Cumulative GPA (GPAX) printed by the school, or 0 if not shown' },
  },
  required: ['rows'],
};

const PROMPT = `You are transcribing a Thai high-school transcript (ระเบียนแสดงผลการเรียน / ปพ.1, in Thai or in English) into JSON.
Output every row of the grade table in reading order. Rules:
- Read the whole first column of the table from top to bottom, then the whole second column, then the third. Never skip a row, and keep going until the last row of the last column.
- When a semester or year heading appears (ภาคเรียนที่ ..., ปีการศึกษา ..., "First Year (2024)", "Semester 1/2024"), output it as a row with kind "term" and the heading text as label, at the position where it appears. If the heading is a grade level column title like "GRADE 10" and a year line follows, use the year line.
- Group titles such as "Fundamental Subjects", "Additional Subjects", "Learner Development Activities" are NOT terms: skip them.
- Rows without a course code (for example activities graded S) can be skipped.
- If the page has several semester tables side by side, each with its own heading above it, output the heading row first and then that table's courses.
- For courses output only code, credits and grade (no course names), to keep the output short.
- Copy values exactly as printed. Do not calculate, guess, round or correct anything, even if a value looks wrong.
- Course codes start with a Thai letter (ท ค ว ส พ ศ ง อ ก) or Latin letters (THA, MATH, SCI, SOC, HPE, ART, WORK ED, ENG, I), followed by 5 digits. Copy the whole code, including a space if printed (e.g. "WORK ED31101").
- Grades can be numbers (4, 3.5, 3, 2.5, 2, 1.5, 1, 0), Thai letters (ผ, มผ, ร, มส) or English letters (S, U, I, A, UE). Keep them as printed.
- A summary table may give the cumulative "GPA" or "คะแนนเฉลี่ยสะสม"; put it in "cumulative".
- If the school prints per-semester totals or GPA (คะแนนเฉลี่ย), put them in "reported"; put the cumulative GPA (คะแนนเฉลี่ยสะสม) in "cumulative".
- Ignore names, ID numbers, addresses, signatures and stamps. Do not output personal information.`;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

// Two AI accounts: "own" is the AI binding of the account this worker runs on;
// "borrowed" is another person's account, used with their permission through the
// REST API (secrets BORROWED_ACCOUNT_ID and BORROWED_AI_TOKEN). Borrowed is used
// only when our own free quota is gone, and has its own small daily cap.
const QUOTA_ERROR = /4006|daily free allocation/i;

async function runModel(env, account, model, input) {
  if (account === 'own') return env.AI.run(model, input);
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.BORROWED_ACCOUNT_ID}/ai/run/${model}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.BORROWED_AI_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`borrowed account ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.body;
}

async function readPage(env, dataUrl, model, account) {
  const out = await runModel(env, account, model, {
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: [
        { type: 'text', text: 'Extract every course row from this transcript page.' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ] },
    ],
    response_format: { type: 'json_schema', json_schema: SCHEMA },
    temperature: 0,
    max_tokens: 6000,
    // Copying a table needs no step-by-step reasoning; thinking only adds minutes
    chat_template_kwargs: { enable_thinking: false },
    // Non-streaming calls are cut off at about 2 minutes; a long table can take longer
    stream: true,
  });
  const { text, usage } = await collectStream(out);
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON in model output: ' + text.slice(0, 200));
  return { ...JSON.parse(text.slice(start, end + 1)), usage };
}

// Read a Workers AI server-sent-event stream and join the text pieces.
// Handles both the Workers AI shape {response} and the OpenAI shape {choices[0].delta.content}.
async function collectStream(stream) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '', text = '', usage = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const data = line.startsWith('data:') ? line.slice(5).trim() : '';
      if (!data || data === '[DONE]') continue;
      try {
        const evt = JSON.parse(data);
        text += evt.response ?? evt.choices?.[0]?.delta?.content ?? '';
        if (evt.usage) usage = evt.usage;
      } catch {}
    }
  }
  return { text, usage };
}

// Assign each course to the most recent term heading before it, across all pages.
// A semester may continue in the next column or on the next page.
function merge(results) {
  const terms = new Map(), reported = new Map();
  let cumulative = 0, current = 'unknown';
  for (const r of results) {
    for (const row of r.rows || []) {
      if (row.kind === 'term') { current = termKey(row.label); continue; }
      if (!row.code) continue;
      if (!terms.has(current)) terms.set(current, []);
      terms.get(current).push({ code: String(row.code).trim(), credits: Number(row.credits) || 0, grade: String(row.grade ?? '').trim() });
    }
    for (const rep of r.reported || []) reported.set(termKey(rep.term), { ...rep, term: termKey(rep.term) });
    if (r.cumulative) cumulative = r.cumulative;
  }
  return {
    terms: [...terms].map(([term, courses]) => ({ term, courses })),
    reported: [...reported.values()],
    cumulative,
  };
}

// Count pages per account per UTC day (when the Workers AI free quota resets) and refuse once
// that account's budget is used. KV is eventually consistent, so this is a soft cap, which is enough here.
const hasBorrowed = env => Boolean(env.BORROWED_ACCOUNT_ID && env.BORROWED_AI_TOKEN);
const budget = (env, account) => account === 'own' ? Number(env.DAILY_PAGES) || 8 : Number(env.BORROWED_DAILY_PAGES) || 5;
const dayKey = account => `pages:${account === 'own' ? '' : account + ':'}${new Date().toISOString().slice(0, 10)}`;

async function reservePages(env, account, n) {
  if (!env.USAGE) return true;
  const key = dayKey(account);
  const used = Number(await env.USAGE.get(key)) || 0;
  if (used + n > budget(env, account)) return false;
  await env.USAGE.put(key, String(used + n), { expirationTtl: 2 * 86400 });
  return true;
}

// Mark an account as spent for today (its real quota ran out, e.g. used by other work)
async function markSpent(env, account) {
  if (env.USAGE) await env.USAGE.put(dayKey(account), String(budget(env, account)), { expirationTtl: 2 * 86400 });
}

// Try own first, then borrowed. Returns the results and which account did the work.
async function readAll(env, pages) {
  const accounts = ['own', ...(hasBorrowed(env) ? ['borrowed'] : [])];
  let lastError = null;
  for (const account of accounts) {
    if (!(await reservePages(env, account, pages.length))) continue;
    try {
      return { account, results: await Promise.all(pages.map(p => readPage(env, p, MODEL, account))) };
    } catch (e) {
      lastError = e;
      if (!QUOTA_ERROR.test(String(e?.message || e))) throw e; // a real error: don't spend the other quota
      await markSpent(env, account);
    }
  }
  if (lastError) throw lastError;
  return null; // every budget used
}

async function handleExtract(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  if (env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: ip });
    if (!success) return json({ error: 'Too many requests. Please wait a minute and try again.' }, 429);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON: { "pages": [dataURL, ...] }' }, 400); }
  const pages = Array.isArray(body?.pages) ? body.pages : [];
  if (!pages.length) return json({ error: 'No pages received.' }, 400);
  if (pages.length > MAX_PAGES) return json({ error: `At most ${MAX_PAGES} pages per transcript.` }, 400);
  for (const p of pages) {
    if (typeof p !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(p)) return json({ error: 'Pages must be JPEG/PNG/WebP data URLs.' }, 400);
    if (p.length > MAX_PAGE_BYTES) return json({ error: 'A page image is too large.' }, 413);
  }

  const quotaGone = () => json({ error: 'วันนี้ใช้โควตา AI ฟรีครบแล้ว ลองใหม่พรุ่งนี้หลัง 7 โมงเช้า (เวลาไทย) หรือกด "ลองกับใบตัวอย่าง" ได้เลย' }, 429);
  try {
    const done = await readAll(env, pages);
    if (!done) return quotaGone();
    const usage = done.results.reduce((u, r) => ({ input: u.input + (r.usage?.prompt_tokens || 0), output: u.output + (r.usage?.completion_tokens || 0) }), { input: 0, output: 0 });
    return json({ ...merge(done.results), model: MODEL, account: done.account, usage });
  } catch (e) {
    if (QUOTA_ERROR.test(String(e?.message || e))) return quotaGone();
    return json({ error: 'The AI could not read this file. Try a clearer scan.', detail: String(e?.message || e).slice(0, 300) }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/extract') {
      if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
      return handleExtract(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
