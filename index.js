#!/usr/bin/env node
import { analyze } from './lib.js';

const args = process.argv.slice(2);
const valueOf = (flag) => {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
};
const exclude = args.flatMap((arg, i) => (arg === '--exclude' ? [args[i + 1].replace(/\/+$/, '')] : []));
const valueIndexes = new Set(args.flatMap((arg, i) => (arg === '--budget' || arg === '--exclude' ? [i + 1] : [])));
const budgetValue = valueOf('--budget');
const budget = budgetValue === undefined ? undefined : Number(budgetValue);
const targetPath = args.find((arg, i) => !arg.startsWith('--') && !valueIndexes.has(i)) || '.';

console.log(analyze(targetPath, { budget, exclude }));
