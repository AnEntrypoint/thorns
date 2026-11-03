#!/usr/bin/env node
import { analyze } from './lib.js';

const args = process.argv.slice(2);
const budgetAt = args.indexOf('--budget');
const budget = budgetAt === -1 ? undefined : Number(args[budgetAt + 1]);
const targetPath = args.find((arg, i) => !arg.startsWith('--') && (budgetAt === -1 || i !== budgetAt + 1)) || '.';

console.log(analyze(targetPath, { budget }));
