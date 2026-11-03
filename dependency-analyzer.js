import { dirname, join, sep } from 'path';

const IMPORT_TYPES = new Set(['import_statement', 'import_from_statement', 'import_declaration', 'use_declaration', 'export_statement']);
const SOURCE_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.py', '.rs'];
const INDEX_FILES = ['index.js', 'index.ts', 'index.jsx', 'index.tsx', '__init__.py', 'mod.rs'];
const INDEX_NAMES = new Set(['index', '__init__', 'mod']);
const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'crypto', 'events', 'fs', 'http', 'https', 'net', 'os', 'path',
  'process', 'readline', 'stream', 'timers', 'tls', 'tty', 'url', 'util', 'worker_threads', 'zlib'
]);
const RUST_ITEM_TYPES = new Set(['function_item', 'struct_item', 'enum_item', 'trait_item']);
const EXPORT_TYPES = new Set([
  'export_statement', 'assignment_expression', 'function_definition', 'class_definition', 'function_declaration',
  ...RUST_ITEM_TYPES
]);

export function extractDependencies(tree, source) {
  const deps = { specifiers: new Set(), exportedNames: new Set() };

  function visit(node) {
    const type = node.type;
    if (IMPORT_TYPES.has(type)) {
      for (const specifier of specifiersOf(node, type)) deps.specifiers.add(specifier);
    }
    if (type === 'call_expression') {
      const callee = node.childForFieldName('function')?.text;
      if (callee === 'require' || callee === 'import') {
        for (const specifier of stringLiterals(node.childForFieldName('arguments'))) deps.specifiers.add(specifier);
      }
    }
    if (EXPORT_TYPES.has(type)) {
      for (const name of exportedNamesOf(node, type)) deps.exportedNames.add(name);
    }
    for (const child of node.children) visit(child);
  }

  visit(tree.rootNode);
  return deps;
}

export function buildDependencyGraph(fileAnalysis) {
  const nodes = new Map();
  for (const [path, data] of Object.entries(fileAnalysis)) {
    nodes.set(path, {
      path,
      specifiers: data.specifiers,
      exportedNames: data.exportedNames,
      importedBy: new Set(),
      importsFrom: new Set(),
      externals: new Set()
    });
  }

  const stems = indexByStem(Object.keys(fileAnalysis));
  for (const [path, node] of nodes) {
    for (const specifier of node.specifiers) {
      const target = resolveImport(specifier, dirname(path), fileAnalysis, stems);
      if (target && target !== path) {
        node.importsFrom.add(target);
        nodes.get(target).importedBy.add(path);
      } else if (!specifier.startsWith('.')) {
        node.externals.add(packageOf(specifier));
      }
    }
  }

  return nodes;
}

export function isBuiltin(name) {
  return name.startsWith('node:') || NODE_BUILTINS.has(name);
}

function packageOf(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  const parts = specifier.split('/');
  return parts[0].includes('.') ? parts.slice(0, 3).join('/') : parts[0];
}

function unquote(text) {
  return text.replace(/^['"`]|['"`]$/g, '');
}

function stringLiterals(node) {
  if (!node) return [];
  if (node.type === 'string' || node.type === 'interpreted_string_literal' || node.type === 'string_literal') {
    return [unquote(node.text)];
  }
  return node.children.flatMap(stringLiterals);
}

function specifiersOf(node, type) {
  switch (type) {
    case 'import_statement': {
      const source = node.childForFieldName('source');
      if (source) return [unquote(source.text)];
      return node.text.replace(/^import\s+/, '').split(',').map(part => pythonSpecifier(part.trim().split(/\s+as\s+/)[0]));
    }
    case 'import_from_statement':
      return [pythonSpecifier(node.childForFieldName('module_name')?.text ?? '')];
    case 'export_statement': {
      const source = node.childForFieldName('source');
      return source ? [unquote(source.text)] : [];
    }
    case 'import_declaration': {
      const literals = stringLiterals(node);
      return literals.length > 0 ? literals : [pythonSpecifier(node.text.replace(/^import\s+(static\s+)?/, '').replace(/;$/, ''))];
    }
    case 'use_declaration':
      return [rustSpecifier(node.text)];
    default:
      return [];
  }
}

function pythonSpecifier(dotted) {
  const level = dotted.length - dotted.replace(/^\.+/, '').length;
  const parts = dotted.slice(level).split('.').filter(Boolean).join('/');
  if (level === 0) return parts;
  const prefix = level === 1 ? './' : '../'.repeat(level - 1);
  return prefix + parts;
}

function rustSpecifier(text) {
  const path = text
    .replace(/^(pub\s+)?use\s+/, '')
    .replace(/;$/, '')
    .replace(/::\{.*$|::\*.*$|\{.*$/, '')
    .replace(/::$/, '');
  if (path.startsWith('crate::')) return path.slice('crate::'.length).split('::').join('/');
  if (path.startsWith('self::')) return './' + path.slice('self::'.length).split('::').join('/');
  if (path.startsWith('super::')) return '../' + path.slice('super::'.length).split('::').join('/');
  return path.split('::')[0];
}

function exportedNamesOf(node, type) {
  switch (type) {
    case 'export_statement':
      return exportStatementNames(node);
    case 'assignment_expression':
      return commonJsNames(node);
    case 'function_definition':
    case 'class_definition':
      return pythonPublicName(node);
    case 'function_declaration':
      return goExportedName(node);
    default:
      return rustPublicName(node);
  }
}

function exportStatementNames(node) {
  const declaration = node.childForFieldName('declaration');
  if (declaration) return declarationNames(declaration);
  const clause = node.children.find(child => child.type === 'export_clause');
  if (clause) {
    return clause.children
      .filter(child => child.type === 'export_specifier')
      .map(spec => (spec.childForFieldName('alias') ?? spec.childForFieldName('name'))?.text)
      .filter(Boolean);
  }
  return node.children.some(child => child.type === 'default') ? ['default'] : [];
}

function declarationNames(declaration) {
  if (declaration.type === 'lexical_declaration' || declaration.type === 'variable_declaration') {
    return declaration.children
      .filter(child => child.type === 'variable_declarator')
      .map(child => child.childForFieldName('name')?.text)
      .filter(name => name && /^\w+$/.test(name));
  }
  const name = declaration.childForFieldName('name')?.text;
  return name ? [name] : [];
}

function commonJsNames(node) {
  const left = node.childForFieldName('left')?.text ?? '';
  const right = node.childForFieldName('right');
  if (left === 'module.exports' && right?.type === 'object') {
    return right.children
      .filter(child => child.type === 'shorthand_property_identifier' || child.type === 'pair')
      .map(child => (child.type === 'pair' ? child.childForFieldName('key')?.text : child.text))
      .filter(Boolean);
  }
  const named = left.match(/^(?:module\.)?exports\.(\w+)$/);
  return named ? [named[1]] : [];
}

function pythonPublicName(node) {
  if (node.parent?.type !== 'module') return [];
  const name = node.childForFieldName('name')?.text;
  return name && !name.startsWith('_') ? [name] : [];
}

function goExportedName(node) {
  if (node.parent?.type !== 'source_file') return [];
  const name = node.childForFieldName('name')?.text;
  return name && /^[A-Z]/.test(name) ? [name] : [];
}

function rustPublicName(node) {
  if (!node.children.some(child => child.type === 'visibility_modifier')) return [];
  const name = node.childForFieldName('name')?.text;
  return name ? [name] : [];
}

function resolveImport(specifier, fromDir, fileAnalysis, stems) {
  if (specifier.startsWith('.')) {
    const base = join(fromDir, specifier).split(sep).join('/');
    return resolveCandidate(base, fileAnalysis);
  }
  return resolveSuffix(specifier, stems);
}

function resolveCandidate(base, fileAnalysis) {
  const stem = base.replace(/\.(js|ts|jsx|tsx|mjs|cjs|py|rs)$/, '');
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map(ext => stem + ext),
    ...INDEX_FILES.map(index => `${base.replace(/\/$/, '')}/${index}`)
  ];
  return candidates.find(candidate => fileAnalysis[candidate]) ?? null;
}

function indexByStem(paths) {
  const stems = new Map();
  for (const path of paths) {
    const parts = pathParts(path);
    if (parts.length === 0) continue;
    const stem = parts[parts.length - 1];
    if (!stems.has(stem)) stems.set(stem, []);
    stems.get(stem).push({ path, parts });
  }
  return stems;
}

function pathParts(path) {
  return path.split('/').map(stripExtension).filter(part => !INDEX_NAMES.has(part));
}

function resolveSuffix(specifier, stems) {
  const wanted = specifier.split('/').filter(Boolean).map(stripExtension);
  const last = wanted[wanted.length - 1];
  for (const { path, parts } of stems.get(last) ?? []) {
    const tail = parts.slice(parts.length - wanted.length);
    if (tail.length === wanted.length && tail.every((part, i) => part === wanted[i])) return path;
  }
  return null;
}

function stripExtension(name) {
  return name.replace(/\.(js|ts|jsx|tsx|mjs|cjs|py|rs|go|java|json)$/, '');
}
