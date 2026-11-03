import { hashFunction } from './advanced-metrics.js';
import { collectDependencies, newDependencies } from './dependency-analyzer.js';

const FUNCTION_TYPES = new Set([
  'function_declaration', 'generator_function_declaration', 'method_definition', 'function_item',
  'function_definition', 'method_declaration', 'constructor_declaration', 'method', 'singleton_method',
  'local_function_statement'
]);
const FUNCTION_VALUE_TYPES = new Set(['arrow_function', 'function_expression', 'function', 'generator_function']);
const CLASS_TYPES = new Set([
  'class_declaration', 'class_definition', 'class_specifier', 'struct_item', 'enum_item', 'trait_item',
  'interface_declaration', 'struct_specifier', 'enum_declaration', 'class'
]);
const BRANCH_TYPES = new Set([
  'if_statement', 'if_expression', 'elif_clause', 'while_statement', 'while_expression', 'for_statement',
  'for_in_statement', 'for_expression', 'switch_case', 'case_statement', 'catch_clause', 'except_clause', 'match_arm'
]);
const CALL_TYPES = new Set(['call_expression', 'call', 'function_call_expression', 'method_invocation', 'invocation_expression']);
const IDENTIFIER_TYPES = new Set(['identifier', 'property_identifier', 'type_identifier', 'field_identifier']);
const STRING_TYPES = new Set(['string', 'template_string', 'string_literal', 'interpreted_string_literal', 'raw_string_literal', 'concatenated_string']);
const LITERAL_VALUE_TYPES = new Set(['number', 'string', 'true', 'false', 'null', 'template_string']);
const MODULE_LEVEL_TYPES = new Set(['lexical_declaration', 'variable_declaration', 'assignment']);
const AWAIT_TYPES = new Set(['await_expression', 'await']);
const TRY_TYPES = new Set(['try_statement']);
const THROW_TYPES = new Set(['throw_statement', 'raise_statement']);
const URL_PATTERN = /https?:\/\/[^\s'"`,)<>]+/g;
const SQL_STATEMENT = /\b(SELECT\b[\s\S]*\bFROM|INSERT\s+INTO|UPDATE\b[\s\S]*\bSET|DELETE\s+FROM)\b/i;
const QUERY_CALL = /\.(query|execute|prepare)$/;
const FILE_OP_CALL = /(^|\.)(readFile|writeFile|appendFile|readdir|mkdir|unlink|rename|rm|stat)(Sync)?$/;
const ENV_CALL = /(getenv|Getenv|environ\.get)$/;
const CALLEE_IDENTIFIER = /^(?:this\.|self\.)?([A-Za-z_$][\w$]*)$/;
const UPPER_CONSTANT = /^[A-Z][A-Z0-9_]+$/;

export function extractEntities(tree, source) {
  const entities = {
    lines: source.split('\n').length,
    complexity: 0,
    functions: [],
    classes: [],
    calls: new Map(),
    identifiers: new Map(),
    patterns: { async: 0, await: 0, promise: 0, thenCatch: 0, tryCatch: 0, throws: 0, errorTypes: new Set() },
    constants: new Set(),
    globals: new Set(),
    envVars: new Set(),
    urls: new Set(),
    routes: new Set(),
    http: { fetches: 0, axios: 0 },
    storage: { sql: 0, fileOps: 0, json: 0 },
    events: { emitters: 0, listeners: 0 },
    deps: newDependencies()
  };
  visit(tree.rootNode, null, entities);
  return entities;
}

function visit(node, scope, entities) {
  const type = node.type;
  const fnNode = functionNodeOf(node, type);
  let inner = scope;

  if (fnNode) {
    const name = declaredName(node);
    entities.functions.push(functionRecord(fnNode, name));
    if (name) inner = name;
  }
  if (CLASS_TYPES.has(type)) {
    const name = declaredName(node);
    if (name) entities.classes.push({ name, startLine: node.startPosition.row + 1 });
  }
  if (BRANCH_TYPES.has(type)) entities.complexity++;
  if (IDENTIFIER_TYPES.has(type)) recordIdentifier(node.text, entities);
  if (STRING_TYPES.has(type)) {
    for (const url of node.text.match(URL_PATTERN) ?? []) entities.urls.add(url.replace(/[.;:]+$/, '').slice(0, 120));
  }
  if (CALL_TYPES.has(type)) recordCall(node, inner, entities);
  if (AWAIT_TYPES.has(type)) entities.patterns.await++;
  if (TRY_TYPES.has(type)) entities.patterns.tryCatch++;
  if (THROW_TYPES.has(type)) recordThrow(node, entities);
  if (type === 'member_expression' && node.text.startsWith('process.env.')) {
    const name = node.text.slice('process.env.'.length).match(/^\w+/)?.[0];
    if (name) entities.envVars.add(name);
  }
  if ((FUNCTION_TYPES.has(type) || FUNCTION_VALUE_TYPES.has(type)) && /^async\b/.test(node.text)) {
    entities.patterns.async++;
  }
  if (MODULE_LEVEL_TYPES.has(type)) recordModuleLevel(node, type, entities);
  collectDependencies(node, type, entities.deps);

  for (const child of node.children) visit(child, inner, entities);
}

function functionNodeOf(node, type) {
  if (FUNCTION_TYPES.has(type)) return node;
  if (type === 'variable_declarator') {
    const value = node.childForFieldName('value');
    if (value && FUNCTION_VALUE_TYPES.has(value.type)) return value;
  }
  return null;
}

function recordIdentifier(text, entities) {
  if (text.length >= 50) return;
  entities.identifiers.set(text, (entities.identifiers.get(text) || 0) + 1);
}

function functionRecord(fn, name) {
  const lines = fn.endPosition.row - fn.startPosition.row + 1;
  return {
    name,
    params: paramCount(fn),
    lines,
    startLine: fn.startPosition.row + 1,
    hash: lines >= 5 ? hashFunction(fn) : null
  };
}

function paramCount(fn) {
  const list = fn.childForFieldName('parameters') ?? fn.childForFieldName('parameter');
  if (!list) return 0;
  if (list.children.length === 0) return 1;
  return list.children.filter(child => /^[a-z_]/.test(child.type) && child.type !== 'comment').length;
}

function declaredName(node) {
  const target = node.childForFieldName('name') ?? node.childForFieldName('declarator');
  if (!target) return null;
  return /identifier$/.test(target.type) ? target.text : declaredName(target);
}

function calleeText(node) {
  const callee = node.childForFieldName('function') ?? node.childForFieldName('name') ?? node.children[0];
  const text = callee ? callee.text : '';
  return text.length <= 80 ? text : '';
}

function stringArguments(node) {
  const args = node.childForFieldName('arguments');
  if (!args) return [];
  return args.children
    .filter(child => STRING_TYPES.has(child.type))
    .map(child => child.text.replace(/^['"`]|['"`]$/g, ''));
}

function recordCall(node, scope, entities) {
  const callee = calleeText(node);
  const { patterns, storage, http, events } = entities;

  const identifier = callee.match(CALLEE_IDENTIFIER);
  if (scope && identifier) {
    if (!entities.calls.has(scope)) entities.calls.set(scope, new Set());
    entities.calls.get(scope).add(identifier[1]);
  }
  if (/^Promise\./.test(callee)) patterns.promise++;
  if (/\.(then|catch)$/.test(callee)) patterns.thenCatch++;
  if (ENV_CALL.test(callee)) {
    const [name] = stringArguments(node);
    if (name && UPPER_CONSTANT.test(name)) entities.envVars.add(name);
  }
  if (callee === 'fetch' || /\.fetch$/.test(callee)) http.fetches++;
  if (/^axios\.(get|post|put|delete|patch)$/.test(callee)) http.axios++;
  if (/\.(get|post|put|delete|patch|use)$/.test(callee)) {
    const [route] = stringArguments(node);
    if (route?.startsWith('/')) entities.routes.add(route);
  }
  if (/\.(on|once|addEventListener|addListener)$/.test(callee)) events.listeners++;
  if (/\.(emit|dispatch|dispatchEvent|trigger)$/.test(callee)) events.emitters++;
  if (QUERY_CALL.test(callee) || stringArguments(node).some(argument => SQL_STATEMENT.test(argument))) storage.sql++;
  if (FILE_OP_CALL.test(callee)) storage.fileOps++;
  if (/^JSON\.(parse|stringify)$/.test(callee)) storage.json++;
}

function recordThrow(node, entities) {
  entities.patterns.throws++;
  const errorType = node.text.match(/(?:throw new|raise) ([A-Za-z_]\w*)/);
  if (errorType) entities.patterns.errorTypes.add(errorType[1]);
}

function recordModuleLevel(node, type, entities) {
  if (type === 'assignment') {
    const left = node.childForFieldName('left')?.text ?? '';
    if (UPPER_CONSTANT.test(left) && node.parent?.type === 'expression_statement' && node.parent.parent?.type === 'module') {
      entities.constants.add(left);
    }
    return;
  }

  const parent = node.parent?.type;
  if (parent !== 'program' && parent !== 'export_statement') return;
  const isConst = node.text.startsWith('const ');
  for (const declarator of node.children.filter(child => child.type === 'variable_declarator')) {
    const name = declarator.childForFieldName('name')?.text;
    if (!name || !/^\w+$/.test(name)) continue;
    const value = declarator.childForFieldName('value')?.type ?? '';
    if (!isConst) {
      entities.globals.add(name);
    } else if (UPPER_CONSTANT.test(name) || LITERAL_VALUE_TYPES.has(value)) {
      entities.constants.add(name);
    }
  }
}
