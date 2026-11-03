# Thorns - Ultra-Compact Codebase Intelligence

Cross-platform codebase analysis using tree-sitter: a one-shot overview an agent can read once, with a token budget.

## Features

- **Cross-platform**: WSL, Linux, Windows, macOS (arm64/x64)
- **12 languages**: JavaScript, TypeScript, Python, Rust, Go, C/C++, Java, C#, Ruby, PHP, JSON
- **Architecture tree**: Import tree from the entry points (`bin`, `main`, consumers), with each module's exports
- **Call flow**: Which project functions call which, and the most-called internals
- **Dead code**: Unused exports, orphan files; tests found by name
- **Dependencies**: External packages, Node builtins, declared-but-unused packages
- **Issues**: Import cycles, long functions, large files, many-parameter functions, structural duplicates
- **I/O**: Environment variables, full URLs, HTTP calls and routes, storage, events
- **Token budget**: Sections are dropped by priority to stay within `--budget`
- **Ignoring**: Honors `.gitignore` (anchored, negated and nested files), `.thornsignore` and built-in patterns
- **Ultra-compact**: Packages and grammars are grouped, counts are shown as `name×n`

## Usage

### Quick Start

Analyze current directory:
```bash
bunx mcp-thorns
```

Analyze specific directory, capped at about 1200 characters:
```bash
bunx mcp-thorns /path/to/codebase --budget 1200
```

`--budget` counts characters. The default is 3000. `0` removes the limit.

### Install Globally with Bun

```bash
bun add -g mcp-thorns
```

Then use:
```bash
thorns /path/to/codebase
```

### Programmatic API

```javascript
import { analyze } from 'mcp-thorns';

// Get the overview as a string, capped at a budget
const output = analyze('./path/to/codebase', { budget: 1200 });
console.log(output);

// Or use the raw model for custom formatting
import { analyzeCodebase, formatUltraCompact } from 'mcp-thorns';

const data = analyzeCodebase('./path/to/codebase');
const formatted = formatUltraCompact(data, { budget: 1200 });
```

## Output Format

The output is Markdown. Its header comes first, then sections in priority order. When the output would exceed the budget, the lowest-priority sections are dropped first. Example from this repository:

```
# thorns 5.1.13 (cli, ESM)
Perfect one-shot codebase overview: project context, architecture flow, async/error patterns, dead code, internal call graph
bin: mcp-thorns, thorns
scripts: analyze=node index.js · test=node verify-setup.mjs && node verify-overview.mjs 
tests: verify-ignore.mjs, verify-overview.mjs, verify-setup.mjs
12 files · 2.0k lines · 114 fn · 0 cls · cx 2.1 · JS 100%

## Architecture
index.js
  lib.js(analyze, analyzeCodebase, formatUltraCompact)
    analyzer.js(extractEntities)
      advanced-metrics.js(hashFunction, detectDuplication, detectCircularDeps)
      dependency-analyzer.js(newDependencies, collectDependencies, buildDependencyGraph +1)
    advanced-metrics.js(hashFunction, detectDuplication, detectCircularDeps) ↺
    compact-formatter.js(formatUltraCompact)
    dependency-analyzer.js(newDependencies, collectDependencies, buildDependencyGraph +1) ↺
    ignore-parser.js(loadDefaultRules, loadProjectRules, createIgnoreMatcher +1)

## Issues
complex: verify-overview.mjs:97 buildTests (126L)
duplicates: assert×2 (verify-overview.mjs, verify-setup.mjs)

## Dead code
unused exports: queries.js(QUERIES)
orphans: queries.js

## Calls
analyzeCodebase → analyzeProjectContext, buildIgnoreMatcher, walkDir, extractEntities, buildDependencyGraph +11
formatUltraCompact → architectureLines, issueLines, deadCodeLines, callLines, dependencyLines +5
analyzer.js:visit → functionNodeOf, declaredName, functionRecord, recordIdentifier, recordCall +3
buildTests → full, headerOf, sectionOf, statsOf, lineStarting +1
exportedNamesOf → exportStatementNames, commonJsNames, pythonPublicName, goExportedName, rustPublicName
most called: more×8, createIgnoreMatcher×3, parseRules×3, addToSet×2

## Dependencies
external: tree-sitter×1, tree-sitter-*×12
builtins: assert, child_process, crypto, fs, os, path, process, url

## I/O
urls: https://api.example.com/v1/items, https://github.com/AnEntrypoint/mcp-thorns
storage: sql×1, files×18, json×2

## Patterns
async: async×4, await×6, promise×2, then/catch×2
errors: try×14, throw×3, Error
constants: FUNCTION_TYPES, FUNCTION_VALUE_TYPES, CLASS_TYPES, BRANCH_TYPES, CALL_TYPES, IDENTIFIER_TYPES +37
globals: passed, failed

## Core symbols
core: assert×103, test×71, ignores×42, project×33, full×16, more×14, fileText×10, lineStarting×8

legend: ×n occurrences · ↺ already shown · cx avg complexity · fn functions · cls classes · +n more
```

### Sections

- **Architecture**: Import tree from the entry points. Each module shows up to three exports. `↺` marks a module already shown above.
- **Issues**: Import cycles, functions of 80+ lines, files of 400+ lines, functions with 6+ parameters, structural duplicates, parse errors.
- **Dead code**: Exported names no file imports, and files nothing imports or uses.
- **Calls**: Calls between project functions, with the most-called internals. A name declared in two files is shown as `file:name`.
- **Dependencies**: External packages (grammar families grouped as `pkg-*`), Node builtins, declared packages that nothing imports.
- **I/O**: Environment variables, distinct URLs, HTTP calls and routes, storage calls, event emitters and listeners.
- **Patterns**: Async, await, promise and `then/catch` counts, try and throw counts with error types, module constants and globals.
- **Core symbols**: Most-used identifiers that the project declares.

## Supported Languages

- JavaScript (.js, .mjs, .cjs, .jsx)
- TypeScript (.ts, .tsx)
- Python (.py)
- Rust (.rs)
- Go (.go)
- C (.c, .h)
- C++ (.cpp, .cc, .cxx, .hpp)
- Java (.java)
- C# (.cs)
- Ruby (.rb)
- PHP (.php)
- JSON (.json), read for URLs and environment variables only

Import resolution covers JavaScript/TypeScript, Python, Go and Rust. Other languages list their imports as external packages.

## Ignored Directories & Files

Automatically skips 200+ patterns including:
- **VCS**: `.git`, `.svn`, `.hg`, `CVS`
- **Build artifacts**: `dist`, `build`, `out`, `target`, `vendor`
- **Language-specific**: `node_modules`, `__pycache__`, `.gradle`, `Pods`, etc.
- **Caches**: `.cache`, `.next`, `.nuxt`, `.parcel-cache`, `.vite`, `.turbo`
- **IDEs**: `.vscode`, `.idea`, `.vs`, `.sublime-*`
- **Coverage**: `.pytest_cache`, `.nyc_output`, `coverage`, `htmlcov`
- **Home directories**: `~/.cache`, `~/.config`, `~/.local`, `~/.npm`, `~/.cargo`, etc. (when analyzing subdirs)
- **Lock files**: `bun.lockb`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`
- **Custom patterns**: `.gitignore` (including nested files) and `.thornsignore`. `.npmignore` and `.dockerignore` are not applied: they decide what ships, not what the code is

Test files and directories are included, so the overview can name them. Vendored code, fixtures and config files are skipped, and so are nested git repositories, which are separate projects.

Thorns prioritizes speed by ignoring 96%+ of non-code files.

## Requirements

- **Runtime**: Bun >= 1.0
- **Platform**: Linux, macOS, Windows (WSL2), Docker
- Prebuilt binaries download automatically for supported platforms

## Compatibility

✅ **Linux**: Ubuntu, Debian, Alpine, Fedora, Arch
✅ **macOS**: Intel & Apple Silicon (arm64)
✅ **Windows**: WSL2, Git Bash, PowerShell
✅ **Docker**: All Linux images (Alpine, Debian, Ubuntu)
✅ **CI/CD**: GitHub Actions, GitLab CI, Jenkins, CircleCI
✅ **Cloud**: AWS Lambda (with Node/Bun layer), GCP Cloud Functions

## Execution Methods

| Method | Best For | Requirements |
|--------|----------|--------------|
| bunx | Quick analysis | `bun` |
| Bun global | Repeated use | `bun` |
| Programmatic | Integration | Bun |

## How It Works

1. Walks directory tree, filtering by extension and ignore patterns
2. Parses each file with tree-sitter
3. Extracts functions, classes, calls, imports, exports and I/O in one pass per file
4. Builds the import graph and the call graph from the project's own declarations
5. Formats the model as Markdown, dropping the lowest-priority sections over the budget

## Performance

- Skips files > 200KB, Python virtualenvs (directories with `pyvenv.cfg`) and nested git repositories (directories with `.git`)
- Scans at most 8000 files, and the overview says so when it stops early
- Uses native parsers (not WASM); sources are parsed in chunks, so large files are not truncated
- Minimal memory footprint
- Processes ~1000 files/second on modern hardware
# Triggered npm publishing
