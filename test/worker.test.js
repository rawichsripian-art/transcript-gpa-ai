import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

// In-memory stand-in for the USAGE KV namespace
const kv = () => {
  const m = new Map();
  return {
    get: async k => m.get(k) ?? null,
    put: async (k, v) => { m.set(k, v); },
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }),
    _m: m,
  };
};
// Like the Workers runtime: background work (logging) finishes via ctx.waitUntil
const run = async (req, env) => { const bg = []; const res = await worker.fetch(req, env, { waitUntil: p => bg.push(p) }); await Promise.all(bg); return res; };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const post = body => new Request('https://t/api/extract', { method: 'POST', body: JSON.stringify(body), headers: { 'cf-connecting-ip': '203.0.113.9' } });
const sse = text => new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ response: text, usage: { prompt_tokens: 1000, completion_tokens: 50 } })}\n\ndata: [DONE]\n`)); c.close(); } });

test('quota endpoint shows what is left, and a successful read is logged without personal data', async () => {
  const USAGE = kv();
  const env = { USAGE, DAILY_PAGES: '8', AI: { run: async () => sse('{"rows":[{"kind":"term","label":"1/2567"},{"kind":"course","code":"ท31101","credits":1,"grade":"4"}]}') } };

  let q = await (await run(new Request('https://t/api/quota'), env)).json();
  assert.equal(q.own.remaining, 8);

  const res = await run(post({ pages: [png, png] }), env);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.quota.remaining, 6);

  q = await (await run(new Request('https://t/api/quota'), env)).json();
  assert.equal(q.own.used, 2);

  const lines = [...USAGE._m].filter(([k]) => k.startsWith('log:')).map(([, v]) => JSON.parse(v));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].outcome, 'ok');
  assert.equal(lines[0].pages, 2);
  assert.equal(lines[0].usage.input, 2000);
  assert.ok(!JSON.stringify(lines[0]).includes('203.0.113.9'), 'raw IP must not be stored');
  assert.ok(!JSON.stringify(lines[0]).includes('ท31101'), 'transcript content must not be stored');
  const stats = JSON.parse([...USAGE._m].find(([k]) => k.startsWith('stats:'))[1]);
  assert.deepEqual([stats.requests, stats.ok, stats.pages], [1, 1, 2]);
});

test('quota-exhausted and bad requests are logged too', async () => {
  const USAGE = kv();
  const env = { USAGE, DAILY_PAGES: '1', AI: { run: async () => sse('{"rows":[]}') } };
  assert.equal((await run(post({ pages: [png, png] }), env)).status, 429); // budget 1 < 2 pages
  assert.equal((await run(post({}), env)).status, 400);
  const outcomes = [...USAGE._m].filter(([k]) => k.startsWith('log:')).map(([, v]) => JSON.parse(v).outcome).sort();
  assert.deepEqual(outcomes, ['bad_request', 'quota']);
});

test('/api/usage is hidden without ADMIN_TOKEN and needs the token when set', async () => {
  const USAGE = kv();
  const req = h => new Request('https://t/api/usage', { headers: h });
  assert.equal((await run(req({}), { USAGE })).status, 404);
  const env = { USAGE, ADMIN_TOKEN: 'secret' };
  assert.equal((await run(req({}), env)).status, 401);
  const ok = await run(req({ authorization: 'Bearer secret' }), env);
  assert.equal(ok.status, 200);
  assert.ok('quota' in (await ok.json()));
});
