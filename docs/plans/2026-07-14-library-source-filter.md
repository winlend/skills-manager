# Library Source Filter & Batch Ops Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** In Library (`MySkills`), let users filter/group by concrete install origin (Git repo / skills.sh package / local path), search by source, and batch check-update / update / add-remove Preset for that set—without a new sidebar page.

**Architecture:** Pure frontend-first MVP on existing `ManagedSkill` fields (`source_type`, `source_ref`, `source_ref_resolved`, `source_subpath`). Add a small pure module `src/lib/skillSource.ts` that normalizes `source_key` + label + channel; extend `MySkills.tsx` filter pipeline and list rendering; reuse existing Tauri APIs `batchUpdateSkills`, `checkSkillUpdate` / `checkAllSkillUpdates` (scoped client-side), `addSkillToPreset`, `removeSkillFromPreset`. No new sidebar route. Optional thin backend batch-preset only if sequential UI calls prove too slow.

**Tech Stack:** React 19 + TypeScript + Tailwind (frontend); Tauri 2 + Rust commands already present; Vitest/Jest if present, else pure unit tests via `node --test` / existing test runner from `package.json`.

**Design doc:** `docs/plans/2026-07-14-library-source-filter-design.md`

**Worktree note:** Canonical clone currently at `F:\AI Works\Projects\skills-manager-src` (session CWD may still be `skills-manager` docs-only). Prefer implementing in `skills-manager-src`. After GitHub login, add `origin` → `winlend/skills-manager` and push feature branch.

---

## Current codebase facts (do not rediscover)

| Area | Location | Today |
|------|----------|--------|
| Library UI | `src/views/MySkills.tsx` (~1647 lines) | Filters: preset mode all/enabled/available; **channel-only** `sourceFilters: Set<source_type>`; tag pills; search **name/desc only** |
| Types / API | `src/lib/tauri.ts` | `ManagedSkill.source_type/ref/resolved/subpath/...`; `batchUpdateSkills`; `checkSkillUpdate`; `checkAllSkillUpdates`; `addSkillToPreset`; `removeSkillFromPreset` |
| Multi-select bar | `src/components/MultiSelectToolbar.tsx` | Update / delete / enable-disable / tags — **no Preset add/remove** |
| Backend store | `src-tauri/src/core/skill_store.rs` | `SkillRecord` source fields |
| Coarse label | `src-tauri/src/commands/skills.rs` `source_label_for_skill` | Returns only "Git" / "skills.sh" / "Local" — **not** owner/repo |
| Batch update | `batch_update_skills` | Already returns refreshed/unchanged/failed |

**Existing channel pills (keep):** `local | import | git | skillssh` via `mySkills.sourceFilter.*` i18n.

**Gap vs design:** no concrete `source_key` filter, no group-by-source, search ignores `source_ref`, multi-select cannot target arbitrary Preset (only current viewed preset enable/disable).

---

### Task 1: Pure source normalization helper + unit tests

**Model hint:** `auto`

**Files:**

- Create: `src/lib/skillSource.ts`
- Create: `src/lib/skillSource.test.ts` (or colocate with project test convention—check `package.json` scripts first)

**Step 1: Confirm test runner**

Run:

```bash
cd "F:/AI Works/Projects/skills-manager-src"
cat package.json | head -80
```

Expected: note `test` / `vitest` / `jest` script. Use that runner for Step 4. If none, add a minimal vitest devDependency only if project already uses vite (it does)—prefer matching existing style; if zero tests exist, create vitest config only when necessary or use `node --import tsx --test` if simpler.

**Step 2: Write failing tests**

```ts
// src/lib/skillSource.test.ts
import { describe, it, expect } from "vitest"; // adjust import to project
import {
  normalizeSourceKey,
  sourceLabelFromSkill,
  channelFromSourceType,
  skillMatchesSourceSearch,
} from "./skillSource";

describe("normalizeSourceKey", () => {
  it("normalizes github https git url", () => {
    const r = normalizeSourceKey({
      source_type: "git",
      source_ref: "https://github.com/Obra/Superpowers.git",
      source_ref_resolved: null,
      source_subpath: "skills/foo",
    });
    expect(r.key).toBe("git:github.com/obra/superpowers");
    expect(r.label).toMatch(/obra\/superpowers/i);
    expect(r.channel).toBe("git");
    expect(r.updateable).toBe(true);
  });

  it("groups monorepo skills under same key ignoring subpath", () => {
    const a = normalizeSourceKey({
      source_type: "git",
      source_ref: "https://github.com/foo/bar",
      source_ref_resolved: null,
      source_subpath: "a",
    });
    const b = normalizeSourceKey({
      source_type: "git",
      source_ref: "https://github.com/foo/bar.git",
      source_ref_resolved: null,
      source_subpath: "b",
    });
    expect(a.key).toBe(b.key);
  });

  it("skillssh uses slug", () => {
    const r = normalizeSourceKey({
      source_type: "skillssh",
      source_ref: "vercel-labs/agent-skills",
      source_ref_resolved: null,
      source_subpath: null,
    });
    expect(r.key).toBe("skillssh:vercel-labs/agent-skills");
    expect(r.channel).toBe("skillssh");
  });

  it("local uses path", () => {
    const r = normalizeSourceKey({
      source_type: "local",
      source_ref: "D:\\\\skills\\\\foo",
      source_ref_resolved: null,
      source_subpath: null,
    });
    expect(r.key.startsWith("local:")).toBe(true);
    expect(r.updateable).toBe(true); // reimport path present
  });

  it("unknown when missing ref", () => {
    const r = normalizeSourceKey({
      source_type: "git",
      source_ref: null,
      source_ref_resolved: null,
      source_subpath: null,
    });
    expect(r.key).toBe("unknown");
    expect(r.updateable).toBe(false);
  });
});

describe("skillMatchesSourceSearch", () => {
  it("matches owner/repo in source_ref", () => {
    expect(
      skillMatchesSourceSearch(
        {
          name: "x",
          description: "",
          source_type: "git",
          source_ref: "https://github.com/obra/superpowers",
          source_ref_resolved: null,
        },
        "superpowers"
      )
    ).toBe(true);
  });
});
```

**Step 3: Run tests — expect FAIL**

Run: project test command on `skillSource.test.ts`  
Expected: module not found / fail.

**Step 4: Implement `src/lib/skillSource.ts`**

```ts
export type SourceChannel = "git" | "skillssh" | "local" | "import" | "archive" | "unknown";

export interface SkillSourceFields {
  source_type: string;
  source_ref: string | null;
  source_ref_resolved?: string | null;
  source_subpath?: string | null;
}

export interface NormalizedSource {
  key: string;
  label: string;
  channel: SourceChannel;
  updateable: boolean;
  url: string | null;
}

export function channelFromSourceType(type: string): SourceChannel {
  if (type === "git" || type === "skillssh" || type === "local" || type === "import") return type;
  if (type === "archive" || type === "zip") return "archive";
  return "unknown";
}

function stripGitSuffix(s: string): string {
  return s.replace(/\.git$/i, "");
}

/** host/owner/repo lowercase for github/gitlab-like https or ssh urls */
export function normalizeGitRepoIdentity(raw: string): { hostPath: string; label: string } | null {
  let s = raw.trim();
  // git@host:owner/repo.git
  const ssh = s.match(/^git@([^:]+):(.+)$/i);
  if (ssh) {
    const hostPath = `${ssh[1].toLowerCase()}/${stripGitSuffix(ssh[2]).replace(/^\/+/, "").toLowerCase()}`;
    const parts = hostPath.split("/");
    const label = parts.slice(-2).join("/");
    return { hostPath, label };
  }
  // https://host/owner/repo
  try {
    const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    const u = new URL(withProto);
    const path = stripGitSuffix(u.pathname).replace(/^\/+|\/+$/g, "").toLowerCase();
    if (!path) return null;
    const hostPath = `${u.hostname.toLowerCase()}/${path}`;
    const segs = path.split("/");
    const label = segs.slice(0, 2).join("/") || path;
    return { hostPath, label };
  } catch {
    const cleaned = stripGitSuffix(s).toLowerCase();
    return { hostPath: cleaned, label: cleaned };
  }
}

export function normalizeSourceKey(skill: SkillSourceFields): NormalizedSource {
  const channel = channelFromSourceType(skill.source_type);
  const ref = (skill.source_ref_resolved || skill.source_ref || "").trim();

  if (channel === "git") {
    if (!ref) {
      return { key: "unknown", label: "Unknown source", channel: "unknown", updateable: false, url: null };
    }
    const id = normalizeGitRepoIdentity(ref);
    if (!id) {
      return { key: "unknown", label: "Unknown source", channel: "unknown", updateable: false, url: ref };
    }
    return {
      key: `git:${id.hostPath}`,
      label: id.label,
      channel: "git",
      updateable: true,
      url: ref,
    };
  }

  if (channel === "skillssh") {
    if (!ref) {
      return { key: "unknown", label: "Unknown source", channel: "unknown", updateable: false, url: null };
    }
    const slug = ref.replace(/^skills\.sh\//i, "").toLowerCase();
    return {
      key: `skillssh:${slug}`,
      label: slug,
      channel: "skillssh",
      updateable: true,
      url: ref,
    };
  }

  if (channel === "local" || channel === "import") {
    if (!ref) {
      return {
        key: `${channel}:detached`,
        label: channel === "import" ? "Imported (no path)" : "Local (no path)",
        channel,
        updateable: false,
        url: null,
      };
    }
    // normalize slashes for stable key
    const norm = ref.replace(/\\/g, "/").replace(/\/+$/, "");
    const label = norm.split("/").filter(Boolean).slice(-2).join("/") || norm;
    return {
      key: `${channel}:${norm.toLowerCase()}`,
      label,
      channel,
      updateable: true,
      url: ref,
    };
  }

  return {
    key: "unknown",
    label: "Unknown source",
    channel: "unknown",
    updateable: false,
    url: ref || null,
  };
}

export function sourceLabelFromSkill(skill: SkillSourceFields): string {
  return normalizeSourceKey(skill).label;
}

export function skillMatchesSourceSearch(
  skill: {
    name: string;
    description?: string | null;
    source_type: string;
    source_ref: string | null;
    source_ref_resolved?: string | null;
  },
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const n = normalizeSourceKey(skill);
  const hay = [
    skill.name,
    skill.description || "",
    skill.source_type,
    skill.source_type === "skillssh" ? "skills.sh" : "",
    skill.source_ref || "",
    skill.source_ref_resolved || "",
    n.key,
    n.label,
    n.url || "",
  ]
    .join("\n")
    .toLowerCase();
  return hay.includes(q);
}

export function buildSourceIndex(
  skills: SkillSourceFields[]
): Array<NormalizedSource & { count: number }> {
  const map = new Map<string, NormalizedSource & { count: number }>();
  for (const s of skills) {
    const n = normalizeSourceKey(s);
    const prev = map.get(n.key);
    if (prev) prev.count += 1;
    else map.set(n.key, { ...n, count: 1 });
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
}
```

**Step 5: Run tests — expect PASS**

**Step 6: Commit**

```bash
git add src/lib/skillSource.ts src/lib/skillSource.test.ts
git commit -m "feat(library): add skill source_key normalization helper"
```

---

### Task 2: Extend Library filter state — concrete source key + search

**Model hint:** `gemini`

**Files:**

- Modify: `src/views/MySkills.tsx` (filter state ~133–274, search input ~960+, source pills ~1059+)
- Modify: i18n files under `src/i18n/` (en + zh-CN keys for new strings)

**Step 1: Add state**

Near existing filters:

```ts
const [sourceKeyFilter, setSourceKeyFilter] = useState<string | null>(null);
const [groupBySource, setGroupBySource] = useState(true); // design default ON
```

**Step 2: Change `filtered` useMemo**

1. Replace search block to also use `skillMatchesSourceSearch(skill, search)` **OR** keep name/desc OR source match:

```ts
const q = search.trim();
const matchesSearch =
  !q ||
  skill.name.toLowerCase().includes(q.toLowerCase()) ||
  displayName.toLowerCase().includes(q.toLowerCase()) ||
  (skill.description || "").toLowerCase().includes(q.toLowerCase()) ||
  skillMatchesSourceSearch(skill, q);
```

2. Keep channel `sourceFilters` (existing Set of source_type).

3. Add:

```ts
if (sourceKeyFilter) {
  const key = normalizeSourceKey(skill).key;
  if (key !== sourceKeyFilter) return false;
}
```

4. **Do not clear** `tagFilters` / `sourceFilters` / `sourceKeyFilter` when `search` changes.

**Step 3: Source dropdown UI**

Below channel pills, add searchable select (simple custom popover is fine to match app style):

- Button shows `Source: All` or selected label + clear ×  
- List from `buildSourceIndex(skills)` filtered by optional local query string  
- Each row: label, channel icon, count  
- onSelect → `setSourceKeyFilter(key)`

**Step 4: Group-by toggle**

Segmented or checkbox: `Group by source` bound to `groupBySource`.

**Step 5: i18n**

Add keys e.g.:

- `mySkills.sourceKeyFilter.all`
- `mySkills.sourceKeyFilter.placeholder`
- `mySkills.groupBySource`
- `mySkills.unknownSource`
- `mySkills.batchAddToPreset` / `batchRemoveFromPreset`
- `mySkills.presetMembershipHint` (membership only, apply in workspace)

**Step 6: Manual smoke** (or unit-test pure filter function if extracted)

Extract optional pure:

```ts
// src/lib/filterLibrarySkills.ts
export function filterLibrarySkills(...) { ... }
```

Prefer extract if `MySkills.tsx` stays unmaintainable; otherwise test via `skillMatchesSourceSearch` only this task.

**Step 7: Commit**

```bash
git commit -m "feat(library): filter by concrete source key and search source refs"
```

---

### Task 3: Grouped list rendering + group header actions

**Model hint:** `gemini`

**Files:**

- Modify: `src/views/MySkills.tsx` list section ~1151–1400
- Optional Create: `src/components/SourceGroupHeader.tsx`

**Step 1: Build groups from `filtered`**

```ts
const grouped = useMemo(() => {
  if (!groupBySource) return null;
  const map = new Map<string, { meta: NormalizedSource; skills: ManagedSkill[] }>();
  for (const skill of filtered) {
    const meta = normalizeSourceKey(skill);
    const g = map.get(meta.key) || { meta, skills: [] };
    g.skills.push(skill);
    map.set(meta.key, g);
  }
  return Array.from(map.values()).sort((a, b) => a.meta.label.localeCompare(b.meta.label));
}, [filtered, groupBySource]);
```

**Step 2: Collapse state**

`const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set())`  
Default expanded (empty set = all open).

**Step 3: Header UI**

```
▼ label     channel · N skills · M updatable
   [Check updates] [Select all in group]
```

- `M` = count where `update_status === "update_available" && canRefresh(skill)`
- Check updates: `Promise.all` / sequential `api.checkSkillUpdate(id, true)` for updateable skills in group only; then `refreshManagedSkills()`
- Select all: add all group skill ids to multi-select (`setIsMultiSelect(true)` + select ids)—reuse `useMultiSelect` APIs already in file

**Step 4: Render**

If `grouped`: map groups → header + (if not collapsed) existing card map.  
Else: existing flat `filtered.map`.

**Step 5: Empty intersection copy**

When `filtered.length === 0` and any filter active, show clear actions: clear search / clear tags / clear source key (do **not** auto-clear).

**Step 6: Commit**

```bash
git commit -m "feat(library): group skills by concrete source with header actions"
```

---

### Task 4: Batch toolbar — Add/Remove Preset for selection

**Model hint:** `gemini`

**Files:**

- Modify: `src/components/MultiSelectToolbar.tsx`
- Modify: `src/views/MySkills.tsx` handlers (~560–680, toolbar props)
- Optional Create: `src/components/PresetPickDialog.tsx` (simple list modal)

**Step 1: Extend toolbar props**

```ts
  onAddToPreset?: () => void;
  onRemoveFromPreset?: () => void;
  labels: {
    ...
    addToPreset?: string;
    removeFromPreset?: string;
  };
```

Render buttons when `selectedCount > 0` and callbacks provided.

**Step 2: Dialog**

List `presets` from context; single-select; confirm.

**Step 3: Handlers**

```ts
const handleBatchAddToPreset = async (presetId: string) => {
  const ids = [...selectedIds];
  let added = 0, skipped = 0, failed = 0;
  for (const id of ids) {
    const skill = skills.find(s => s.id === id);
    if (!skill) continue;
    if (skill.preset_ids.includes(presetId)) { skipped++; continue; }
    try {
      await api.addSkillToPreset(id, presetId);
      added++;
    } catch { failed++; }
  }
  // toasts + refreshManagedSkills + refreshPresets
};
```

Same pattern for remove (`removeSkillFromPreset`).

**Copy:** toast or dialog note that this only changes membership (design §3.3).

**Step 4: Wire when multi-select active**

Works for any selection—including “select all in group”.

**Step 5: Commit**

```bash
git commit -m "feat(library): batch add/remove selected skills on a preset"
```

---

### Task 5: Scope check-updates to selection / group (not only global)

**Model hint:** `auto`

**Files:**

- Modify: `src/views/MySkills.tsx`

**Step 1: Selected-only check**

If product only has `checkAllSkillUpdates`, for selection/group call:

```ts
for (const skill of targets) {
  if (!canRefresh(skill)) continue;
  try { await api.checkSkillUpdate(skill.id, true); } catch { /* collect */ }
}
await refreshManagedSkills();
```

**Step 2: Group header “Check updates”** uses same helper with group skill list.

**Step 3: “Update all” for group / selection**

Reuse existing `api.batchUpdateSkills(ids)` — already used by `handleBatchRefresh`.

For group header optional “Update available in group”: filter `update_available` in group then `batchUpdateSkills`.

**Step 4: Commit**

```bash
git commit -m "feat(library): scoped check/update for source group and selection"
```

---

### Task 6: i18n polish + empty states + acceptance pass

**Model hint:** `auto`

**Files:**

- Modify: `src/i18n/*` (locate en/zh json via `rg "sourceFilter" src/i18n`)
- Modify: `src/views/MySkills.tsx` empty state

**Step 1:** Fill all new strings EN + zh-CN.

**Step 2:** Manual acceptance from design doc table rows 1–9 (document results in PR description).

**Step 3:** Run:

```bash
npm run build
# or typecheck
npx tsc -b --pretty false
```

Expected: no new TS errors in touched files.

**Step 4: Commit**

```bash
git commit -m "feat(library): i18n and empty states for source filtering"
```

---

### Task 7: Fork remote + feature branch hygiene

**Model hint:** `auto`

**Files:** none (git only)

**Step 1:** User completes GitHub login (interactive):

```powershell
gh auth login
```

**Step 2:** Create fork if missing:

```powershell
gh repo fork xingkongliang/skills-manager --clone=false --default-branch-only
```

**Step 3:** In `skills-manager-src`:

```powershell
git remote add origin https://github.com/winlend/skills-manager.git
git fetch origin
git checkout -b feature/library-source-filter
# after commits:
git push -u origin feature/library-source-filter
```

**Step 4:** Keep `upstream` = official; sync later via `git fetch upstream && git merge upstream/main`.

---

## Out of scope (do not implement in this plan)

- New sidebar Sources page  
- Backend change to `source_label_for_skill` (nice-to-have later)  
- Batch preset API in Rust (optional optimization)  
- Auto-apply preset to agents on add  
- Issue #301 navigator  

## Risk notes for implementer

1. **`MySkills.tsx` is large** — keep pure logic in `skillSource.ts`; avoid drive-by refactors.  
2. **SSH vs HTTPS same repo** — normalization must map both to one `source_key`.  
3. **Windows paths** — local key normalize `\` → `/`.  
4. **Merge with upstream** — minimize edits outside Library filter/list/toolbar.  
5. **Preset confusion** — always show membership-only copy.

## Execution handoff

After this plan is saved, choose:

1. **Subagent-Driven (this session)** — one task per subagent, review between tasks  
2. **Parallel Session** — new session with `executing-plans` in a worktree  

---

## Progress checkpoint (session setup)

| Step | Status |
|------|--------|
| Design accepted | Done — `docs/plans/2026-07-14-library-source-filter-design.md` |
| Clone upstream | Done — `skills-manager-src` @ `8b7771f` (v1.28.3), remote `upstream` |
| Design restored into clone | Done |
| `gh` installed | Done — v2.96.0 |
| `gh auth login` | **Blocked** — user must run interactively |
| Fork `winlend/skills-manager` | Pending auth |
| `origin` remote | Pending fork |
| Implementation Tasks 1–6 | Not started |
