# Universal Agent Instructions - Nudgr

All AI coding agents (Claude Code, OpenAI Codex, Google Antigravity, OpenCode, and others) working on this repository must strictly follow these instructions.

---

## 1. Central AI Knowledge System & Shared Memory

This repository connects to the central persistent knowledge base:
- **Central Obsidian Vault:** `%AI_KNOWLEDGE_HOME%\01-Projects\Nudgr\Index.md` (or `%USERPROFILE%\Documents\AI-Knowledge\01-Projects\Nudgr\Index.md`)
- **Local Fallback:** `AI_CONTEXT/PROJECT.md` and `AI_CONTEXT/LATEST-HANDOFF.md` (used if external vault access is restricted)

Every agent must refer to and maintain this shared persistent memory across sessions.

---

## 2. Mandatory Agent Workflow

Every agent session must execute in this order:

1. **Read AGENTS.md** (this file).
2. **Read AI_CONTEXT/PROJECT.md** for immediate project context and constraints.
3. **Read the project's Obsidian Home note** at `%AI_KNOWLEDGE_HOME%\01-Projects\Nudgr\Index.md` (fallback: `AI_CONTEXT/PROJECT.md`).
4. **Read Current-State and Active-Tasks** (`%AI_KNOWLEDGE_HOME%\01-Projects\Nudgr\Current-State.md` and `Active-Tasks.md`).
5. **Read the latest handoff** (`AI_CONTEXT/LATEST-HANDOFF.md` or `%AI_KNOWLEDGE_HOME%\06-Agent-Handoffs\Nudgr\`).
6. **Identify the relevant module** for the user's specific task.
7. **Query Graphify** (`graphify query "<question>"` or `graphify explain "<symbol>"`) to map relationships and call paths.
8. **Inspect ONLY the relevant source code** lines identified by Graphify.
9. **Implement the requested changes** cleanly and conservatively without breaking existing features.
10. **Run relevant tests** or validation steps.
11. **Update project documentation** after significant architectural or state changes.
12. **Write an agent handoff** to `AI_CONTEXT/LATEST-HANDOFF.md` and the central Obsidian vault.

---

## 3. Critical Prohibitions

Agents must **NOT**:
- Scan or grep every file in the repository at the beginning of a task.
- Recursively inspect the entire codebase unnecessarily.
- Rebuild Graphify for ordinary coding tasks (source code is authoritative; Graphify is a navigation aid).
- Reinvestigate already documented problems without reason.
- Read the entire Obsidian vault.
- Rewrite working code unnecessarily.
- Modify unrelated modules.
- Assume old documentation is always correct (actual source code remains authoritative).
- Discard uncommitted user changes or auto-commit to Git without explicit user request.

---

## 4. Graphify Codebase Intelligence

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.

---

## 5. Nudgr Project Specifics

- **Application Directory:** `Nudgr-V2/`
- **Framework:** React Native (Expo 52.0.35, React Native 0.76.7)
- **Backend:** Firebase (Auth, Cloud Firestore, Cloud Messaging)
- **Audio & Location:** `expo-av`, `expo-location`
- **Uncommitted Changes:** Preserve all existing work in `Nudgr-V2/src/ui/`.
- **Git Safety:** Never commit `.env`, credentials, or temporary files. Never commit automatically.
