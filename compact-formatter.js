const DEFAULT_BUDGET = 3000;
const MAX_DEPTH = 4;
const CHILD_LIMIT = 6;
const LEGEND = 'legend: ×n occurrences · ↺ already shown · cx avg complexity · fn functions · cls classes · +n more';
const LANGUAGE_NAMES = {
  JavaScript: 'JS', JSX: 'JSX', TypeScript: 'TS', TSX: 'TSX', Python: 'Py', Rust: 'Rs', Go: 'Go',
  Java: 'Java', 'C#': 'C#', 'C++': 'C++', C: 'C', Ruby: 'Rb', PHP: 'PHP'
};

export function formatUltraCompact(overview, { budget = DEFAULT_BUDGET } = {}) {
  const sections = [
    ['Architecture', architectureLines(overview)],
    ['Issues', issueLines(overview)],
    ['Dead code', deadCodeLines(overview)],
    ['Calls', callLines(overview)],
    ['Dependencies', dependencyLines(overview)],
    ['I/O', ioLines(overview)],
    ['Patterns', patternLines(overview)],
    ['Core symbols', symbolLines(overview)]
  ];
  return assemble(headerLines(overview), sections, budget > 0 ? budget : Infinity);
}

function assemble(header, sections, limit) {
  const blocks = [header.join('\n')];
  let used = blocks[0].length;
  for (const [title, lines] of sections) {
    const block = fitSection(title, lines, limit - used - 2);
    if (block) {
      blocks.push(block);
      used += block.length + 2;
    }
  }
  if (used + LEGEND.length + 2 <= limit) blocks.push(LEGEND);
  return blocks.join('\n\n');
}

function fitSection(title, lines, remaining) {
  let block = `## ${title}`;
  if (block.length > remaining) return '';
  for (const line of lines) {
    const next = `${block}\n${line}`;
    if (next.length > remaining) break;
    block = next;
  }
  return block.includes('\n') ? block : '';
}

function more(total, shown) {
  return total > shown ? ` +${total - shown}` : '';
}

function listed(items, limit) {
  const list = [...items];
  return list.slice(0, limit).join(', ') + more(list.length, limit);
}

function k(num) {
  return num >= 1000 ? `${(num / 1000).toFixed(1)}k` : num;
}

function headerLines({ project, stats, deadCode }) {
  const tags = [project.type, project.moduleType].filter(Boolean);
  const title = `# ${project.name}${project.version ? ` ${project.version}` : ''}${tags.length ? ` (${tags.join(', ')})` : ''}`;
  const lines = [title];

  const description = project.description ?? project.readme;
  if (description) lines.push(description.slice(0, 160));

  const bins = Object.keys(project.bin);
  if (bins.length) lines.push(`bin: ${bins.join(', ')}`);

  const scripts = Object.entries(project.scripts).slice(0, 3).map(([name, command]) => `${name}=${String(command).slice(0, 50)}`);
  if (scripts.length) lines.push(`scripts: ${scripts.join(' · ')}`);

  const tests = deadCode.tests.slice(0, 3).join(', ') + more(deadCode.tests.length, 3);
  lines.push(`tests: ${tests || 'none'}${project.testScript ? '' : ' (no test script)'}`);
  lines.push(statsLine(stats));
  return lines;
}

function statsLine(stats) {
  const total = stats.languages.reduce((sum, [, lines]) => sum + lines, 0) || 1;
  const shares = stats.languages.slice(0, 3).map(([lang, lines]) => `${LANGUAGE_NAMES[lang] ?? lang} ${Math.round(lines / total * 100)}%`);
  const complexity = stats.functions ? (stats.complexity / stats.functions).toFixed(1) : '0';
  return [`${stats.files} files`, `${k(stats.lines)} lines`, `${stats.functions} fn`, `${stats.classes} cls`, `cx ${complexity}`, ...shares].join(' · ');
}

function architectureLines({ nodes, roots }) {
  const lines = [];
  const shown = new Set();

  const walk = (path, depth) => {
    const node = nodes.get(path);
    const revisit = shown.has(path);
    const exported = [...node.exportedNames];
    const names = exported.length ? `(${exported.slice(0, 3).join(', ')}${more(exported.length, 3)})` : '';
    lines.push(`${'  '.repeat(depth)}${path}${names}${revisit ? ' ↺' : ''}`);
    if (revisit || depth >= MAX_DEPTH) return;
    shown.add(path);
    const children = [...node.importsFrom].sort((a, b) => nodes.get(b).importsFrom.size - nodes.get(a).importsFrom.size || a.localeCompare(b));
    for (const child of children.slice(0, CHILD_LIMIT)) walk(child, depth + 1);
    if (children.length > CHILD_LIMIT) lines.push(`${'  '.repeat(depth + 1)}+${children.length - CHILD_LIMIT} more`);
  };

  for (const root of roots) walk(root, 0);
  return lines;
}

function issueLines({ cycles, functions, files, duplicates, errors, scan }) {
  const lines = [];
  if (scan.truncated) lines.push(`scan: stopped at ${scan.limit} files, the rest was not read`);
  if (cycles.length) {
    lines.push(`cycles: ${cycles.slice(0, 2).map(cycle => cycle.join(' → ')).join(' | ')}${more(cycles.length, 2)}`);
  }
  const complex = functions.filter(fn => fn.name && fn.lines >= 80).sort((a, b) => b.lines - a.lines);
  if (complex.length) {
    lines.push(`complex: ${complex.slice(0, 3).map(fn => `${fn.file}:${fn.startLine} ${fn.name} (${fn.lines}L)`).join(', ')}${more(complex.length, 3)}`);
  }
  const large = files.filter(file => file.lines >= 400).sort((a, b) => b.lines - a.lines);
  if (large.length) {
    lines.push(`large: ${large.slice(0, 3).map(file => `${file.path} (${file.lines}L)`).join(', ')}${more(large.length, 3)}`);
  }
  const params = functions.filter(fn => fn.name && fn.params >= 6).sort((a, b) => b.params - a.params);
  if (params.length) {
    lines.push(`params: ${params.slice(0, 3).map(fn => `${fn.file}:${fn.startLine} ${fn.name} (${fn.params})`).join(', ')}${more(params.length, 3)}`);
  }
  if (duplicates.length) {
    lines.push(`duplicates: ${duplicates.slice(0, 2).map(group => `${group[0].name}×${group.length} (${[...new Set(group.map(fn => fn.file))].join(', ')})`).join(' | ')}`);
  }
  if (errors.length) lines.push(`parse errors: ${errors.length} (${errors[0].file}: ${errors[0].error})`);
  return lines;
}

function deadCodeLines({ deadCode }) {
  const lines = [];
  if (deadCode.unusedExports.length) {
    const items = deadCode.unusedExports.slice(0, 6).map(({ file, names }) => `${file}(${names.slice(0, 3).join(', ')}${more(names.length, 3)})`);
    lines.push(`unused exports: ${items.join(', ')}${more(deadCode.unusedExports.length, 6)}`);
  }
  if (deadCode.orphans.length) lines.push(`orphans: ${deadCode.orphans.slice(0, 8).join(', ')}${more(deadCode.orphans.length, 8)}`);
  return lines;
}

function callLines({ calls }) {
  const lines = [];
  const rows = [...calls.callees]
    .map(([caller, callees]) => [caller, [...callees]])
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  for (const [caller, callees] of rows.slice(0, 5)) {
    lines.push(`${caller} → ${callees.slice(0, 5).join(', ')}${more(callees.length, 5)}`);
  }
  const hot = [...calls.callers]
    .filter(([, callers]) => callers.size >= 2)
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
    .slice(0, 4);
  if (hot.length) lines.push(`most called: ${hot.map(([name, callers]) => `${name}×${callers.size}`).join(', ')}`);
  return lines;
}

function packageSummary(packages) {
  const names = [...packages.keys()];
  const families = names.filter(name => names.filter(other => other.startsWith(`${name}-`)).length >= 2);
  const familyMembers = names.filter(name => families.some(root => name.startsWith(`${root}-`)));
  const entries = names
    .filter(name => !familyMembers.includes(name))
    .map(name => ({ name, label: `${name}×${packages.get(name).size}`, weight: packages.get(name).size }));
  for (const root of families) {
    const members = names.filter(name => name.startsWith(`${root}-`));
    const files = new Set(members.flatMap(name => [...packages.get(name)]));
    entries.push({ name: root, label: `${root}-*×${members.length}`, weight: files.size });
  }
  return entries.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name)).map(entry => entry.label);
}

function distinctUrls(urls) {
  const bases = [...urls].map(url => url.replace(/\.git$/, '').replace(/#.*$/, '')).sort((a, b) => a.length - b.length);
  const kept = [];
  for (const url of bases) {
    if (!kept.some(base => url.startsWith(`${base}/`) && pathSegments(base) >= 2)) kept.push(url);
  }
  return [...new Set(kept)];
}

function pathSegments(url) {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).length;
  } catch {
    return 0;
  }
}

function dependencyLines({ externals, project }) {
  const lines = [];
  const summary = packageSummary(externals.packages);
  if (summary.length) lines.push(`external: ${summary.slice(0, 8).join(', ')}${more(summary.length, 8)}`);
  if (externals.builtins.size) lines.push(`builtins: ${[...externals.builtins].sort().join(', ')}`);
  const used = new Set(externals.packages.keys());
  const unused = Object.keys(project.dependencies).filter(name => !used.has(name));
  if (unused.length) lines.push(`unused deps: ${unused.join(', ')}`);
  return lines;
}

function ioLines({ io }) {
  const lines = [];
  if (io.envVars.size) lines.push(`env: ${listed(io.envVars, 8)}`);
  const urls = distinctUrls(io.urls);
  if (urls.length) lines.push(`urls: ${urls.slice(0, 3).join(', ')}${more(urls.length, 3)}`);
  const http = [
    io.fetches && `fetch×${io.fetches}`,
    io.axios && `axios×${io.axios}`,
    io.routes.size && `routes ${listed(io.routes, 4)}`
  ].filter(Boolean);
  if (http.length) lines.push(`http: ${http.join(', ')}`);
  const storage = [io.sql && `sql×${io.sql}`, io.fileOps && `files×${io.fileOps}`, io.json && `json×${io.json}`].filter(Boolean);
  if (storage.length) lines.push(`storage: ${storage.join(', ')}`);
  const events = [io.listeners && `listen×${io.listeners}`, io.emitters && `emit×${io.emitters}`].filter(Boolean);
  if (events.length) lines.push(`events: ${events.join(', ')}`);
  return lines;
}

function patternLines({ patterns }) {
  const lines = [];
  const asynchrony = [
    ['async', patterns.async],
    ['await', patterns.await],
    ['promise', patterns.promise],
    ['then/catch', patterns.thenCatch]
  ].filter(([, count]) => count > 0).map(([label, count]) => `${label}×${count}`);
  if (asynchrony.length) lines.push(`async: ${asynchrony.join(', ')}`);

  const errors = [['try', patterns.tryCatch], ['throw', patterns.throws]]
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label}×${count}`);
  if (patterns.errorTypes.size) errors.push(listed(patterns.errorTypes, 4));
  if (errors.length) lines.push(`errors: ${errors.join(', ')}`);

  if (patterns.constants.size) lines.push(`constants: ${listed(patterns.constants, 6)}`);
  if (patterns.globals.size) lines.push(`globals: ${listed(patterns.globals, 6)}`);
  return lines;
}

function symbolLines({ symbols }) {
  if (symbols.length === 0) return [];
  return [`core: ${symbols.slice(0, 8).map(([name, count]) => `${name}×${count}`).join(', ')}`];
}
