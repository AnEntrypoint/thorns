# Claude Code Hooks for Thorns

Automatically analyze your codebase and provide context to Claude at session start/end.

## What Are Hooks?

Claude Code hooks are shell commands that execute at various points in Claude's lifecycle. They can inject additional context into your conversations.

## Installation

Clone the repository once, then call its local entry point from hooks:

```bash
git clone https://github.com/AnEntrypoint/mcp-thorns.git ~/thorns
```

Thorns is distributed through GitHub. Do not install it from a package registry. `package.json` is local development metadata; it is not the install path. If the checkout's dependencies are missing from `node_modules`, install them locally before using the hook.

### 1. Create the Hook Script

```bash
cat > ~/.claude/thorns-context-hook.sh << 'EOF'
#!/bin/bash
# Thorns context hook for Claude Code
# Provides codebase analysis at session start and resume

# Run the local GitHub checkout and capture output
ANALYSIS=$(node "$HOME/thorns/index.js" . 2>/dev/null || echo "Thorns analysis unavailable")

# Output as JSON with additionalContext
cat <<EOFINNER
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "=== CODEBASE SNAPSHOT (Thorns Analysis) ===\n\n${ANALYSIS}\n\n=== Generated at session start/resume ==="
  }
}
EOFINNER
EOF

chmod +x ~/.claude/thorns-context-hook.sh
```

### 2. Update Claude Settings

Edit `~/.claude/settings.json` (create if doesn't exist):

```json
{
  "permissions": {
    "allow": ["Read"]
  },
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/home/user/.claude/thorns-context-hook.sh",
            "timeout": 30
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/home/user/.claude/thorns-context-hook.sh",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

**Note:** Replace `/home/user/` with your actual home directory path. On macOS/Linux you can use `$HOME` or `~` but the full path is more reliable.

### 3. Verify Installation

Test the hook manually:

```bash
~/.claude/thorns-context-hook.sh
```

You should see JSON output with the codebase analysis.

## What It Does

**On Session Start (including conversation resumes):**
- Runs `node "$HOME/thorns/index.js"` from the GitHub checkout to analyze your codebase
- Fires on: new sessions, `--resume`, `--continue`, `/resume` commands
- Provides Claude with:
  - File counts, language breakdown
  - Function signatures, classes
  - Import patterns, API calls
  - Orphaned files, duplicates
  - Complexity hotspots
  - File size distribution
  - Top identifiers

**On Session End:**
- Same analysis to capture any changes made during the session

## Benefits

1. **Context Awareness:** Claude knows your codebase structure immediately
2. **Zero Manual Setup:** Happens automatically every session and resume
3. **Comprehensive Insight:** 15+ metric categories in ultra-compact format
4. **Fast:** Completes in <5 seconds for most codebases
5. **Cross-Project:** Works in any directory
6. **Resume Intelligence:** Fresh analysis when continuing conversations

## Customization

### Change Timeout

Increase timeout for large codebases:

```json
{
  "timeout": 60
}
```

### Only Run on SessionStart

Remove the `SessionEnd` hook if you only want initial context:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/thorns-context-hook.sh",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

### Different Output Format

Modify the hook script to customize the analysis output or add project-specific context.

## Troubleshooting

**Hook not running?**
- Check `~/.claude/settings.json` syntax with `cat ~/.claude/settings.json | jq`
- Verify script is executable: `ls -l ~/.claude/thorns-context-hook.sh`
- Test manually: `~/.claude/thorns-context-hook.sh`

**Timeout issues?**
- Increase timeout value
- Add more ignore patterns to `.thornsignore`

**No output to Claude?**
- Ensure JSON is valid
- Check `hookEventName` matches the hook type
- Verify `additionalContext` field exists

## Uninstall

Remove hooks from `~/.claude/settings.json`:

```bash
# Backup first
cp ~/.claude/settings.json ~/.claude/settings.json.bak

# Edit and remove hooks section
nano ~/.claude/settings.json
```

Delete the hook script:

```bash
rm ~/.claude/thorns-context-hook.sh
```

## Learn More

- [Thorns GitHub](https://github.com/AnEntrypoint/mcp-thorns)
- [Claude Code Hooks Documentation](https://docs.claude.com/en/docs/claude-code/hooks)

