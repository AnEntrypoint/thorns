import { createHash } from 'crypto';

export function hashFunction(node) {
  const structure = [];

  function traverse(n) {
    structure.push(n.type);
    for (const child of n.children) {
      if (!child.type.includes('identifier') && !child.type.includes('comment')) {
        traverse(child);
      }
    }
  }

  traverse(node);
  return createHash('md5').update(structure.join(':')).digest('hex').slice(0, 8);
}

export function detectDuplication(functions) {
  const groups = new Map();
  for (const fn of functions) {
    if (!fn.hash) continue;
    if (!groups.has(fn.hash)) groups.set(fn.hash, []);
    groups.get(fn.hash).push(fn);
  }
  return [...groups.values()].filter(group => group.length > 1).sort((a, b) => b.length - a.length);
}

export function detectCircularDeps(nodes) {
  const cycles = [];
  const seen = new Set();
  const state = new Map();
  const stack = [];

  function visit(file) {
    state.set(file, 'open');
    stack.push(file);
    for (const dep of nodes.get(file)?.importsFrom ?? []) {
      if (state.get(dep) === 'open') {
        const cycle = stack.slice(stack.indexOf(dep)).concat(dep);
        const key = cycle.slice(0, -1).sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      } else if (!state.has(dep)) {
        visit(dep);
      }
    }
    stack.pop();
    state.set(file, 'done');
  }

  for (const file of nodes.keys()) {
    if (!state.has(file)) visit(file);
  }
  return cycles;
}
