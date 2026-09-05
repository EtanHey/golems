---
name: lsp
description: "Use when needing semantic code navigation - find definitions, references, or callers. Covers LSP, go to definition, find references, hover, code intelligence. NOT for: text pattern searches (use grep), file discovery (use glob)."
paths:
  - "tsconfig.json"
  - "pyproject.toml"
  - "Cargo.toml"
  - "go.mod"
  - "*.sln"
---

# LSP Code Intelligence Skill

Use this skill when you need guidance on using Claude Code's LSP (Language Server Protocol) tools for code navigation and understanding.

## Quick Reference

| Operation | Use Case | Example |
|-----------|----------|---------|
| `goToDefinition` | Find where a symbol is defined | Jump to function implementation |
| `findReferences` | Find all usages of a symbol | Before renaming a function |
| `hover` | Get type info and docs | Quick understanding of a type |
| `documentSymbol` | List symbols in a file | Understanding file structure |
| `workspaceSymbol` | Search symbols globally | Finding a class by name |
| `goToImplementation` | Find interface implementations | Working with abstract types |
| `incomingCalls` | Find callers of a function | Impact analysis |
| `outgoingCalls` | Find callees of a function | Understanding dependencies |

## Prerequisites

LSP must be configured for the language. Check:
1. Are LSP plugins installed via `/plugin` command?
2. Is the language server binary installed?

## Common Workflows

### Safe Symbol Rename

```
1. Position cursor on symbol name
2. Use findReferences to locate ALL usages
3. Review each reference
4. Make the rename changes
5. Run typecheck to verify
```

### Understanding Unfamiliar Code

```
1. Use goToDefinition on the entry point
2. Use hover on types you don't recognize
3. Use outgoingCalls to understand dependencies
4. Use incomingCalls to understand how it's used
```

### Impact Analysis Before Changes

```
1. Use findReferences on the function you're modifying
2. Use incomingCalls to see the call chain
3. Assess which callers might be affected
4. Plan your changes accordingly
```

### Tracing a Bug

```
1. Start at the error location
2. Use goToDefinition to trace back through the call stack
3. Use findReferences on suspicious variables
4. Identify where incorrect values originate
```

## LSP vs Grep/Glob

| Scenario | Use LSP | Use Grep/Glob |
|----------|---------|---------------|
| Find function definition | Yes | Fallback only |
| Find all usages of a symbol | Yes | Fallback only |
| Search for text patterns | No | Yes |
| Search comments/strings | No | Yes |
| Search config values | No | Yes |
| LSP not configured | N/A | Yes |

## Common LSP Servers

| Language | Server | Install |
|----------|--------|---------|
| TypeScript/JS | typescript-language-server | `npm i -g typescript-language-server typescript` |
| Python | pyright | `pip install pyright` or `npm i -g pyright` |
| Rust | rust-analyzer | Via rustup or standalone |
| Go | gopls | `go install golang.org/x/tools/gopls@latest` |
| C/C++ | clangd | Via LLVM or package manager |
| Java | jdtls | Via Eclipse |
| Ruby | solargraph | `gem install solargraph` |
| PHP | intelephense | `npm i -g intelephense` |

## Troubleshooting

**LSP not working?**
1. Check if language server is installed: `which <server-name>`
2. Check `/plugin` Errors tab for issues
3. Try restarting Claude Code

**No results from findReferences?**
- LSP may not be fully initialized yet
- Try a simpler operation first (like hover)
- Check if the symbol is exported/public

**goToDefinition fails?**
- Symbol may be from external package (not in workspace)
- Type definitions might be in a .d.ts file
- Try hover to at least get type info
