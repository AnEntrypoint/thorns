import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_IGNORE_FILES = ['.gitignore', '.thornsignore'];

const FALLBACK_PATTERNS = [
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out',
  'target', 'vendor', '__pycache__', '.pytest_cache', '.mypy_cache',
  '.next', '.nuxt', '.cache', '.parcel-cache', '.vite', '.turbo',
  'coverage', '.nyc_output', '.firebase', '.terraform', '.aws',
  '.azure', '.gcloud', '.vscode', '.idea', '.vs', 'bin', 'obj',
  '.gradle', '.mvn', 'Pods', 'DerivedData', '.bundle',
  '.config', '.local', '.ssh', '.gnupg', '.kube', '.docker',
  '.npm', '.yarn', '.pnpm', '.bun', '.cargo', '.rustup',
  '.java', '.m2', '.sbt', '.gem', '.rbenv', '.rvm', '.nvm',
  '.python', '.venv_global', '.conda', '.mamba', '.nodenv',
  '.pyenv', '.asdf', '.mise', '.vscode-server', '.cursor',
  '.emacs.d', '.vim', '.neovim', '.nvim', '.zsh', '.bash',
  '.oh-my-zsh', '.oh-my-bash', '.direnv'
];

function globToRegex(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    if (glob.startsWith('**/', i)) {
      out += '(?:.*/)?';
      i += 2;
    } else if (glob.startsWith('/**', i) && i + 3 === glob.length) {
      out += '/.*';
      i += 2;
    } else if (glob[i] === '*') {
      out += '[^/]*';
    } else if (glob[i] === '?') {
      out += '[^/]';
    } else if (glob[i] === '[' && glob.indexOf(']', i) > i) {
      const end = glob.indexOf(']', i);
      out += glob.slice(i, end + 1).replace(/^\[!/, '[^');
      i = end;
    } else {
      out += glob[i].replace(/[.+()|{}^$\\[\]]/g, '\\$&');
    }
  }
  return out;
}

function compileRule(line, base) {
  let text = line.trim();
  if (!text || text.startsWith('#')) return null;
  const negate = text.startsWith('!');
  if (negate) text = text.slice(1);
  const dirOnly = text.endsWith('/');
  if (dirOnly) text = text.slice(0, -1);
  const anchored = text.includes('/');
  text = text.replace(/^\//, '');
  if (!text) return null;
  try {
    const body = globToRegex(text);
    const scope = base ? `${escapeRegex(base)}/` : '';
    return { negate, dirOnly, regex: new RegExp(anchored ? `^${scope}${body}$` : `^${scope}(?:.*/)?${body}$`) };
  } catch {
    return null;
  }
}

function escapeRegex(text) {
  return text.replace(/[.+()|{}^$\\[\]*?]/g, '\\$&');
}

function parseRules(content, base = '') {
  return content.split(/\r?\n/).map(line => compileRule(line, base)).filter(Boolean);
}

function loadGitignoreRules(dir, base) {
  try {
    return parseRules(readFileSync(join(dir, '.gitignore'), 'utf8'), base);
  } catch {
    return [];
  }
}

export function loadDefaultRules() {
  try {
    return parseRules(readFileSync(join(PACKAGE_DIR, '.thornsignore'), 'utf8'));
  } catch {
    return parseRules(FALLBACK_PATTERNS.join('\n'));
  }
}

export function loadProjectRules(rootPath) {
  return PROJECT_IGNORE_FILES.flatMap(file => {
    try {
      return parseRules(readFileSync(join(rootPath, file), 'utf8'));
    } catch {
      return [];
    }
  });
}

export function createIgnoreMatcher(rules) {
  const memo = new Map();

  const ignoredPath = (path, isDir) => {
    const key = (isDir ? 'd:' : 'f:') + path;
    let ignored = memo.get(key);
    if (ignored === undefined) {
      ignored = false;
      for (const rule of rules) {
        if (rule.dirOnly && !isDir) continue;
        if (rule.regex.test(path)) ignored = !rule.negate;
      }
      memo.set(key, ignored);
    }
    return ignored;
  };

  return {
    ignores(relativePath, isDir = false) {
      const parts = relativePath.split('/');
      for (let i = 1; i < parts.length; i++) {
        if (ignoredPath(parts.slice(0, i).join('/'), true)) return true;
      }
      return ignoredPath(relativePath, isDir);
    },
    enter(absoluteDir, relativeDir) {
      const nested = loadGitignoreRules(absoluteDir, relativeDir);
      return nested.length ? createIgnoreMatcher([...rules, ...nested]) : this;
    }
  };
}

export function buildIgnoreMatcher(rootPath) {
  return createIgnoreMatcher([...loadDefaultRules(), ...loadProjectRules(rootPath)]);
}
