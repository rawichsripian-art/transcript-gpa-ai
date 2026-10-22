// Run with: npm test   (uses Node's built-in test runner, no dependencies)
import test from 'node:test';
import assert from 'node:assert/strict';
import { areaOf, gradePoints, termKey, checkCourse, compute, verify, sortTerms, round2, trunc2 } from '../public/gpa.js';

// A made-up transcript; the expected numbers are worked out by hand in the comments
const sample = [
  { term: '1/2567', courses: [
    { code: 'ท31101', credits: 1.0, grade: '4' },   // 1.0 × 4   = 4
    { code: 'ค31101', credits: 2.0, grade: '3' },   // 2.0 × 3   = 6
    { code: 'ว31101', credits: 1.5, grade: '2.5' }, // 1.5 × 2.5 = 3.75
    { code: 'อ31101', credits: 1.0, grade: '3.5' }, // 1.0 × 3.5 = 3.5
    { code: 'I30201', credits: 1.0, grade: '4' },   // 1.0 × 4   = 4
    { code: 'ก30901', credits: 0.5, grade: 'ผ' },   // activity: not counted
  ] },                                              // 6.5 credits, 21.25 points -> 3.269
  { term: '2/2567', courses: [
    { code: 'ท31102', credits: 1.0, grade: '2' },   // 2
    { code: 'ค31102', credits: 2.0, grade: '1' },   // 2
    { code: 'ว31102', credits: 1.0, grade: '4' },   // 4
    { code: 'ส31102', credits: 1.0, grade: 'มส' },  // incomplete: not counted
  ] },                                              // 4 credits, 8 points -> 2.00
];

test('learning area from the course code', () => {
  assert.equal(areaOf('ท31101'), 'THA');
  assert.equal(areaOf('ค32208'), 'MATH');
  assert.equal(areaOf('ว31294'), 'SCI');
  assert.equal(areaOf('อ30202'), 'FL');
  assert.equal(areaOf('จ31201'), 'FL'); // Chinese is also a foreign language
  assert.equal(areaOf('I30201'), 'IS');
  assert.equal(areaOf('i30201'), 'IS');
  assert.equal(areaOf('ก30965'), 'activity');
  assert.equal(areaOf('X1'), 'other');
});

test('grade points', () => {
  assert.equal(gradePoints('3.5'), 3.5);
  assert.equal(gradePoints(' 4 '), 4);
  assert.equal(gradePoints('๓.๕'), 3.5); // Thai digits
  assert.equal(gradePoints('ผ'), null);
  assert.equal(gradePoints('มผ'), null);
  assert.equal(gradePoints('4.5'), null);
  assert.equal(gradePoints('3.3'), null); // not a 0.5 step
});

test('term labels in different formats become "semester/year"', () => {
  assert.equal(termKey('ปีการศึกษา 2567 ภาคเรียนที่ 1'), '1/2567');
  assert.equal(termKey('ภาคเรียนที่ 2/2568'), '2/2568');
  assert.equal(termKey('ภาคเรียนที่ ๑/๒๕๖๗'), '1/2567');
  assert.equal(termKey('1 / 2567'), '1/2567');
});

test('per-term and overall GPA', () => {
  const r = compute(sample);
  assert.equal(r.terms[0].total.credits, 6.5);
  assert.equal(round2(r.terms[0].total.gpa), 3.27);
  assert.equal(r.terms[0].activities, 1);
  assert.equal(r.terms[1].total.credits, 4);
  assert.equal(r.terms[1].total.gpa, 2);
  assert.equal(r.overall.credits, 10.5);
  assert.equal(round2(r.overall.gpa), 2.79); // 29.25 / 10.5
});

test('GPA by learning area across terms', () => {
  const r = compute(sample);
  assert.deepEqual([r.areas.MATH.credits, r.areas.MATH.gpa], [4, 2]);     // (6 + 2) / 4
  assert.deepEqual([r.areas.THA.credits, r.areas.THA.gpa], [2, 3]);     // (4 + 2) / 2
  assert.deepEqual([r.areas.SOC.credits, r.areas.SOC.gpa], [0, null]);  // only an incomplete course
  assert.deepEqual([r.areas.IS.credits, r.areas.IS.gpa], [1, 4]);
});

test('suspicious values are flagged for a person to check', () => {
  assert.match(checkCourse({ code: 'อ30202', credits: 21, grade: '4' }).join(), /น่าจะเป็น 1\.0/);
  assert.match(checkCourse({ code: 'อ30201', credits: 11, grade: '4' }).join(), /น่าจะเป็น 1\.0/);
  assert.match(checkCourse({ code: 'ค31101', credits: 1.3, grade: '4' }).join(), /0\.5/);
  assert.match(checkCourse({ code: 'ค31101', credits: 1, grade: 'B' }).join(), /อ่านไม่ได้/);
  assert.deepEqual(checkCourse({ code: 'ก30965', credits: 0.5, grade: 'ผ' }), []);
  assert.deepEqual(checkCourse({ code: 'ค31101', credits: 2, grade: '3.5' }), []);
});

test('results are checked against the GPA the school printed (rounded or truncated)', () => {
  const r = compute(sample);
  const ok = verify(r, [{ term: '1/2567', gpa: 3.27, credits: 6.5 }, { term: '2/2567', gpa: 2.0 }], 2.79);
  assert.ok(ok.every(c => c.ok));
  // 3.269 truncated is 3.26: schools that truncate must also pass
  assert.equal(trunc2(r.terms[0].total.gpa), 3.26);
  assert.ok(verify(r, [{ term: '1/2567', gpa: 3.26 }])[0].ok);
  // a different number means a row was misread
  assert.equal(verify(r, [{ term: '1/2567', gpa: 3.5 }])[0].ok, false);
});

test('English Program transcripts: Latin course codes, S grades, year headings', () => {
  assert.equal(areaOf('THA31101'), 'THA');
  assert.equal(areaOf('MATH31207'), 'MATH');
  assert.equal(areaOf('SCI31294'), 'SCI');
  assert.equal(areaOf('SOC30209'), 'SOC');
  assert.equal(areaOf('HPE31101'), 'HPE');
  assert.equal(areaOf('ART31103'), 'ART');
  assert.equal(areaOf('WORK ED31101'), 'WORK');
  assert.equal(areaOf('ENG30201'), 'FL');
  assert.equal(areaOf('I30202'), 'IS');
  assert.equal(termKey('First Year (2024)'), '2024');
  assert.equal(termKey('Semester 2/2025'), '2/2025');
  assert.deepEqual(checkCourse({ code: 'ENG31101', credits: 1, grade: 'S' }), []);
  assert.deepEqual(sortTerms([{ term: '2025' }, { term: '2024' }]).map(t => t.term), ['2024', '2025']);
});

test('terms are sorted by year, then semester', () => {
  const sorted = sortTerms([{ term: '1/2568' }, { term: '2/2567' }, { term: '1/2567' }]).map(t => t.term);
  assert.deepEqual(sorted, ['1/2567', '2/2567', '1/2568']);
});
