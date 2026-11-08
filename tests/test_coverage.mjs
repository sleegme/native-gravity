import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  buildScopeMap,
  checkCoverageTable,
  checkTestIntegrity,
  countProbeHits,
  expandScopeFiles,
  isPathInScope,
  runCoverageProbes,
  scopeChanges,
  snapshotScope,
  snapshotTestIntegrity,
  validateCoverage,
} from '../scripts/coverage.mjs';

function workdir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ntg-coverage-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('expandScopeFiles: files kept, dirs walked, ignored dirs skipped, missing reported', t => {
  const dir = workdir(t);
  writeFileSync(join(dir, 'top.mjs'), 'export const a = 1;\n');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'inner.py'), 'def f():\n    pass\n');
  mkdirSync(join(dir, 'src', 'node_modules'));
  writeFileSync(join(dir, 'src', 'node_modules', 'junk.js'), 'x\n');
  mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'dist', 'out.js'), 'x\n');

  const { files, missing } = expandScopeFiles(['top.mjs', 'src', 'dist/', 'absent.mjs'], { cwd: dir });

  assert.deepEqual(files, ['dist/out.js', 'src/inner.py', 'top.mjs']);
  assert.deepEqual(missing, ['absent.mjs']);
});

test('buildScopeMap: line counts, JS and Python top-level symbols, indented declarations excluded', t => {
  const dir = workdir(t);
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'mod.mjs'), [
    'import x from "y";',
    '',
    'export function alpha() {',
    '  function nested() {}',
    '}',
    '',
    'class Beta {}',
    'const gamma = 1;',
    '    const indented = 2;',
    '',
  ].join('\n'));
  writeFileSync(join(dir, 'src', 'mod.py'), 'import os\n\n\ndef one():\n    pass\n\n\nclass Two:\n    pass\n');
  writeFileSync(join(dir, 'src', 'plain.txt'), 'a\nb\n');

  const map = buildScopeMap(['src'], { cwd: dir });

  const mod = map.files.find(f => f.path === 'src/mod.mjs');
  assert.equal(mod.lines, 9);
  assert.deepEqual(mod.symbols, [
    { name: 'alpha', line: 3 },
    { name: 'Beta', line: 7 },
    { name: 'gamma', line: 8 },
  ]);
  const py = map.files.find(f => f.path === 'src/mod.py');
  assert.deepEqual(py.symbols, [{ name: 'one', line: 4 }, { name: 'Two', line: 8 }]);
  const txt = map.files.find(f => f.path === 'src/plain.txt');
  assert.deepEqual(txt.symbols, []);
  assert.equal(txt.lines, 2);
});

test('isPathInScope: exact, directory prefix, and whole-segment boundaries', () => {
  const scope = ['scripts/spine.mjs', 'tests'];
  assert.equal(isPathInScope('scripts/spine.mjs', scope), true);
  assert.equal(isPathInScope('tests/test_a.mjs', scope), true);
  assert.equal(isPathInScope('testsuite/x.mjs', scope), false);
  assert.equal(isPathInScope('scripts/runner.mjs', scope), false);
  assert.equal(isPathInScope('', scope), false);
});

test('validateCoverage: accepts valid probes and optional verify', () => {
  validateCoverage({
    milestones: [
      { id: 'one', bounded_scope: ['scripts/'], coverage: [
        { id: 'P1', applies_to: 'AC1', claim: 'every save verified', probe: { pattern: '\\.save\\(', paths: ['scripts/spine.mjs'] } },
      ], verify: ['node --test tests/*.mjs'] },
      { id: 'two', bounded_scope: ['docs/'] },
    ],
  });
});

for (const [label, milestone, matcher] of [
  ['non-compiling pattern', { id: 'one', bounded_scope: ['scripts/'], coverage: [{ id: 'P1', probe: { pattern: '(', paths: ['scripts/a.mjs'] } }] }, /does not compile/],
  ['path outside bounded_scope', { id: 'one', bounded_scope: ['docs/'], coverage: [{ id: 'P1', probe: { pattern: 'x', paths: ['scripts/a.mjs'] } }] }, /outside the milestone's bounded_scope/],
  ['duplicate coverage id', { id: 'one', bounded_scope: ['scripts/'], coverage: [
    { id: 'P1', probe: { pattern: 'x', paths: ['scripts/a.mjs'] } },
    { id: 'P1', probe: { pattern: 'y', paths: ['scripts/b.mjs'] } },
  ] }, /duplicate coverage id/],
  ['empty probe paths', { id: 'one', bounded_scope: ['scripts/'], coverage: [{ id: 'P1', probe: { pattern: 'x', paths: [] } }] }, /non-empty 'paths'/],
  ['verify not strings', { id: 'one', bounded_scope: ['scripts/'], verify: [42] }, /verify must be an array/],
]) {
  test(`validateCoverage rejects: ${label}`, () => {
    assert.throws(() => validateCoverage({ milestones: [milestone] }), matcher);
  });
}

test('runCoverageProbes: line-based hits with file:line:text; missing files skipped', t => {
  const dir = workdir(t);
  mkdirSync(join(dir, 'scripts'));
  writeFileSync(join(dir, 'scripts', 'spine.mjs'), 'a.save(x)\nb\n  c.save(y)\n');

  const hits = runCoverageProbes(
    [{ id: 'P1', probe: { pattern: '\\.save\\(', paths: ['scripts/spine.mjs', 'scripts/gone.mjs'] } }],
    { cwd: dir });

  assert.deepEqual(hits, [
    { coverage_id: 'P1', site: 'scripts/spine.mjs:1', text: 'a.save(x)' },
    { coverage_id: 'P1', site: 'scripts/spine.mjs:3', text: 'c.save(y)' },
  ]);
});

test('countProbeHits counts per probe id', t => {
  const dir = workdir(t);
  mkdirSync(join(dir, 'scripts'));
  writeFileSync(join(dir, 'scripts', 'a.mjs'), 'save(1)\nsave(2)\n');
  writeFileSync(join(dir, 'scripts', 'b.mjs'), 'verify(x)\n');

  const counts = countProbeHits([
    { id: 'SAVE', probe: { pattern: 'save\\(', paths: ['scripts/a.mjs', 'scripts/b.mjs'] } },
    { id: 'VERIFY', probe: { pattern: 'verify\\(', paths: ['scripts/b.mjs'] } },
  ], { cwd: dir });

  assert.deepEqual(counts, { SAVE: 2, VERIFY: 1 });
});

test('checkCoverageTable: every hit needs a matching row; bad dispositions are invalid', () => {
  const hits = [
    { coverage_id: 'P1', site: 'a.mjs:1', text: 'save(1)' },
    { coverage_id: 'P1', site: 'a.mjs:2', text: 'save(2)' },
  ];
  assert.equal(checkCoverageTable(hits, [
    { coverage_id: 'P1', site: 'a.mjs:1', disposition: 'COVERED', evidence: 'verified', test: 't1' },
    { coverage_id: 'P1', site: 'a.mjs:2', disposition: 'NOT_APPLICABLE', evidence: 'not a save path', test: '' },
  ]).ok, true);

  const partial = checkCoverageTable(hits, [
    { coverage_id: 'P1', site: 'a.mjs:1', disposition: 'COVERED', evidence: 'verified', test: 't1' },
  ]);
  assert.equal(partial.ok, false);
  assert.deepEqual(partial.missing.map(h => h.site), ['a.mjs:2']);

  const wrongId = checkCoverageTable(hits, [
    { coverage_id: 'OTHER', site: 'a.mjs:1', disposition: 'COVERED' },
    { coverage_id: 'P1', site: 'a.mjs:2', disposition: 'COVERED' },
  ]);
  assert.equal(wrongId.ok, false);
  assert.deepEqual(wrongId.missing.map(h => h.site), ['a.mjs:1']);

  const badDisposition = checkCoverageTable(hits, [
    { coverage_id: 'P1', site: 'a.mjs:1', disposition: 'MAYBE' },
    { coverage_id: 'P1', site: 'a.mjs:2', disposition: 'COVERED' },
  ]);
  assert.equal(badDisposition.ok, false);
  assert.equal(badDisposition.invalid.length, 1);

  assert.equal(checkCoverageTable(hits, undefined).ok, false);
  assert.equal(checkCoverageTable(hits, 'nope').ok, false);
});

test('snapshotScope and scopeChanges: content change, new file, removed file', t => {
  const dir = workdir(t);
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.mjs'), 'one\n');
  writeFileSync(join(dir, 'src', 'b.mjs'), 'two\n');

  const before = snapshotScope(['src'], { cwd: dir });
  writeFileSync(join(dir, 'src', 'a.mjs'), 'one changed\n');
  writeFileSync(join(dir, 'src', 'c.mjs'), 'new\n');
  rmSync(join(dir, 'src', 'b.mjs'));

  const changes = scopeChanges(before, snapshotScope(['src'], { cwd: dir }));
  assert.deepEqual(changes.changed, ['src/a.mjs', 'src/b.mjs']);
  assert.deepEqual(changes.added, ['src/c.mjs']);

  const unchanged = scopeChanges(before, snapshotScope(['src', 'src'], { cwd: dir }));
  assert.ok(unchanged.changed.length > 0);
});

// ---------------------------------------------------------------------------
// Stage 2 (subagent redesign 2026-11-08, §2.4 CHECK item 3): test-integrity
// baseline and diff scan.
// ---------------------------------------------------------------------------

test('snapshotTestIntegrity: test-shaped files only, suppression lines recorded, markerless files kept', t => {
  const dir = workdir(t);
  mkdirSync(join(dir, 'tests'));
  writeFileSync(join(dir, 'tests', 'test_thing.mjs'), "test('a', () => {});\nt.skip('skip me');\n");
  writeFileSync(join(dir, 'tests', 'helper.mjs'), 'export const util = 1;\n');
  writeFileSync(join(dir, 'src.spec.mjs'), "describe.only('focus', () => {});\n");
  writeFileSync(join(dir, 'notes.txt'), 'prose mentioning only and skip and todo\n');

  const snapshot = snapshotTestIntegrity(['tests', 'src.spec.mjs', 'notes.txt', 'missing'], { cwd: dir });
  // Non-test files (notes.txt) and missing entries never enter the baseline.
  assert.deepEqual(Object.keys(snapshot.files).sort(), ['src.spec.mjs', 'tests/helper.mjs', 'tests/test_thing.mjs']);
  assert.deepEqual(snapshot.files['tests/test_thing.mjs'], ["t.skip('skip me');"]);
  assert.deepEqual(snapshot.files['src.spec.mjs'], ["describe.only('focus', () => {});"]);
  assert.deepEqual(snapshot.files['tests/helper.mjs'], []);
});

test('checkTestIntegrity: new markers, new test files and deletions flagged; shifts and repeats are not', t => {
  const dir = workdir(t);
  mkdirSync(join(dir, 'tests'));
  const baselineText = "test('baseline', () => {});\n";
  writeFileSync(join(dir, 'tests', 'test_a.mjs'), baselineText);
  const before = snapshotTestIntegrity(['tests'], { cwd: dir });

  // Nothing changed: ok.
  assert.deepEqual(checkTestIntegrity(['tests'], before, { cwd: dir }), { ok: true, deleted_files: [], new_markers: [] });

  // A marker line added to an existing test file is flagged.
  writeFileSync(join(dir, 'tests', 'test_a.mjs'), baselineText + "it.only('fast', () => {});\n");
  let check = checkTestIntegrity(['tests'], before, { cwd: dir });
  assert.equal(check.ok, false);
  assert.deepEqual(check.deleted_files, []);
  assert.deepEqual(check.new_markers, [{ file: 'tests/test_a.mjs', text: "it.only('fast', () => {});" }]);

  // A line shift above a pre-existing marker is not a new marker.
  writeFileSync(join(dir, 'tests', 'test_a.mjs'), "// new header\ntest('baseline', () => {});\n");
  check = checkTestIntegrity(['tests'], before, { cwd: dir });
  assert.equal(check.ok, true);

  // A brand-new test file whose markers were not in the baseline is flagged.
  writeFileSync(join(dir, 'tests', 'test_a.mjs'), baselineText);
  writeFileSync(join(dir, 'tests', 'test_new.mjs'), "test.todo('later');\n");
  check = checkTestIntegrity(['tests'], before, { cwd: dir });
  assert.equal(check.ok, false);
  assert.deepEqual(check.new_markers, [{ file: 'tests/test_new.mjs', text: "test.todo('later');" }]);

  // Removing the new file restores ok; deleting a baseline test file is flagged.
  rmSync(join(dir, 'tests', 'test_new.mjs'));
  check = checkTestIntegrity(['tests'], before, { cwd: dir });
  assert.equal(check.ok, true);
  rmSync(join(dir, 'tests', 'test_a.mjs'));
  check = checkTestIntegrity(['tests'], before, { cwd: dir });
  assert.equal(check.ok, false);
  assert.deepEqual(check.deleted_files, ['tests/test_a.mjs']);
});

test('test suppression markers: option and decorator forms recognized', t => {
  const dir = workdir(t);
  mkdirSync(join(dir, 'tests'));
  writeFileSync(join(dir, 'tests', 'shapes.mjs'), [
    "test('opt', { skip: true }, () => {});",
    "test('plain', () => {});",
    "const config = { mode: 'skip' };",
  ].join('\n'));
  writeFileSync(join(dir, 'tests', 'test_py.py'), [
    'import unittest',
    '',
    '@unittest.skip("not ready")',
    'class T(unittest.TestCase):',
    '    pass',
  ].join('\n'));
  const snapshot = snapshotTestIntegrity(['tests'], { cwd: dir });
  assert.deepEqual(snapshot.files['tests/shapes.mjs'], ["test('opt', { skip: true }, () => {});"]);
  assert.ok(!snapshot.files['tests/shapes.mjs'].includes("const config = { mode: 'skip' };"));
  assert.deepEqual(snapshot.files['tests/test_py.py'], ['@unittest.skip("not ready")']);
});
