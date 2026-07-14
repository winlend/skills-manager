# Design: Library Source Filter & Batch Ops

**Date:** 2026-07-14  
**Status:** Accepted  
**Repo (fork target):** `winlend/skills-manager` ← upstream `xingkongliang/skills-manager`  
**Approach:** Strengthen Library only (no new primary sidebar page)

## Problem

Users cannot conveniently operate on **all skills from the same origin** (a specific Git repo, skills.sh package, or local path). Pain points:

1. Same-origin skills are scattered in the list.
2. Updating that origin’s skills is tedious (per-skill or weak filters).
3. Adding/removing that set to/from a Preset is one-by-one.

Official docs mention filter by source/tag, but that is insufficient for **concrete source keys** (e.g. `obra/superpowers`). Related upstream feedback: [issue #300](https://github.com/xingkongliang/skills-manager/issues/300).

## Goals

1. **Find by source** — group/filter by channel and by concrete source key.
2. **Update by source** — check / update only skills in the current selection or source group.
3. **Preset by source** — batch add/remove current set to/from a Preset.

## Non-goals (MVP)

- New primary sidebar “Sources” page
- Auto-create Preset from a source
- Force agent sync when adding to Preset
- Capability navigator / intent map (issue #301)
- Dangerous source-level ops (delete whole remote, rewrite URL)

## Information architecture

Stay on **Library** as the single main surface. Keep existing tags, multi-select, per-card update, and sidebar Presets list.

### Two-level source model

| Layer | Meaning | Examples |
|-------|---------|----------|
| **Channel** | Install modality | `git`, `skills_sh`, `local`, `archive`, `unknown` |
| **Source key** | Stable concrete origin | `git:github.com/obra/superpowers`, `skills_sh:owner/repo`, `local:<normalized path>` |

Aggregation and batch ops default to **source key**. Channel is coarse filter.

### Primary user path

```
Open Library
  → optional channel pill / “Group by source” (default on)
  → expand or lock a source key
  → toolbar: Check updates | Update all | Add to Preset | Remove from Preset
  → optional tags / search to narrow further
```

## UI / interaction

### Filter bar

**Channel pills (single-select, toggle off):**  
`All | Git | skills.sh | Local | Archive`

**Source control:** searchable dropdown  
- Label: `Source: All ▾`  
- Items: display name, channel icon, skill count  
- Selected → clearable chip; list restricted to that key

**View toggle:** `Group: Off | By source` — **default On**

**Existing:** tag pills, Untagged, search box

**Combine rule:** `search ∩ channel ∩ source ∩ tags` (AND)

### Search includes source

Search matches:

- skill name / description  
- tags (if already supported)  
- **source label**, **source key**, **full Git/marketplace URL**  
- channel names (weak match OK)

Examples: `superpowers`, `obra/`, `github.com/...`, `skills.sh`

Search and source dropdown are complementary (fuzzy vs exact).

### Tags / filters while searching

- Tag / channel / source selections **stay selected** when the user types search.  
- List = intersection; do **not** auto-clear tags.  
- Empty intersection: empty state + “Clear tags” / “Clear search” shortcuts.  
- Optional later: chips summarizing active filters.

With grouping + search: only groups with matches; cards inside group = matches only.

### Grouped list

```
▼ obra/superpowers          Git · 12 skills · 3 updatable
    [cards…]
▶ vercel-labs/agent-skills  skills.sh · 5 skills
▶ Unknown source            — · 2 skills
```

Group header:

- Expand/collapse  
- Source label (+ optional copy full key/URL)  
- Shortcuts: **Check updates** | **Select all in group**  
- No navigation away from Library

### Contextual batch toolbar

Show when ≥1 skill selected **or** source locked / group fully selected.

| Action | Behavior |
|--------|----------|
| Check updates | Only `updateable` items in the set |
| Update all | Updatable / outdated items; per-item failure does not abort batch; summary `ok n / fail m` |
| Add to Preset | Pick target Preset (MVP: single select); membership only |
| Remove from Preset | Pick Preset; remove membership only |
| Clear selection | Deselect |

Keep existing bulk delete/export alongside.

### Empty / edge states

- Zero skills for a source: hide group (or empty state if filtered).  
- All unknown: group still shown; update actions disabled with tooltip.  
- Local/archive: no upstream update; Preset batch still works; re-import only if product already supports it.

## Data model

Per skill (from DB/metadata, with fallbacks):

| Field | Role |
|-------|------|
| `channel` | `git` \| `skills_sh` \| `local` \| `archive` \| `unknown` |
| `source_key` | Stable id for group/filter |
| `source_label` | Short UI name |
| `source_url` | Optional full URL |
| `updateable` | Whether check/update applies |

### Normalization (examples)

- Git: `git:github.com/owner/repo` — strip `.git`, lowercase host; monorepo multi-skill **same key**  
- skills.sh: `skills_sh:owner/repo` (or official slug)  
- Local: `local:<normalized absolute path>`  
- Archive: `archive:<filename or hash>`  
- Failure: `unknown` + label “Unknown source”

## Update semantics

- Scope = current selection or current source group.  
- Check writes states: update available / up to date / failed (card + group summary).  
- Update all: sequential or limited concurrency; button loading; no silent success for non-updateable.  
- Global “check all library” if upstream already has it: keep; this feature only guarantees **scoped** ops.

## Preset semantics

- Add/remove = preset↔skill membership only.  
- **Do not** auto-sync to agents in MVP (aligned with product: apply Preset is a separate workspace action).  
- Copy: “Adds to preset only; apply the preset in a workspace to enable on agents.”  
- Already in preset → skip; summary “added a, already present b”.  
- Missing preset → close dialog + toast.

## Errors

- Network/auth: keep successful items; list failures; allow retry.  
- Block double-submit while batch update runs.  
- Clear empty/disabled tooltips for non-updateable sets.

## Phasing

### MVP

1. Channel pills + searchable source dropdown + group-by-source (default on)  
2. Search matches source label/URL/key  
3. AND filters; tags not cleared by search  
4. Group header: collapse, counts, updatable count, select all, check updates  
5. Toolbar: check / update all / add|remove Preset (single Preset)  
6. `source_key` normalization + unknown bucket  
7. Batch result summary; i18n EN + zh-CN minimum  

### Later (optional)

- Group counts `matched n / total m` under search  
- Multi-Preset add  
- Active-filter summary chips  
- Light sidebar “Sources” deep-link into Library with filter (hybrid)  
- Tag pill counts respect current filter  

## Acceptance criteria

| # | Scenario | Expectation |
|---|----------|-------------|
| 1 | Multiple skills from one Git repo | Same group; same `source_key` |
| 2 | Channel = Git | Only git channel |
| 3 | Source dropdown = A | Only A; clear restores |
| 4 | Search `owner/repo` | Hits that origin’s skills |
| 5 | Tags then search | Tags remain; list is intersection |
| 6 | Update all in group | Only that group’s updateable skills; failures summarized |
| 7 | Add to Preset | Only selection; skip already members |
| 8 | Unknown source | Own group; update disabled/hidden |
| 9 | Empty intersection | Prompt to clear filters; do not auto-clear tags |

## Risks

| Risk | Mitigation |
|------|------------|
| Inconsistent upstream metadata | Adapter + unknown; unit tests per channel |
| Merge pain with upstream | Touch Library filter/list primarily; avoid sidebar shell |
| Long batch updates | Limited concurrency + progress; cancel if API allows |
| Monorepo split keys | Always normalize to repo root |
| User confuses Preset add with agent enable | Explicit UI copy |

## Implementation notes (fork workflow)

1. Fork `xingkongliang/skills-manager` → `winlend/skills-manager`  
2. Local remotes: `origin` = fork, `upstream` = official  
3. Feature branch for this work  
4. Prefer thin UI on existing Rust/CLI batch update & preset membership APIs  
5. Periodically `git fetch upstream && git merge upstream/main`

## Success metrics (qualitative)

- Same-origin skills discoverable in one group without manual tags.  
- One-origin update without touching unrelated skills.  
- One-origin Preset membership change without per-card clicks.

## Decision log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Navigation | Library only | Matches mental model install/manage; smaller fork surface |
| Source grain | Channel + source_key | Coarse + precise without new page |
| Group default | On | Matches primary user pain |
| Search vs tags | Keep tags; AND with search | Avoid losing multi-step filter intent |
| Preset add | Membership only | Aligns with product semantics |

## Next steps

1. Clone/fork setup for `winlend/skills-manager`  
2. Explore actual source metadata fields in DB/Rust models  
3. Implementation plan (`writing-plans`) + git worktree  
4. Implement MVP on a feature branch  
