# AutoTagger

An Obsidian plugin that uses LLM inference to tag notes and link them to entities (people, organizations, places) from your vault — without you having to do it manually.

## How it works

1. You maintain entity notes in `Resources/People/`, `Resources/Organizations/`, and `Resources/Places/`. The plugin scans these to build an **entity registry** (canonical names + aliases).
2. Your vault's existing tags (from `metadataCache`) form a **tag registry**.
3. When tagging a note, the plugin sends its content along with both registries to your chosen LLM. The model returns structured JSON naming which entities appear and which tags apply.
4. The plugin **merges** those suggestions into the note's frontmatter — additive only, never removes existing tags or links.

## Features

### Commands

| Command | Description |
|---|---|
| Tag current note | Analyze the active note; show a preview modal; apply on confirmation |
| Batch tag — never auto-tagged | Process only notes the plugin has never seen |
| Batch tag — never auto-tagged or changed since | Process notes that are new to the plugin or edited after their last tag |
| Batch tag — no tags in frontmatter | Process notes with empty/missing `tags` |
| Batch tag — modified since last batch run | Process notes touched since the previous batch |
| Batch tag — all notes | Process every in-scope markdown file |
| Rebuild entity & tag registry | Re-scan vault and refresh both registries |

### Auto-tagging

Enable in settings to have the plugin automatically tag notes after a configurable grace period of inactivity (default: 10 minutes). Uses a per-file tag cache to skip notes that haven't changed since they were last tagged.

### LLM providers

| Provider | Notes |
|---|---|
| OpenAI | GPT-5.4, GPT-5.4 mini, GPT-5.4 nano, GPT-4o, GPT-4o mini, or custom |
| Anthropic | Claude Opus/Sonnet/Haiku 4.x and 3.x, or custom |
| Google Gemini | Gemini 3.x and 2.5 series, or custom |
| Ollama | Local models — enter model name manually |

API keys are stored per provider; switching providers loads the correct key automatically.

All providers are called via Obsidian's `requestUrl` — no native Node HTTP, works on mobile.

### Frontmatter output

```yaml
tags:
  - tech/ai
  - topic/knowledge-management
people:
  - "[[Alex Flores]]"
organizations:
  - "[[Granola]]"
places:
  - "[[Zurich]]"
```

Entity names are matched against aliases and resolved to canonical names before being written as wikilinks.

### Tag cache

The plugin persists a `tagCache` (file path → last-tagged timestamp) alongside settings. This powers:
- The "never auto-tagged" and "needs tagging" batch scopes
- Auto-tagging skip logic: a note is only sent to the LLM when it has been edited after its last tag

### mtime preservation

Batch and auto-tagging operations restore the file's original modification time after writing frontmatter, so vault views sorted by "last edited" aren't scrambled. Desktop only (uses Node's `fs.utimesSync` via Electron). Configurable; on by default.

## Installation

### Manual (current)

1. Run `npm run build` in the repo root.
2. Copy or symlink the repo directory into your vault's `.obsidian/plugins/obsidian-autotagger/`.
3. Enable the plugin in Obsidian → Settings → Community plugins.

### From a GitHub Release

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/danibalcells/obsidian-autotagger/releases) and place them in `.obsidian/plugins/obsidian-autotagger/`.

## Configuration

Open **Settings → AutoTagger**.

### LLM Provider

- **Provider** — choose OpenAI, Anthropic, Google Gemini, or Ollama
- **Model** — pick from a dropdown of current models, or select "Custom…" to enter a model ID manually
- **API key** — stored per provider; switching providers recalls the key for that provider
- **System prompt** — editable; the entity and tag registries are appended automatically
- **Max input / output tokens**

### Auto-tagging

- Enable/disable toggle
- Grace period in minutes (default: 10)
- Check interval in minutes
- Include / exclude folder lists (comma-separated)

### New tags

- **Existing only** (default) — LLM may only apply tags already in your vault
- **Allow suggestions** — LLM may propose new tags; must follow a configurable namespace prefix (default: `topic/`)

### Registry

- **Rebuild** button — re-scans the vault; refreshes the settings panel immediately
- **Tag descriptions** — add a short description for any tag to help the LLM disambiguate; searchable, collapsed by default
- **Entity descriptions** — same for entities; also shows aliases; searchable, collapsed by default

Both lists are sorted alphabetically.

## Development

```bash
npm install
npm run dev        # watch mode
npm run build      # production build (type-checks first)
npm test           # vitest unit tests
npm run lint       # ESLint
```

### Project structure

```
src/
  main.ts                    # Plugin entry, commands, data load/save
  types.ts                   # Shared interfaces and defaults
  auto-tagger.ts             # File-change listener with debounce + tag cache check
  frontmatter.ts             # Additive frontmatter merge logic (pure + Obsidian-coupled)
  mtime.ts                   # mtime preservation (desktop only)
  llm/
    index.ts                 # Factory: createLLMAdapter(settings)
    openai.ts / anthropic.ts / google.ts / ollama.ts
    prompt-builder.ts        # System prompt + user message construction
    parser.ts                # LLM response JSON parser
  registry/
    entity-registry.ts       # Vault scan → EntityEntry[], alias resolution
    tag-registry.ts          # metadataCache → TagEntry[]
  commands/
    tag-current-note.ts      # Single-note command
    batch-tag.ts             # Batch command + scope filtering
  ui/
    preview-modal.ts         # Confirmation modal for single-note command
    batch-progress-modal.ts  # Progress + cancel + summary modal
  settings/
    settings-tab.ts          # Full settings panel
tests/
  frontmatter.test.ts        # applyPatchToFrontmatter — merge + dedup logic
  parser.test.ts             # parseLLMResponse — JSON + fence stripping
  registry.test.ts           # resolveCanonicalName — alias matching
  prompt-builder.test.ts     # buildSystemPrompt + buildUserMessage
```

### CI / Releases

- **CI** runs type-check, lint, and tests on every push to `main` and on PRs.
- **Release** is triggered by pushing a version tag (e.g. `git tag 0.2.0 && git push --tags`). GitHub Actions builds the plugin and attaches `main.js`, `manifest.json`, and `styles.css` to a GitHub Release.

## Roadmap / open questions

- Cost estimation before batch runs
- Additional entity types beyond People / Organizations / Places
- Community plugin submission
