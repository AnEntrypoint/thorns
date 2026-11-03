import assert from 'assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildIgnoreMatcher, createIgnoreMatcher, loadProjectRules } from './ignore-parser.js';
import { analyzeCodebase } from './lib.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`❌ ${name}: ${e.message}`);
  }
}

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'thorns-ignore-'));
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

const project = text => createIgnoreMatcher(loadProjectRules(fixture({ '.gitignore': text })));
const defaults = buildIgnoreMatcher(fixture({}));

test('gitignore glob with a star ignores matching files at any depth', () => {
  const m = project('*.min.js\n');
  assert.ok(m.ignores('src/app.min.js'));
  assert.ok(!m.ignores('src/app.js'));
});

test('leading slash anchors a pattern to the project root', () => {
  const m = project('/dist\n');
  assert.ok(m.ignores('dist/a.js'));
  assert.ok(!m.ignores('src/dist/a.js'));
});

test('a pattern with a slash in the middle is anchored', () => {
  const m = project('build/out\n');
  assert.ok(m.ignores('build/out/a.js'));
  assert.ok(!m.ignores('x/build/out/a.js'));
});

test('double star before a name matches at any depth', () => {
  const m = project('**/foo\n');
  assert.ok(m.ignores('foo'));
  assert.ok(m.ignores('a/b/foo'));
});

test('trailing slash matches directories only', () => {
  const m = project('cache/\n');
  assert.ok(m.ignores('cache', true));
  assert.ok(!m.ignores('cache', false));
});

test('a later negation re-includes a file', () => {
  const m = project('*.log\n!keep.log\n');
  assert.ok(m.ignores('x.log'));
  assert.ok(!m.ignores('keep.log'));
});

test('a negation cannot re-include a file inside an excluded directory', () => {
  const m = project('secret/\n!secret/open.js\n');
  assert.ok(m.ignores('secret/open.js'));
});

test('bracket classes match case variants', () => {
  const m = project('/[Dd]ebug/\n');
  assert.ok(m.ignores('Debug/x.cs'));
  assert.ok(!m.ignores('src/Debug/x.cs'));
});

test('a nested .gitignore applies only under its own directory', () => {
  const dir = fixture({ 'js/client/.gitignore': 'pkg/\n*.tmp\n' });
  const root = createIgnoreMatcher(loadProjectRules(dir));
  const nested = root.enter(join(dir, 'js', 'client'), 'js/client');
  assert.ok(nested.ignores('js/client/pkg/web.js'));
  assert.ok(nested.ignores('js/client/x.tmp'));
  assert.ok(!nested.ignores('other/x.tmp'));
  assert.ok(!root.ignores('js/client/pkg/web.js'));
});

test('project .npmignore is not applied, so src is not hidden by a publish list', () => {
  const dir = fixture({ '.npmignore': 'src/\n' });
  assert.ok(!buildIgnoreMatcher(dir).ignores('src/a.js'));
});

test('project .thornsignore is applied', () => {
  const dir = fixture({ '.thornsignore': 'gen/\n' });
  assert.ok(buildIgnoreMatcher(dir).ignores('gen/a.js'));
});

test('default ignores drop dependency, build and cache directories', () => {
  assert.ok(defaults.ignores('node_modules/x.js', true));
  assert.ok(defaults.ignores('vendor/x.go', true));
  assert.ok(defaults.ignores('dist/app.js', true));
  assert.ok(defaults.ignores('.config/x.js', true));
  assert.ok(defaults.ignores('src/app.min.js'));
  assert.ok(defaults.ignores('tests/fixtures/a.js', true));
});

test('default ignores keep source directories whose names are generic', () => {
  assert.ok(!defaults.ignores('bin/index.js'));
  assert.ok(!defaults.ignores('site/index.js'));
  assert.ok(!defaults.ignores('docs/app.js'));
  assert.ok(!defaults.ignores('static/app.js'));
  assert.ok(!defaults.ignores('storage/a.js'));
  assert.ok(!defaults.ignores('src/Debug/x.cs'));
  assert.ok(!defaults.ignores('src/artifacts/a.ts'));
  assert.ok(!defaults.ignores('scripts/release/build.mjs'));
});

test('default ignores keep .github and test files', () => {
  assert.ok(!defaults.ignores('.github/workflows/ci.mjs'));
  assert.ok(!defaults.ignores('src/app.test.js'));
  assert.ok(!defaults.ignores('src/app.spec.ts'));
});

test('default ignores keep LLM data directories that are source packages', () => {
  assert.ok(!defaults.ignores('src/embeddings/model.py'));
  assert.ok(defaults.ignores('embeddings/data.json', true));
});

test('nested git repositories and Python environments are skipped', () => {
  const dir = fixture({
    'src/a.js': 'export const a = 1;\n',
    'libs/x/.git': 'gitdir: ../../.git/modules/x\n',
    'libs/x/b.js': 'export const b = 2;\n',
    'envs/py/pyvenv.cfg': 'home = /usr\n',
    'envs/py/c.py': 'x = 1\n'
  });
  const paths = analyzeCodebase(dir).files.map(file => file.path);
  assert.ok(paths.includes('src/a.js'));
  assert.ok(!paths.includes('libs/x/b.js'));
  assert.ok(!paths.includes('envs/py/c.py'));
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
