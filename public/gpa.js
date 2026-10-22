// GPA maths for Thai high-school transcripts. Pure functions, no AI: the AI only reads
// the rows, and everything here is deterministic so it can be tested and trusted.

// Learning areas (กลุ่มสาระการเรียนรู้) by the first letter of the course code
// id is the short code shown in tables and CSV (THA, MATH, SCI, ...)
export const AREAS = [
  { id: 'THA',  no: 21, th: 'ภาษาไทย',                         en: 'Thai',                         letters: 'ท' },
  { id: 'MATH', no: 22, th: 'คณิตศาสตร์',                       en: 'Mathematics',                  letters: 'ค' },
  { id: 'SCI',  no: 23, th: 'วิทยาศาสตร์และเทคโนโลยี',           en: 'Science & Technology',         letters: 'ว' },
  { id: 'SOC',  no: 24, th: 'สังคมศึกษา ศาสนา และวัฒนธรรม',      en: 'Social Studies',               letters: 'ส' },
  { id: 'HPE',  no: 25, th: 'สุขศึกษาและพลศึกษา',                en: 'Health & PE',                  letters: 'พ' },
  { id: 'ART',  no: 26, th: 'ศิลปะ',                            en: 'Arts',                         letters: 'ศ' },
  { id: 'WORK', no: 27, th: 'การงานอาชีพและเทคโนโลยี',           en: 'Occupations & Technology',     letters: 'ง' },
  { id: 'FL',   no: 28, th: 'ภาษาต่างประเทศ',                    en: 'Foreign Languages',            letters: 'อจญฝยรลข' },
  { id: 'IS',   no: null, th: 'การศึกษาค้นคว้าด้วยตนเอง',         en: 'Independent Study',            letters: 'I' },
];
const ACTIVITY = 'ก'; // กิจกรรมพัฒนาผู้เรียน: pass/fail, no grade points

export function areaOf(code) {
  const c = String(code || '').trim().charAt(0).toUpperCase();
  if (c === ACTIVITY) return 'activity';
  const a = AREAS.find(a => a.letters.includes(c));
  return a ? a.id : 'other';
}

// Numeric grade 0–4 in steps of 0.5, or null for pass/fail and incomplete marks (ผ มผ ร มส)
export function gradePoints(grade) {
  const s = String(grade ?? '').trim().replace(/[๐-๙]/g, d => '๐๑๒๓๔๕๖๗๘๙'.indexOf(d));
  if (!/^\d(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= 4 && n * 2 === Math.round(n * 2) ? n : null;
}

// Round half up to 2 decimals without float surprises (3.125 -> 3.13)
export const round2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
// Many Thai schools truncate instead (3.129 -> 3.12)
export const trunc2 = x => Math.floor((x + 1e-9) * 100) / 100;

function bucket() { return { credits: 0, points: 0, courses: 0 }; }
function add(b, credits, points) { b.credits += credits; b.points += credits * points; b.courses++; }
function finish(b) { return { ...b, credits: round2(b.credits), points: round2(b.points), gpa: b.credits ? b.points / b.credits : null }; }

// Flag values that are probably misreads or printing errors, so a person checks them
export function checkCourse(c) {
  const issues = [];
  const cr = Number(c.credits);
  if (!(cr > 0)) issues.push('ไม่มีหน่วยกิต');
  // e.g. a stray pen mark turns "1.0" into "11.0" or "21.0"
  else if (cr > 3) issues.push(`หน่วยกิต ${cr} สูงผิดปกติ` + (cr % 10 === 1 ? ' (น่าจะเป็น 1.0)' : ''));
  else if (cr * 2 !== Math.round(cr * 2)) issues.push(`หน่วยกิต ${cr} ไม่ใช่ทีละ 0.5`);
  if (areaOf(c.code) !== 'activity' && gradePoints(c.grade) === null && !/^(ผ|มผ|ร|มส)$/.test(String(c.grade).trim())) issues.push(`เกรด "${c.grade}" อ่านไม่ได้`);
  if (areaOf(c.code) === 'other') issues.push(`ไม่รู้กลุ่มสาระของรหัส ${c.code}`);
  return issues;
}

// terms: [{ term, courses: [{ code, credits, grade }] }]
// Returns per-term and overall results by learning area, plus warnings.
export function compute(terms) {
  const byArea = Object.fromEntries([...AREAS.map(a => a.id), 'other'].map(id => [id, bucket()]));
  const overall = bucket();
  const termResults = [];
  const warnings = [];

  for (const t of terms) {
    const areas = Object.fromEntries(Object.keys(byArea).map(id => [id, bucket()]));
    const total = bucket();
    let activities = 0;
    for (const c of t.courses) {
      const issues = checkCourse(c);
      if (issues.length) warnings.push({ term: t.term, code: c.code, issues });
      const area = areaOf(c.code);
      const pts = gradePoints(c.grade);
      if (area === 'activity') { activities++; continue; }
      if (pts === null) continue; // ผ / มผ / ร / มส: no grade points, not counted in GPA
      const cr = Number(c.credits) || 0;
      add(areas[area], cr, pts); add(byArea[area], cr, pts);
      add(total, cr, pts); add(overall, cr, pts);
    }
    termResults.push({
      term: t.term,
      areas: Object.fromEntries(Object.entries(areas).map(([id, b]) => [id, finish(b)])),
      total: finish(total),
      activities,
    });
  }
  return {
    terms: termResults,
    areas: Object.fromEntries(Object.entries(byArea).map(([id, b]) => [id, finish(b)])),
    overall: finish(overall),
    warnings,
  };
}

// Compare our per-term GPA with what the school printed. Accept either rounding.
export function verify(result, reported = [], cumulative = 0) {
  const same = (ours, theirs) => ours !== null && theirs > 0 && (round2(ours) === round2(theirs) || trunc2(ours) === round2(theirs));
  const checks = [];
  for (const rep of reported) {
    const t = result.terms.find(x => x.term === rep.term);
    if (!t || !(rep.gpa > 0)) continue;
    checks.push({ term: rep.term, ours: t.total.gpa, school: rep.gpa, credits: t.total.credits, schoolCredits: rep.credits, ok: same(t.total.gpa, rep.gpa) && (!rep.credits || round2(rep.credits) === t.total.credits) });
  }
  if (cumulative > 0) checks.push({ term: 'GPAX', ours: result.overall.gpa, school: cumulative, ok: same(result.overall.gpa, cumulative) });
  return checks;
}

// Turn "ปีการศึกษา 2567 ภาคเรียนที่ 1" or "ภาคเรียนที่ 1/2567" into "1/2567"
export function termKey(label) {
  const s = String(label || '').replace(/[๐-๙]/g, d => '๐๑๒๓๔๕๖๗๘๙'.indexOf(d));
  const slash = s.match(/([123])\s*\/\s*(25\d\d)/);
  if (slash) return `${slash[1]}/${slash[2]}`;
  const year = s.match(/25\d\d/), sem = s.match(/ภาคเรียนที่\s*([123])/);
  return year && sem ? `${sem[1]}/${year[0]}` : s.trim();
}

// Sort "1/2567", "2/2567", "1/2568" by year then semester
export function sortTerms(terms) {
  const key = t => { const m = String(t.term).match(/^([123])\/(\d{4})$/); return m ? Number(m[2]) * 10 + Number(m[1]) : 1e9; };
  return [...terms].sort((a, b) => key(a) - key(b));
}
