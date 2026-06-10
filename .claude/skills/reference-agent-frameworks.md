---
name: reference-agent-frameworks
description: Reference Hermes Agent and OpenClaw source code for architectural decisions. Only access when explicitly needed for design/implementation reference.
metadata:
  type: reference
---

# Reference: Agent Framework Source Code

This skill manages access to two reference agent frameworks cloned locally for architectural study.

## Reference Location

```
refer/
├── hermes-agent/     # Nous Research - Python-based, Agent-first architecture
└── openclaw/         # OpenClaw - TypeScript/Node.js, Gateway-first architecture
```

## When to Use

**DO reference when:**
- Designing a specific subsystem and need to see how existing frameworks solved it
- Implementing a feature and want to verify patterns (tool registry, memory management, gateway routing)
- Debugging a design decision by comparing approaches
- Need concrete code examples for: conversation loop, context compression, skill registration, channel routing

**DO NOT reference when:**
- Brainstorming high-level architecture (use knowledge from web research instead)
- Making product-level decisions (these are implementation references, not product specs)
- The question is about general agent concepts (use web search instead)

## Architecture Quick Reference

### Hermes Agent (Agent-first)

| Layer | Key Files | Purpose |
|-------|-----------|---------|
| **Agent Loop** | `run_agent.py`, `agent/conversation_loop.py` | Core ReAct loop, tool dispatch, retries, compression |
| **Context Engine** | `agent/context_engine.py`, `agent/context_compressor.py` | Token management, compaction, summarization |
| **Memory** | `agent/memory_manager.py`, `agent/memory_provider.py` | Multi-provider memory, context prefetch/sync |
| **Tools** | `tools/registry.py`, `model_tools.py` | Tool discovery, registration, async dispatch |
| **Skills** | `skills/`, `agent/skill_manager.py` | Skill loading, auto-generation, curation |
| **Gateway** | `gateway/run.py`, `gateway/session.py` | Multi-platform messaging (Telegram, Discord, etc.) |
| **State** | `hermes_state.py` | SQLite persistence, FTS5 search, session management |
| **CLI** | `cli.py`, `hermes_cli/` | Interactive TUI, slash commands |

### OpenClaw (Gateway-first)

| Layer | Key Files | Purpose |
|-------|-----------|---------|
| **Gateway** | `src/gateway/` | WebSocket control plane, session routing |
| **Agent Runtime** | `src/agents/`, `src/cron/isolated-agent.ts` | Tool-call loop, subagent spawning, compaction |
| **Channels** | `src/channels/` | 20+ messaging platform adapters |
| **Skills** | `src/skills/` | Skill execution, bundle management |
| **Memory** | `src/memory/` | Plugin-based memory system |
| **Tools** | `src/tools/` | Tool registry, schema projection |
| **State** | `src/state/` | SQLite via Kysely, agent-scoped DB |
| **Plugins** | `src/plugins/`, `src/plugin-sdk/` | Extension system |

## Key Differences to Remember

| Aspect | Hermes | OpenClaw |
|--------|--------|----------|
| **Core focus** | Agent loop / reasoning | Gateway / platform connectivity |
| **Self-learning** | ✅ Auto skill generation | ❌ Manual skill updates |
| **Memory tiers** | 3-layer (Working/Episodic/Semantic) | Plugin-based, configurable |
| **Context compression** | Built-in compressor with configurable thresholds | Token compaction with sanitization |
| **Subagent delegation** | `delegate_task` via ThreadPoolExecutor | Subagent registry with persistence |
| **Architecture style** | Python monolith, functional | TypeScript modular, plugin-driven |
| **Config approach** | `cli-config.yaml` + env | `openclaw.json` + Markdown files |

## Access Pattern

When a question requires source reference:

1. **Identify the subsystem** (loop, memory, tools, gateway, skills)
2. **Decide which framework** has the better reference for that subsystem
   - Agent loop / learning → Hermes
   - Gateway / channels / plugins → OpenClaw
   - Tool registry / skills → Both (compare)
3. **Read only the relevant files** — do not browse the entire codebase
4. **Document the reference** in design docs with file:line citations

## Code Reading Guidelines

- Hermes: Start with `run_agent.py` → `agent/conversation_loop.py` for loop logic
- Hermes: Start with `agent/memory_manager.py` for memory architecture
- OpenClaw: Start with `src/agents/` for agent runtime, `src/channels/` for gateway
- OpenClaw: `CLAUDE.md` files in subdirectories contain architecture rules for that module
