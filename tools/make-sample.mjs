// Builds a fake ปพ.1-style transcript (made-up student, made-up grades) for demos and testing.
// Usage: node tools/make-sample.mjs  -> writes sample/sample-transcript.html
// Then tools/render-sample.ps1 turns it into public/sample-transcript.jpg and sample/sample-transcript.pdf
import { writeFileSync, mkdirSync } from 'node:fs';
import { compute, trunc2 } from '../public/gpa.js';

const T = (code, name, credits, grade) => ({ code, name, credits, grade });
// A strong student: every Math (ค) and English (อ) course is 4, GPAX 3.78
// (191 grade points / 50.5 credits = 3.782)
const terms = [
  { term: '1/2567', label: 'ปีการศึกษา 2567 ภาคเรียนที่ 1', courses: [
    T('ท31101', 'ภาษาไทย 1', 1.0, '3'), T('ค31101', 'คณิตศาสตร์ 1', 1.0, '4'), T('ค31201', 'เพิ่มเติมคณิตศาสตร์ 1', 2.0, '4'),
    T('ว31101', 'วิทยาศาสตร์กายภาพ 1', 1.0, '4'), T('ว31201', 'ฟิสิกส์ 1', 1.5, '3.5'), T('ว31281', 'วิทยาการคำนวณ 1', 0.5, '4'),
    T('ส31101', 'สังคมศึกษา 1', 1.0, '3.5'), T('ส31102', 'ประวัติศาสตร์ 1', 0.5, '3.5'), T('พ31101', 'สุขศึกษาและพลศึกษา 1', 1.0, '4'),
    T('ศ31101', 'ศิลปะ 1', 0.5, '4'), T('ง31101', 'การงานอาชีพ 1', 0.5, '4'), T('อ31101', 'ภาษาอังกฤษ 1', 1.0, '4'),
    T('อ31201', 'ภาษาอังกฤษอ่าน-เขียน 1', 1.0, '4'), T('ก31901', 'แนะแนว 1', 0.5, 'ผ'), T('ก31903', 'ชุมนุม 1', 0.5, 'ผ'),
  ] },
  { term: '2/2567', label: 'ปีการศึกษา 2567 ภาคเรียนที่ 2', courses: [
    T('ท31102', 'ภาษาไทย 2', 1.0, '3.5'), T('ค31102', 'คณิตศาสตร์ 2', 1.0, '4'), T('ค31202', 'เพิ่มเติมคณิตศาสตร์ 2', 2.0, '4'),
    T('ว31102', 'วิทยาศาสตร์กายภาพ 2', 1.0, '3.5'), T('ว31202', 'ฟิสิกส์ 2', 1.5, '3.5'), T('ว31282', 'วิทยาการคำนวณ 2', 0.5, '4'),
    T('ส31103', 'สังคมศึกษา 2', 1.0, '4'), T('พ31102', 'สุขศึกษาและพลศึกษา 2', 1.0, '4'), T('ศ31102', 'ดนตรี 1', 0.5, '4'),
    T('อ31102', 'ภาษาอังกฤษ 2', 1.0, '4'), T('อ31202', 'ภาษาอังกฤษฟัง-พูด 1', 1.0, '4'), T('I30201', 'การศึกษาค้นคว้าและสร้างองค์ความรู้', 1.0, '4'),
    T('ก31902', 'แนะแนว 2', 0.5, 'ผ'), T('ก31904', 'ชุมนุม 2', 0.5, 'ผ'),
  ] },
  { term: '1/2568', label: 'ปีการศึกษา 2568 ภาคเรียนที่ 1', courses: [
    T('ท32101', 'ภาษาไทย 3', 1.0, '3'), T('ค32101', 'คณิตศาสตร์ 3', 1.0, '4'), T('ค32201', 'เพิ่มเติมคณิตศาสตร์ 3', 2.0, '4'),
    T('ว32101', 'ชีววิทยา 1', 1.0, '3.5'), T('ว32201', 'ฟิสิกส์ 3', 1.5, '3'), T('ว32221', 'เคมี 1', 1.5, '3'),
    T('ส32101', 'สังคมศึกษา 3', 1.0, '3'), T('ศ32101', 'ทัศนศิลป์ 1', 0.5, '4'), T('ง32101', 'การงานอาชีพ 2', 0.5, '4'),
    T('อ32101', 'ภาษาอังกฤษ 3', 1.0, '4'), T('อ32201', 'ภาษาอังกฤษอ่าน-เขียน 2', 1.0, '4'), T('I30202', 'การสื่อสารและการนำเสนอ', 1.0, '4'),
    T('ก32901', 'แนะแนว 3', 0.5, 'ผ'),
  ] },
  { term: '2/2568', label: 'ปีการศึกษา 2568 ภาคเรียนที่ 2', courses: [
    T('ท32102', 'ภาษาไทย 4', 1.0, '3.5'), T('ค32102', 'คณิตศาสตร์ 4', 1.0, '4'), T('ค32202', 'เพิ่มเติมคณิตศาสตร์ 4', 2.0, '4'),
    T('ว32102', 'ชีววิทยา 2', 1.0, '4'), T('ว32202', 'ฟิสิกส์ 4', 1.5, '4'), T('ว32222', 'เคมี 2', 1.5, '3.5'),
    T('ส32102', 'สังคมศึกษา 4', 1.0, '4'), T('ส32103', 'ประวัติศาสตร์ 2', 0.5, '4'), T('พ32101', 'สุขศึกษาและพลศึกษา 3', 1.0, '4'),
    T('อ32102', 'ภาษาอังกฤษ 4', 1.0, '4'), T('อ32202', 'ภาษาอังกฤษฟัง-พูด 2', 1.0, '4'),
    T('ก32902', 'แนะแนว 4', 0.5, 'ผ'), T('ก32904', 'ชุมนุม 4', 0.5, 'ผ'),
  ] },
];

const r = compute(terms);
const f = x => trunc2(x).toFixed(2);
const cr = x => x.toFixed(1);

// Flow all rows (term headings + courses) down three columns, like a real ปพ.1
const rows = terms.flatMap(t => [{ head: t.label }, ...t.courses]);
const perCol = Math.ceil(rows.length / 3);
const cols = [0, 1, 2].map(i => rows.slice(i * perCol, (i + 1) * perCol));
const colHtml = col => col.map(x => x.head
  ? `<tr><td colspan="3" class="h">${x.head}</td></tr>`
  : `<tr><td>${x.code} ${x.name}</td><td class="c">${cr(x.credits)}</td><td class="c">${x.grade}</td></tr>`).join('');

const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>sample transcript</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 0; }
  body { margin: 0; font: 11.5px/1.45 Sarabun, sans-serif; color: #111; background: #fff; }
  .p { width: 210mm; height: 297mm; padding: 12mm 10mm; box-sizing: border-box; }
  h1 { font-size: 17px; text-align: center; margin: 0 0 2mm; }
  .stamp { text-align: center; color: #b42318; font-weight: 600; font-size: 13px; border: 2px solid #b42318; display: inline-block; padding: 1mm 4mm; transform: rotate(-4deg); }
  .info { display: grid; grid-template-columns: 1fr 1fr; gap: 1mm 8mm; margin: 4mm 0; font-size: 12px; }
  .info span { border-bottom: 1px dotted #555; }
  .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; border: 1px solid #111; }
  table { border-collapse: collapse; width: 100%; } .grid > div + div { border-left: 1px solid #111; }
  th { border-bottom: 1px solid #111; font-size: 11px; padding: 1mm; } td { padding: .5mm 1.2mm; vertical-align: top; }
  td.c { text-align: center; width: 9mm; } td.h { text-align: center; font-weight: 600; padding-top: 1.5mm; }
  .sum { margin-top: 4mm; width: 60%; margin-left: auto; border: 1px solid #111; }
  .sum th, .sum td { border: 1px solid #111; text-align: center; padding: 1mm; }
</style></head><body><div class="p">
<h1>ระเบียนแสดงผลการเรียน (ตัวอย่าง · ข้อมูลสมมติ)</h1>
<div style="text-align:center"><span class="stamp">SAMPLE · ไม่ใช่เอกสารจริง</span></div>
<div class="info"><div>โรงเรียน <span>โรงเรียนตัวอย่างวิทยา</span></div><div>ชื่อ-สกุล <span>นายสมมติ ตัวอย่าง</span></div>
<div>ชั้น <span>มัธยมศึกษาปีที่ 6</span></div><div>เลขประจำตัว <span>00000</span></div></div>
<div class="grid">${cols.map(c => `<div><table><tr><th>รหัส/รายวิชา</th><th>หน่วยกิต</th><th>ผลการเรียน</th></tr>${colHtml(c)}</table></div>`).join('')}</div>
<table class="sum"><tr><th>ภาคเรียน</th><th>หน่วยกิต</th><th>คะแนนเฉลี่ย</th></tr>
${r.terms.map(t => `<tr><td>${t.term}</td><td>${cr(t.total.credits)}</td><td>${f(t.total.gpa)}</td></tr>`).join('')}
<tr><th>คะแนนเฉลี่ยสะสม</th><th>${cr(r.overall.credits)}</th><th>${f(r.overall.gpa)}</th></tr></table>
</div></body></html>`;

mkdirSync(new URL('../sample/', import.meta.url), { recursive: true });
writeFileSync(new URL('../sample/sample-transcript.html', import.meta.url), html);
writeFileSync(new URL('../sample/expected.json', import.meta.url), JSON.stringify({
  terms: r.terms.map(t => ({ term: t.term, credits: t.total.credits, gpa: f(t.total.gpa) })),
  overall: { credits: r.overall.credits, gpa: f(r.overall.gpa) },
}, null, 2));
// The exact rows printed on the sample, in the same shape the API returns:
// the answer key for checking the AI's reading of sample-transcript.jpg
writeFileSync(new URL('../sample/answer-key.json', import.meta.url), JSON.stringify({
  terms: terms.map(t => ({ term: t.term, courses: t.courses.map(({ code, credits, grade }) => ({ code, credits, grade })) })),
  reported: r.terms.map(t => ({ term: t.term, credits: t.total.credits, gpa: Number(f(t.total.gpa)) })),
  cumulative: Number(f(r.overall.gpa)),
}, null, 2));
console.log('sample written:', r.terms.map(t => `${t.term} ${f(t.total.gpa)}`).join(', '), '| GPAX', f(r.overall.gpa));
