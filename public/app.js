// Browser side: turn the PDF into page images, ask the worker's AI to read them,
// then calculate everything locally with gpa.js and let the user fix misreads.
import { AREAS, compute, verify, sortTerms, trunc2, areaOf } from './gpa.js';

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168';
const MAX_PAGES = 4;
const PAGE_WIDTH = 1700; // px; enough for small table text, small enough to upload fast

const $ = id => document.getElementById(id);
const fmt = x => (x === null || x === undefined ? '–' : trunc2(x).toFixed(2));
const fmtCr = x => (Number.isInteger(x) ? x.toFixed(1) : String(x));

// Build DOM nodes with textContent only, so nothing the AI returns is ever parsed as HTML
function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}

let state = null; // { terms, reported, cumulative }

function status(main, sub = '', error = false) {
  $('status').hidden = false;
  $('status').classList.toggle('error', error);
  $('status-main').textContent = main;
  $('status-sub').textContent = sub;
}

// ---------- file -> page images ----------
async function canvasToJpeg(canvas) { return canvas.toDataURL('image/jpeg', 0.85); }

async function pdfToImages(file) {
  const pdfjs = await import(`${PDFJS}/pdf.min.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.mjs`;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  if (doc.numPages > MAX_PAGES) throw new Error(`ไฟล์มี ${doc.numPages} หน้า รับได้ไม่เกิน ${MAX_PAGES} หน้า`);
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    status('กำลังเตรียมไฟล์…', `หน้า ${i} จาก ${doc.numPages}`);
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: PAGE_WIDTH / base.width });
    const canvas = el('canvas', { width: Math.round(viewport.width), height: Math.round(viewport.height) });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push(await canvasToJpeg(canvas));
  }
  return pages;
}

async function imageToJpeg(blob) {
  const img = await createImageBitmap(blob);
  const scale = Math.min(1, PAGE_WIDTH / img.width);
  const canvas = el('canvas', { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return [await canvasToJpeg(canvas)];
}

// ---------- AI ----------
async function extract(pages) {
  const started = Date.now();
  const timer = setInterval(() => {
    const s = Math.round((Date.now() - started) / 1000);
    status('AI กำลังอ่านตาราง…', `${s} วินาที · ปกติใช้ 1–2 นาที`);
  }, 1000);
  try {
    const res = await fetch('/api/extract', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pages }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `เกิดข้อผิดพลาด (${res.status})`);
    return data;
  } finally { clearInterval(timer); }
}

async function run(file) {
  $('results').hidden = true;
  $('upload').hidden = true;
  try {
    status('กำลังเตรียมไฟล์…');
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    const pages = isPdf ? await pdfToImages(file) : await imageToJpeg(file);
    show(await extract(pages));
  } catch (e) {
    status('อ่านไฟล์ไม่สำเร็จ', e.message || String(e), true);
    $('upload').hidden = false;
  }
}

function show(data) {
  const terms = sortTerms(data.terms || []).filter(t => t.courses?.length);
  if (!terms.length) throw new Error('AI ไม่พบรายวิชาในไฟล์นี้ ลองไฟล์ที่ชัดขึ้น');
  state = { terms, reported: data.reported || [], cumulative: data.cumulative || 0 };
  $('status').hidden = true;
  render();
}

// ---------- results ----------
function render() {
  const r = compute(state.terms);
  const checks = verify(r, state.reported, state.cumulative);
  const allOk = checks.length > 0 && checks.every(c => c.ok);

  // summary cards
  const s = $('summary'); s.replaceChildren(
    el('div', { class: 'stat' + (allOk ? ' good' : '') }, el('div', { class: 'k' }, 'เกรดเฉลี่ยสะสม (GPAX)'), el('div', { class: 'v' }, fmt(r.overall.gpa)), el('div', { class: 's' }, allOk ? 'ตรงกับที่โรงเรียนพิมพ์ ✓' : 'คำนวณจากรายวิชาที่อ่านได้')),
    el('div', { class: 'stat' }, el('div', { class: 'k' }, 'หน่วยกิตที่คิดเกรด'), el('div', { class: 'v' }, fmtCr(r.overall.credits)), el('div', { class: 's' }, `${r.overall.courses} รายวิชา`)),
    el('div', { class: 'stat' }, el('div', { class: 'k' }, 'ภาคเรียน'), el('div', { class: 'v' }, r.terms.length), el('div', { class: 's' }, r.terms.map(t => t.term).join(' · '))),
  );

  // checks against school figures
  $('checks-card').hidden = !checks.length;
  $('checks').replaceChildren(...checks.map(c => el('li', { class: c.ok ? 'ok' : 'bad' },
    `${c.term}: ${fmt(c.ours)}${c.ok ? ' ✓' : ` ≠ ${c.school.toFixed(2)} ของโรงเรียน`}`)));

  // warnings
  $('warn-card').hidden = !r.warnings.length;
  $('warnings').replaceChildren(...r.warnings.map(w => el('li', {}, el('b', {}, `${w.term} · ${w.code}`), ' — ', w.issues.join(' · '))));

  // area x term matrix
  const used = AREAS.filter(a => r.areas[a.id].courses > 0);
  if (r.areas.other.courses) used.push({ id: 'other', no: null, th: 'อื่น ๆ' });
  const areaCell = a => el('td', {}, el('span', { class: 'code' }, a.id === 'other' ? '?' : a.id), ' ', a.th);
  const cell = b => b.courses ? el('td', { class: 'n' }, `${fmtCr(b.credits)} / `, el('b', {}, fmt(b.gpa))) : el('td', { class: 'dash' }, '–');
  $('matrix').replaceChildren(
    el('thead', {}, el('tr', {}, el('th', {}, 'กลุ่มสาระ'), ...r.terms.map(t => el('th', {}, t.term)), el('th', {}, 'รวม'))),
    el('tbody', {},
      ...used.map(a => el('tr', {}, areaCell(a), ...r.terms.map(t => cell(t.areas[a.id])), cell(r.areas[a.id]))),
      el('tr', { class: 'total' }, el('td', {}, 'รวมทั้งภาค'), ...r.terms.map(t => cell(t.total)), cell(r.overall)),
    ),
  );

  renderRows(r);
  $('results').hidden = false;
}

function renderRows(r) {
  const flagged = new Set(r.warnings.map(w => `${w.term}|${w.code}`));
  const total = state.terms.reduce((n, t) => n + t.courses.length, 0);
  $('rows-count').textContent = `(${total} แถว)`;
  if (r.warnings.length) $('rows-card').open = true;

  const input = (t, i, key, attrs = {}) => el('input', { value: state.terms[t].courses[i][key], 'aria-label': key, ...attrs,
    onchange: e => {
      const v = e.target.value.trim();
      state.terms[t].courses[i][key] = key === 'credits' ? Number(v) || 0 : v;
      render();
    } });

  $('rows').replaceChildren(...state.terms.map((term, t) => el('div', { class: 'term-block' },
    el('h3', {}, `ภาคเรียน ${term.term}`),
    el('div', { class: 'table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, el('th', {}, 'รหัสวิชา'), el('th', {}, 'หน่วยกิต'), el('th', {}, 'เกรด'), el('th', {}, 'กลุ่มสาระ'), el('th', {}, ''))),
      el('tbody', {}, ...term.courses.map((c, i) => {
        const area = areaOf(c.code);
        const found = AREAS.find(a => a.id === area);
        const name = area === 'activity' ? 'กิจกรรม (ไม่คิดเกรด)' : found ? `${found.id} ${found.th}` : 'ไม่ทราบ';
        return el('tr', { class: flagged.has(`${term.term}|${c.code}`) ? 'flag' : '' },
          el('td', {}, input(t, i, 'code')),
          el('td', {}, input(t, i, 'credits', { inputmode: 'decimal' })),
          el('td', {}, input(t, i, 'grade')),
          el('td', { class: 'muted small' }, name),
          el('td', { class: 'x' }, el('button', { type: 'button', title: 'ลบแถว', onclick: () => { term.courses.splice(i, 1); render(); } }, '✕')));
      })),
    )),
  )));
}

function downloadCsv() {
  const r = compute(state.terms);
  const head = ['รหัส', 'กลุ่มสาระ', ...r.terms.flatMap(t => [`${t.term} หน่วยกิต`, `${t.term} เกรด`]), 'รวม หน่วยกิต', 'รวม เกรด'];
  const pair = b => b.courses ? [b.credits, fmt(b.gpa)] : ['', ''];
  const lines = [head];
  for (const a of AREAS.filter(a => r.areas[a.id].courses)) lines.push([a.id, a.th, ...r.terms.flatMap(t => pair(t.areas[a.id])), ...pair(r.areas[a.id])]);
  lines.push(['TOTAL', 'รวม', ...r.terms.flatMap(t => pair(t.total)), ...pair(r.overall)]);
  const csv = '﻿' + lines.map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: 'transcript-gpa.csv' });
  a.click(); URL.revokeObjectURL(a.href);
}

// ---------- wiring ----------
const drop = $('drop');
$('file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) run(f); });
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) run(f); });
// The sample shows what the AI returned for sample-transcript.jpg earlier,
// so trying the demo is instant and doesn't use the daily AI quota
$('sample').addEventListener('click', async () => {
  $('upload').hidden = true;
  try { show(await (await fetch('sample-result.json')).json()); }
  catch (e) { status('โหลดตัวอย่างไม่สำเร็จ', e.message, true); $('upload').hidden = false; }
});
// transcript.atomengineer.site/#demo opens straight into the sample result
if (location.hash === '#demo') $('sample').click();
$('csv').addEventListener('click', downloadCsv);
$('again').addEventListener('click', () => { $('results').hidden = true; $('upload').hidden = false; $('status').hidden = true; window.scrollTo(0, 0); });
