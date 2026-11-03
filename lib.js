import Parser from 'tree-sitter';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, relative, sep, basename, resolve } from 'path';
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';
import Python from 'tree-sitter-python';
import Rust from 'tree-sitter-rust';
import Go from 'tree-sitter-go';
import C from 'tree-sitter-c';
import Cpp from 'tree-sitter-cpp';
import Java from 'tree-sitter-java';
import CSharp from 'tree-sitter-c-sharp';
import Ruby from 'tree-sitter-ruby';
import PHP from 'tree-sitter-php';
import JSONParser from 'tree-sitter-json';
import { extractEntities } from './analyzer.js';
import { formatUltraCompact } from './compact-formatter.js';
import { buildDependencyGraph, isBuiltin } from './dependency-analyzer.js';
import { detectDuplication, detectCircularDeps } from './advanced-metrics.js';
import { buildIgnoreMatcher } from './ignore-parser.js';

const LANGUAGES = {
  '.js': { parser: JavaScript, name: 'JavaScript' },
  '.mjs': { parser: JavaScript, name: 'JavaScript' },
  '.cjs': { parser: JavaScript, name: 'JavaScript' },
  '.jsx': { parser: JavaScript, name: 'JSX' },
  '.ts': { parser: TypeScript.typescript, name: 'TypeScript' },
  '.tsx': { parser: TypeScript.tsx, name: 'TSX' },
  '.py': { parser: Python, name: 'Python' },
  '.rs': { parser: Rust, name: 'Rust' },
  '.go': { parser: Go, name: 'Go' },
  '.c': { parser: C, name: 'C' },
  '.h': { parser: C, name: 'C' },
  '.cpp': { parser: Cpp, name: 'C++' },
  '.cc': { parser: Cpp, name: 'C++' },
  '.cxx': { parser: Cpp, name: 'C++' },
  '.hpp': { parser: Cpp, name: 'C++' },
  '.java': { parser: Java, name: 'Java' },
  '.cs': { parser: CSharp, name: 'C#' },
  '.rb': { parser: Ruby, name: 'Ruby' },
  '.php': { parser: PHP, name: 'PHP' },
  '.json': { parser: JSONParser, name: 'JSON', data: true }
};

const MAX_FILE_SIZE = 200 * 1024;
const MAX_FILES = 8000;
const PARSE_CHUNK = 8192;
const ENTRY_NAMES = new Set(['index', 'main', 'app', 'server', 'cli', 'lib', 'bin', '__main__', '__init__']);
const TEST_PATH = /(^|\/)(tests?|__tests__|specs?)\/|(^|[\/._-])(test|tests|spec|specs|verify)([._-]|$)|\.(test|spec)\./;
const CONFIG_PATH = /(^|\/)\.[^/]*$|\.config\.|(^|[\/._-])config\.(js|ts|mjs|cjs)$/;
const README_NAMES = ['README.md', 'readme.md', 'README.txt', 'README'];

function getLanguage(filepath) {
  return LANGUAGES[extname(filepath)];
}

function isSeparateProject(dir) {
  return existsSync(join(dir, 'pyvenv.cfg')) || existsSync(join(dir, '.git'));
}

function* walkDir(dir, baseDir, ignore) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    const relativePath = relative(baseDir, fullPath).split(sep).join('/');
    const isDir = entry.isDirectory();

    if (ignore.ignores(relativePath, isDir)) continue;

    if (isDir) {
      if (!isSeparateProject(fullPath)) yield* walkDir(fullPath, baseDir, ignore.enter(fullPath, relativePath));
    } else if (entry.isFile()) {
      const lang = getLanguage(entry.name);
      if (!lang) continue;
      try {
        if (statSync(fullPath).size <= MAX_FILE_SIZE) yield { path: fullPath, relativePath, lang };
      } catch {}
    }
  }
}

function projectType(pkg) {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (['next', 'react', 'vite'].some(name => name in deps)) return 'web-app';
  if ('express' in deps) return 'server';
  if (pkg.bin) return 'cli';
  if (pkg.main || pkg.exports) return 'library';
  return null;
}

function normalizeBin(pkg) {
  if (!pkg.bin) return {};
  return typeof pkg.bin === 'string' ? { [pkg.name]: pkg.bin } : pkg.bin;
}

function firstParagraph(text) {
  const paragraph = text.split(/\n\s*\n/).map(part => part.trim()).find(part => part && !part.startsWith('#') && !part.startsWith('```'));
  return paragraph ? paragraph.replace(/\s+/g, ' ').slice(0, 160) : null;
}

function analyzeProjectContext(rootPath) {
  const project = {
    name: basename(resolve(rootPath)),
    version: null,
    description: null,
    type: null,
    moduleType: null,
    bin: {},
    main: null,
    scripts: {},
    dependencies: {},
    testScript: null,
    readme: null
  };

  const packagePath = join(rootPath, 'package.json');
  if (existsSync(packagePath)) {
    try {
      const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
      Object.assign(project, {
        name: pkg.name ?? project.name,
        version: pkg.version ?? null,
        description: pkg.description ?? null,
        type: projectType(pkg),
        moduleType: pkg.type === 'module' ? 'ESM' : 'CJS',
        bin: normalizeBin(pkg),
        main: pkg.main ?? null,
        scripts: pkg.scripts ?? {},
        dependencies: pkg.dependencies ?? {},
        testScript: pkg.scripts?.test ?? null
      });
    } catch {}
  }

  const readmePath = README_NAMES.map(name => join(rootPath, name)).find(existsSync);
  if (readmePath) project.readme = firstParagraph(readFileSync(readmePath, 'utf8'));

  return project;
}

function addToSet(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

function normalizePath(path) {
  return path.replace(/^\.\//, '');
}

function stemOf(path) {
  return basename(path).replace(/\.[^.]+$/, '');
}

function entryPathsOf(project, nodes) {
  const declared = new Set([...Object.values(project.bin), project.main].filter(Boolean).map(normalizePath));
  return new Set([...nodes.keys()].filter(path => declared.has(path) || ENTRY_NAMES.has(stemOf(path))));
}

function rootsOf(project, nodes, codePaths) {
  const bins = Object.values(project.bin).map(normalizePath).filter(path => nodes.has(path));
  const consumers = [...nodes.values()]
    .filter(node => codePaths.has(node.path) && node.importedBy.size === 0 && node.importsFrom.size > 0 && !TEST_PATH.test(node.path))
    .sort((a, b) => b.importsFrom.size - a.importsFrom.size || a.path.localeCompare(b.path))
    .map(node => node.path);
  const roots = [...new Set([...bins, ...consumers])];
  if (roots.length > 0) return roots.slice(0, 3);
  return [...nodes.values()]
    .filter(node => codePaths.has(node.path))
    .sort((a, b) => b.importsFrom.size - a.importsFrom.size || a.path.localeCompare(b.path))
    .slice(0, 1)
    .map(node => node.path);
}

function deadCodeOf(code, nodes, entryPaths) {
  const deadCode = { tests: [], unusedExports: [], orphans: [] };
  for (const file of code) {
    const node = nodes.get(file.path);
    if (TEST_PATH.test(file.path)) {
      deadCode.tests.push(file.path);
      continue;
    }
    if (entryPaths.has(file.path) || CONFIG_PATH.test(file.path) || node.importedBy.size > 0) continue;
    if (node.exportedNames.size > 0) deadCode.unusedExports.push({ file: file.path, names: [...node.exportedNames] });
    if (node.importsFrom.size === 0) deadCode.orphans.push(file.path);
  }
  return deadCode;
}

function callGraphOf(code) {
  const declared = new Map();
  for (const file of code) {
    for (const fn of file.entities.functions) {
      if (fn.name) addToSet(declared, fn.name, file.path);
    }
  }

  const labelOf = (name, file) => (declared.get(name).size > 1 ? `${basename(file)}:${name}` : name);
  const callees = new Map();
  const callers = new Map();

  for (const file of code) {
    for (const [caller, names] of file.entities.calls) {
      const from = labelOf(caller, file.path);
      for (const callee of names) {
        const owners = declared.get(callee);
        if (!owners || owners.size !== 1 || callee === caller) continue;
        addToSet(callees, from, callee);
        addToSet(callers, callee, from);
      }
    }
  }

  return { callees, callers };
}

function symbolsOf(code) {
  const declared = new Set();
  for (const file of code) {
    for (const fn of file.entities.functions) if (fn.name) declared.add(fn.name);
    for (const cls of file.entities.classes) declared.add(cls.name);
    for (const name of file.entities.constants) declared.add(name);
  }
  const counts = new Map();
  for (const file of code) {
    for (const [identifier, count] of file.entities.identifiers) {
      if (declared.has(identifier)) counts.set(identifier, (counts.get(identifier) || 0) + count);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10);
}

function ioOf(files) {
  const io = {
    envVars: new Set(),
    urls: new Set(),
    routes: new Set(),
    fetches: 0,
    axios: 0,
    sql: 0,
    fileOps: 0,
    json: 0,
    emitters: 0,
    listeners: 0
  };
  for (const { entities } of files) {
    for (const name of entities.envVars) io.envVars.add(name);
    for (const url of entities.urls) io.urls.add(url);
    for (const route of entities.routes) io.routes.add(route);
    io.fetches += entities.http.fetches;
    io.axios += entities.http.axios;
    io.sql += entities.storage.sql;
    io.fileOps += entities.storage.fileOps;
    io.json += entities.storage.json;
    io.emitters += entities.events.emitters;
    io.listeners += entities.events.listeners;
  }
  return io;
}

function patternsOf(code) {
  const patterns = { async: 0, await: 0, promise: 0, thenCatch: 0, tryCatch: 0, throws: 0, errorTypes: new Set(), constants: new Set(), globals: new Set() };
  for (const { entities } of code) {
    for (const key of ['async', 'await', 'promise', 'thenCatch', 'tryCatch', 'throws']) {
      patterns[key] += entities.patterns[key];
    }
    for (const type of entities.patterns.errorTypes) patterns.errorTypes.add(type);
    for (const name of entities.constants) patterns.constants.add(name);
    for (const name of entities.globals) patterns.globals.add(name);
  }
  return patterns;
}

function languagesOf(code) {
  const totals = new Map();
  for (const file of code) totals.set(file.lang, (totals.get(file.lang) || 0) + file.entities.lines);
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

function externalsOf(code, nodes) {
  const packages = new Map();
  const builtins = new Set();
  for (const file of code) {
    for (const name of nodes.get(file.path).externals) {
      if (isBuiltin(name)) builtins.add(name);
      else addToSet(packages, name, file.path);
    }
  }
  return { packages, builtins };
}

function analyzeCodebase(rootPath = '.') {
  const parser = new Parser();
  const project = analyzeProjectContext(rootPath);
  const ignore = buildIgnoreMatcher(rootPath);
  const files = [];
  const errors = [];

  let truncated = false;
  for (const { path, relativePath, lang } of walkDir(rootPath, rootPath, ignore)) {
    if (files.length >= MAX_FILES) {
      truncated = true;
      break;
    }
    try {
      parser.setLanguage(lang.parser);
      const source = readFileSync(path, 'utf8');
      const tree = parser.parse((index) => source.slice(index, index + PARSE_CHUNK));
      const entities = extractEntities(tree, source);
      files.push({
        path: relativePath,
        lang: lang.name,
        data: lang.data === true,
        entities,
        deps: entities.deps
      });
    } catch (e) {
      errors.push({ file: relativePath, error: e.message });
    }
  }

  const code = files.filter(file => !file.data);
  const codePaths = new Set(code.map(file => file.path));
  const nodes = buildDependencyGraph(Object.fromEntries(files.map(file => [file.path, file.deps])));
  const entryPaths = entryPathsOf(project, nodes);
  const functions = code.flatMap(file => file.entities.functions.map(fn => ({ ...fn, file: file.path })));
  const classes = code.reduce((sum, file) => sum + file.entities.classes.length, 0);
  const complexity = code.reduce((sum, file) => sum + file.entities.complexity, 0);
  const lines = code.reduce((sum, file) => sum + file.entities.lines, 0);

  return {
    project,
    stats: { files: code.length, lines, functions: functions.length, classes, complexity, languages: languagesOf(code) },
    files: code.map(file => ({ path: file.path, lang: file.lang, lines: file.entities.lines })),
    functions,
    nodes,
    roots: rootsOf(project, nodes, codePaths),
    entryPaths,
    cycles: detectCircularDeps(nodes),
    duplicates: detectDuplication(functions.filter(fn => fn.hash && fn.name)),
    calls: callGraphOf(code),
    deadCode: deadCodeOf(code, nodes, entryPaths),
    externals: externalsOf(code, nodes),
    io: ioOf(files),
    patterns: patternsOf(code),
    symbols: symbolsOf(code),
    errors,
    scan: { truncated, limit: MAX_FILES }
  };
}

export function analyze(rootPath = '.', options = {}) {
  return formatUltraCompact(analyzeCodebase(rootPath), options);
}

export { analyzeCodebase, formatUltraCompact };
