#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repoDir = dirname(fileURLToPath(import.meta.url));

const fileText = (...rows) => `${rows.join('\n')}\n`;

const fixtureFiles = {
  'package.json': '{"name":"fixture-app","version":"1.2.3","description":"Demo app","type":"module","bin":{"fixture":"src/cli.js"},"scripts":{"start":"node src/cli.js"},"dependencies":{"left-pad":"^1.3.0","tree-sitter":"^0.21.1"}}\n',
  'package-lock.json': '{"lockfileVersion":3}\n',
  '.gitignore': 'runs/\n',
  'runs/x/body.mjs': 'export function body() { return 0; }\n',
  'src/cli.js': fileText(
    "import { run } from './app.js';",
    "import fs from 'fs';",
    "export function main() { return run(fs.readdirSync('.').length); }",
  ),
  'src/app.js': fileText(
    "import { helper } from './helpers.js';",
    "import leftPad from 'left-pad';",
    "export const VERSION = '1.0.0';",
    "export function run(n) { const url = 'https://api.example.com/v1/items'; return helper(n) + url.length; }",
    'export function unusedHelper() { return process.env.API_KEY; }',
  ),
  'src/helpers.js': fileText(
    'export function helper(n) { return n * 2; }',
    "export function ping() { return fetch('/ping'); }",
  ),
  'src/a.js': fileText(
    "import { fb } from './b.js';",
    'export function fa() { return fb(); }',
  ),
  'src/b.js': fileText(
    "import { fa } from './a.js';",
    'export function fb() { return fa(); }',
  ),
  'src/unused.js': 'export function neverImported() { return 1; }\n',
  'src/orphan.js': fileText(
    'const ORPHAN_LIMIT = 5;',
    'export const ORPHAN = ORPHAN_LIMIT;',
  ),
  'src/tool.py': fileText(
    'import os',
    'from src.helpers import helper',
    '',
    'class Tool:',
    '    def execute(self):',
    '        return helper(1)',
    '',
    'def go():',
    "    return os.getenv('HOME')",
  ),
  'test/app.test.js': fileText(
    "import { run } from '../src/app.js';",
    'export function testRun() { return run(1); }',
  ),
  'db.js': fileText(
    "export function load(db) { return db.query('SELECT * FROM users WHERE id = ?'); }",
    "export const note = 'select a color';",
  ),
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

const headerOf = (out) => {
  const all = out.split('\n');
  const end = all.findIndex((line) => line.startsWith('## '));
  return end === -1 ? all : all.slice(0, end);
};

const sectionOf = (out, name) => {
  const all = out.split('\n');
  const start = all.findIndex((line) => line.trimEnd() === `## ${name}`);
  assert(start !== -1, `output has a "## ${name}" section`);
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).filter((line) => line.length > 0);
};

const lineStarting = (lines, prefix) => lines.find((line) => line.startsWith(prefix));

const statsOf = (out) => {
  const line = out.split('\n').find((l) => l.includes(' files · '));
  assert(line !== undefined, 'output has a stats line like "N files · K lines · ..."');
  return line;
};

function buildTests(dir) {
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });
  const cache = {};

  const cli = (args) => {
    const result = spawnSync(process.execPath, ['index.js', ...args], {
      cwd: repoDir,
      encoding: 'utf8',
      timeout: 60000,
    });
    assert(
      result.status === 0,
      `node index.js ${args.join(' ')} exits 0 (status ${result.status}, stderr: ${String(result.stderr).trim().slice(0, 300)})`,
    );
    return result.stdout;
  };
  const full = () => (cache.full ??= cli([dir]));
  const budgeted = () => (cache.budgeted ??= cli([dir, '--budget', '400']));

  test('line 1 is the package header', () => {
    const first = full().split('\n')[0];
    assert(first === '# fixture-app 1.2.3 (cli, ESM)', `line 1 is "# fixture-app 1.2.3 (cli, ESM)" (got "${first}")`);
  });

  test('header lists bin and scripts before the sections', () => {
    const header = headerOf(full());
    assert(header.includes('bin: fixture'), 'header has a "bin: fixture" line');
    assert(header.includes('scripts: start=node src/cli.js'), 'header has a "scripts: start=node src/cli.js" line');
  });

  test('architecture tree roots at src/cli.js with app and helpers nested under it', () => {
    const arch = sectionOf(full(), 'Architecture');
    const roots = arch.filter((line) => !line.startsWith(' '));
    assert(roots[0] === 'src/cli.js(main)', `first root line is "src/cli.js(main)" (got "${roots[0]}")`);
    const cliAt = arch.indexOf('src/cli.js(main)');
    const appAt = arch.indexOf('  src/app.js(VERSION, run, unusedHelper)');
    assert(appAt > cliAt, 'child line "  src/app.js(VERSION, run, unusedHelper)" appears under src/cli.js');
    const helpersAt = arch.indexOf('    src/helpers.js(helper, ping)');
    assert(helpersAt > appAt, 'child line "    src/helpers.js(helper, ping)" appears under src/app.js');
  });

  test('stats line counts 10 files and 12 functions', () => {
    const stats = statsOf(full());
    assert(stats.startsWith('10 files'), `stats line starts with "10 files" (got "${stats}")`);
    assert(stats.includes('12 fn'), `stats line contains "12 fn" (got "${stats}")`);
  });

  test('issues name the a.js and b.js cycle', () => {
    const issues = sectionOf(full(), 'Issues');
    assert(
      issues.some((line) => /cycle/i.test(line) && line.includes('src/a.js') && line.includes('src/b.js')),
      'Issues has a cycle line naming src/a.js and src/b.js',
    );
  });

  test('dead code lists unused exports and orphans without the test file', () => {
    const dead = sectionOf(full(), 'Dead code');
    const unused = lineStarting(dead, 'unused exports:');
    assert(unused !== undefined, 'Dead code has an "unused exports:" line');
    for (const entry of ['src/unused.js(neverImported)', 'src/orphan.js(ORPHAN)', 'src/tool.py(Tool, go)', 'db.js(load, note)']) {
      assert(unused.includes(entry), `unused exports name ${entry}`);
    }
    const orphans = lineStarting(dead, 'orphans:');
    assert(orphans !== undefined && orphans.includes('src/orphan.js'), 'Dead code has an "orphans:" line naming src/orphan.js');
    assert(!dead.some((line) => line.includes('app.test')), 'Dead code does not name test/app.test.js');
  });

  test('URL is printed whole', () => {
    assert(full().includes('https://api.example.com/v1/items'), 'output contains the full URL https://api.example.com/v1/items');
  });

  test('I/O reports exactly one sql query and both env vars', () => {
    const io = sectionOf(full(), 'I/O');
    const storage = lineStarting(io, 'storage:');
    assert(storage !== undefined && /(^|[\s,;])sql×1(?!\d)/.test(storage), `storage line has "sql×1" (got "${storage}")`);
    const env = lineStarting(io, 'env:');
    assert(env !== undefined && env.includes('API_KEY') && env.includes('HOME'), `env line names API_KEY and HOME (got "${env}")`);
  });

  test('calls include main to run, run to helper, fa to fb and execute to helper', () => {
    const calls = sectionOf(full(), 'Calls');
    for (const edge of ['main → run', 'run → helper', 'fa → fb', 'execute → helper']) {
      assert(calls.some((line) => line.includes(edge)), `Calls include "${edge}"`);
    }
  });

  test('dependencies list external, builtins and unused deps', () => {
    const deps = sectionOf(full(), 'Dependencies');
    const external = lineStarting(deps, 'external:');
    assert(external !== undefined && external.includes('left-pad×1'), `external line includes left-pad×1 (got "${external}")`);
    const builtins = lineStarting(deps, 'builtins:');
    assert(builtins !== undefined && /\bfs\b/.test(builtins), `builtins line includes fs (got "${builtins}")`);
    const unused = lineStarting(deps, 'unused deps:');
    assert(unused !== undefined && unused.includes('tree-sitter'), `unused deps line includes tree-sitter (got "${unused}")`);
  });

  test('runs/, body and package-lock stay out of the output', () => {
    const out = full();
    assert(!out.includes('runs/'), 'output does not contain runs/');
    assert(!out.includes('body'), 'output does not contain body');
    assert(!out.includes('package-lock'), 'output does not contain package-lock');
  });

  test('output ends with a legend line', () => {
    const last = full().trimEnd().split('\n').pop();
    assert(last.startsWith('legend:'), `last line starts with "legend:" (got "${last}")`);
  });

  test('budget 400 keeps output within 400 characters and starts with the header', () => {
    const out = budgeted().trimEnd();
    assert(out.length <= 400, `budgeted output is at most 400 characters (got ${out.length})`);
    assert(out.startsWith('# fixture-app'), 'budgeted output starts with "# fixture-app"');
  });

  test('output without a budget includes the Dependencies section', () => {
    assert(full().includes('## Dependencies'), 'output includes "## Dependencies"');
  });

  test('stats line reports JS and Py shares', () => {
    const stats = statsOf(full());
    assert(/JS \d+% · Py \d+%/.test(stats), `stats line has JS and Py percentages (got "${stats}")`);
  });

  return tests;
}

async function runTests(dir) {
  console.log('🧪 Running overview verification tests...\n');

  let passed = 0;
  let failed = 0;

  for (const { name, fn } of buildTests(dir)) {
    try {
      await Promise.resolve(fn());
      console.log(`✅ ${name}`);
      passed++;
    } catch (e) {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  return failed;
}

function writeFixture(dir) {
  for (const [relativePath, content] of Object.entries(fixtureFiles)) {
    const target = join(dir, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'thorns-overview-'));
  let failed = 0;
  try {
    writeFixture(dir);
    failed = await runTests(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exitCode = 1;
});
