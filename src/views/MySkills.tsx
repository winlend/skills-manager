import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  LayoutGrid,
  List,
  CheckCircle2,
  Github,
  HardDrive,
  Globe,
  Layers,
  RefreshCw,
  RotateCcw,
  GitBranch,
  ArrowUpCircle,
  Wrench,
  Loader2,
  X,
  Plus,
  SquareCheck,
  Square,
  GripVertical,
  CircleSlash,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  FolderTree,
} from "lucide-react";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "../utils";
import { useApp } from "../context/AppContext";
import { useMultiSelect } from "../hooks/useMultiSelect";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { TagRenameDialog } from "../components/TagRenameDialog";
import { DeleteSkillButton } from "../components/DeleteSkillButton";
import { SkillDetailPanel } from "../components/SkillDetailPanel";
import { MultiSelectToolbar } from "../components/MultiSelectToolbar";
import { BatchTagDialog } from "../components/BatchTagDialog";
import { PresetPickDialog } from "../components/PresetPickDialog";
import { SyncDots } from "../components/SyncDots";
import * as api from "../lib/tauri";
import { getTagActiveColor, getTagColor, UNTAGGED_FILTER } from "../lib/skillTags";
import {
  buildSourceIndex,
  normalizeSourceKey,
  skillMatchesSourceSearch,
  type NormalizedSource,
} from "../lib/skillSource";
import type {
  ManagedSkill,
  ToolInfo,
  GitBackupStatus,
  SkillToolToggle,
} from "../lib/tauri";
import { getErrorMessage } from "../lib/error";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface SortableSkillItemProps {
  id: string;
  disabled: boolean;
  className?: string;
  children: (dragHandle: React.ReactNode) => React.ReactNode;
}

function SortableSkillItem({ id, disabled, className, children }: SortableSkillItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const handle = !disabled ? (
    <div
      ref={setActivatorNodeRef}
      {...listeners}
      onClick={(e) => e.stopPropagation()}
      className="flex cursor-grab items-center justify-center rounded p-1 text-faint transition-colors hover:bg-surface-hover hover:text-muted active:cursor-grabbing"
    >
      <GripVertical className="h-4 w-4" />
    </div>
  ) : null;

  return (
    <div ref={setNodeRef} style={style} {...attributes} className={cn("h-full", className)}>
      {children(handle)}
    </div>
  );
}

function getToolDisplayName(toolKey: string, tools: ToolInfo[]) {
  return tools.find((tool) => tool.key === toolKey)?.display_name || toolKey;
}

function centralDirName(skill: ManagedSkill) {
  return skill.central_path.split(/[\\/]/).filter(Boolean).pop() || skill.name;
}

export function MySkills() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    viewedPreset,
    presets,
    tools,
    managedSkills: skills,
    refreshPresets,
    refreshManagedSkills,
    detailSkillId,
    openSkillDetailById,
    closeSkillDetail,
    projects,
    refreshProjects,
  } = useApp();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [filterMode, setFilterMode] = useState<"all" | "enabled" | "available">("all");
  const [sourceFilters, setSourceFilters] = useState<Set<string>>(new Set());
  const [sourceKeyFilter, setSourceKeyFilter] = useState<string | null>(null);
  const [groupBySource, setGroupBySource] = useState(true);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [sourceMenuQuery, setSourceMenuQuery] = useState("");
  const sourceMenuRef = useRef<HTMLDivElement>(null);
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  const [groupCheckingKey, setGroupCheckingKey] = useState<string | null>(null);
  const [scopedChecking, setScopedChecking] = useState(false);
  const [presetPickMode, setPresetPickMode] = useState<"add" | "remove" | null>(null);
  const [presetPickBusy, setPresetPickBusy] = useState(false);
  const [tagFilters, setTagFilters] = useState<Set<string>>(new Set());
  const [allTags, setAllTags] = useState<string[]>([]);
  // Tag management from the filter bar (#233): right-click a tag pill to
  // rename (dialog) or delete (confirm). Left-click stays "filter only".
  const [tagMenu, setTagMenu] = useState<{ tag: string; x: number; y: number } | null>(null);
  const [tagToRename, setTagToRename] = useState<string | null>(null);
  const [tagToDelete, setTagToDelete] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const refreshAfterDeleteRef = useRef<number | null>(null);
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);
  const [batchTagDialogOpen, setBatchTagDialogOpen] = useState(false);
  const [checkingAll, setCheckingAll] = useState(false);
  const [checkingSkillId, setCheckingSkillId] = useState<string | null>(null);
  const [updatingSkillId, setUpdatingSkillId] = useState<string | null>(null);
  const [batchUpdating, setBatchUpdating] = useState(false);
  /** Sequential batch progress: current item + counters (null when idle). */
  const [batchProgress, setBatchProgress] = useState<{
    mode: "update" | "check";
    current: number;
    total: number;
    name: string;
    waiting: number;
  } | null>(null);
  /**
   * Deduped work queue for update/check. Same skill id cannot enter twice while
   * pending or in-flight; after finish it may be enqueued again (re-update OK).
   * Tag/filter changes never clear the queue — only the worker drains it.
   */
  const workQueueRef = useRef<Array<{ id: string; mode: "update" | "check" }>>([]);
  const workPendingRef = useRef<Set<string>>(new Set()); // `${mode}:${id}`
  const workRunningRef = useRef(false);
  const workStatsRef = useRef({ ok: 0, unchanged: 0, failed: 0, processed: 0 });
  const skillsRef = useRef(skills);
  skillsRef.current = skills;
  const skillDisplayNamesRef = useRef<Map<string, string>>(new Map());
  const [toolToggles, setToolToggles] = useState<SkillToolToggle[] | null>(null);
  const [togglingToolKey, setTogglingToolKey] = useState<string | null>(null);
  const [togglingTarget, setTogglingTarget] = useState<{ skillId: string; tool: string } | null>(null);
  const [gitStatus, setGitStatus] = useState<GitBackupStatus | null>(null);
  const [gitRemoteConfig, setGitRemoteConfig] = useState("");
  const [tagEditSkillId, setTagEditSkillId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);

  const [presetSkillOrder, setPresetSkillOrder] = useState<string[]>([]);

  const viewedPresetName = viewedPreset?.name || t("mySkills.currentPresetFallback");

  // Fetch sort order whenever active preset changes
  useEffect(() => {
    if (!viewedPreset) {
      setPresetSkillOrder([]);
      return;
    }
    api.getPresetSkillOrder(viewedPreset.id).then(setPresetSkillOrder).catch(() => {});
  }, [viewedPreset, skills]);

  // Skills with an unresolved sync conflict get a "needs attention" badge
  // that jumps to the Backup page (merge-engine design §4 UI).
  const [conflictIds, setConflictIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    api.gitBackupPendingConflicts()
      .then((rows) => setConflictIds(new Set(rows.map((row) => row.skill_id))))
      .catch(() => setConflictIds(new Set()));
  }, [skills]);

  const refreshAllTags = async () => {
    try {
      const tags = await api.getAllTags();
      setAllTags(tags);
    } catch {
      // not critical
    }
  };

  useEffect(() => {
    refreshAllTags();
  }, [skills]);

  // Close the tag context menu on Escape (click-outside is handled by its backdrop).
  useEffect(() => {
    if (!tagMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTagMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tagMenu]);

  // Source key dropdown: Escape + click outside
  useEffect(() => {
    if (!sourceMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSourceMenuOpen(false);
        setSourceMenuQuery("");
      }
    };
    const onPointer = (e: MouseEvent) => {
      if (sourceMenuRef.current && !sourceMenuRef.current.contains(e.target as Node)) {
        setSourceMenuOpen(false);
        setSourceMenuQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [sourceMenuOpen]);

  const toggleFilter = (set: Set<string>, value: string): Set<string> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const skillDisplayNames = useMemo(() => {
    const nameCounts = new Map<string, number>();
    for (const skill of skills) {
      nameCounts.set(skill.name, (nameCounts.get(skill.name) || 0) + 1);
    }

    const displayNames = new Map<string, string>();
    for (const skill of skills) {
      const dirName = centralDirName(skill);
      displayNames.set(
        skill.id,
        (nameCounts.get(skill.name) || 0) > 1 && dirName !== skill.name
          ? dirName
          : skill.name
      );
    }
    return displayNames;
  }, [skills]);
  skillDisplayNamesRef.current = skillDisplayNames;


  const sourceIndex = useMemo(() => buildSourceIndex(skills), [skills]);

  const filteredSourceIndex = useMemo(() => {
    const q = sourceMenuQuery.trim().toLowerCase();
    if (!q) return sourceIndex;
    return sourceIndex.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.key.toLowerCase().includes(q) ||
        s.channel.toLowerCase().includes(q) ||
        (s.url || "").toLowerCase().includes(q)
    );
  }, [sourceIndex, sourceMenuQuery]);

  const selectedSourceEntry = useMemo(
    () =>
      sourceKeyFilter
        ? sourceIndex.find((s) => s.key === sourceKeyFilter) || null
        : null,
    [sourceIndex, sourceKeyFilter]
  );

  const filtered = useMemo(() => {
    const result = skills.filter((skill) => {
      const displayName = skillDisplayNames.get(skill.id) || skill.name;
      const q = search.trim();
      const qLower = q.toLowerCase();
      const matchesSearch =
        !q ||
        skill.name.toLowerCase().includes(qLower) ||
        displayName.toLowerCase().includes(qLower) ||
        (skill.description || "").toLowerCase().includes(qLower) ||
        skillMatchesSourceSearch(skill, q);
      if (!matchesSearch) return false;

      // Channel pills (source_type) — keep existing multi-select behavior
      if (sourceFilters.size > 0 && !sourceFilters.has(skill.source_type)) return false;

      // Concrete origin (source_key) — AND with other filters; not cleared by search
      if (sourceKeyFilter) {
        if (normalizeSourceKey(skill).key !== sourceKeyFilter) return false;
      }

      if (tagFilters.size > 0) {
        const wantUntagged = tagFilters.has(UNTAGGED_FILTER);
        const matchUntagged = wantUntagged && skill.tags.length === 0;
        const matchTag = skill.tags.some((t) => tagFilters.has(t));
        if (!matchUntagged && !matchTag) return false;
      }

      if (!viewedPreset) return true;

      const enabledInPreset = skill.preset_ids.includes(viewedPreset.id);
      if (filterMode === "enabled") return enabledInPreset;
      if (filterMode === "available") return !enabledInPreset;
      return true;
    });

    // Always sort enabled skills first; within enabled group, use custom sort order
    if (viewedPreset) {
      result.sort((a, b) => {
        const aEnabled = a.preset_ids.includes(viewedPreset.id) ? 0 : 1;
        const bEnabled = b.preset_ids.includes(viewedPreset.id) ? 0 : 1;
        if (aEnabled !== bEnabled) return aEnabled - bEnabled;
        // Within same group, use preset sort order
        const aOrder = presetSkillOrder.indexOf(a.id);
        const bOrder = presetSkillOrder.indexOf(b.id);
        if (aOrder !== -1 && bOrder !== -1) return aOrder - bOrder;
        if (aOrder !== -1) return -1;
        if (bOrder !== -1) return 1;
        return a.name.localeCompare(b.name);
      });
    }

    return result;
  }, [
    skills,
    skillDisplayNames,
    search,
    sourceFilters,
    sourceKeyFilter,
    tagFilters,
    filterMode,
    viewedPreset,
    presetSkillOrder,
  ]);

  const grouped = useMemo(() => {
    if (!groupBySource) return null;
    const map = new Map<string, { meta: NormalizedSource; skills: ManagedSkill[] }>();
    for (const skill of filtered) {
      const meta = normalizeSourceKey(skill);
      const g = map.get(meta.key) || { meta, skills: [] as ManagedSkill[] };
      g.skills.push(skill);
      map.set(meta.key, g);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.meta.label.localeCompare(b.meta.label)
    );
  }, [filtered, groupBySource]);

  const hasActiveFilters =
    !!search.trim() ||
    sourceFilters.size > 0 ||
    !!sourceKeyFilter ||
    tagFilters.size > 0;

  const {
    isMultiSelect, setIsMultiSelect,
    selectedIds,
    toggleSelect,
    isAllSelected,
    anyDisabled,
    handleSelectAll,
    selectKeys,
    exitMultiSelect,
  } = useMultiSelect({
    items: skills,
    filtered,
    getKey: (s) => s.id,
    isItemActive: (s) => viewedPreset ? s.preset_ids.includes(viewedPreset.id) : true,
  });

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.id === detailSkillId) || null,
    [detailSkillId, skills]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !viewedPreset) return;

      // Only reorder enabled skills (they are always at the front)
      const enabledSkills = filtered.filter((s) => s.preset_ids.includes(viewedPreset.id));
      const oldIndex = enabledSkills.findIndex((s) => s.id === active.id);
      const newIndex = enabledSkills.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = [...enabledSkills];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      // Optimistic update
      setPresetSkillOrder(reordered.map((s) => s.id));

      try {
        await api.reorderPresetSkills(viewedPreset.id, reordered.map((s) => s.id));
      } catch {
        // Revert on failure
        await api.getPresetSkillOrder(viewedPreset.id).then(setPresetSkillOrder).catch(() => {});
      }
    },
    [filtered, viewedPreset]
  );

  const canDrag = !!viewedPreset;

  const refreshGitStatus = useCallback(async () => {
    try {
      await api.gitBackupFetch().catch(() => {});
      const status = await api.gitBackupStatus();
      setGitStatus(status);
    } catch {
      // not critical
    }
  }, []);

  // Local-only status refresh: no `git fetch`, so it can fire from
  // dependency-driven effects without driving the file-watcher → refresh
  // → fetch feedback loop.
  const refreshGitStatusLocal = useCallback(async () => {
    try {
      const status = await api.gitBackupStatus();
      setGitStatus(status);
    } catch {
      // not critical
    }
  }, []);

  useEffect(() => {
    (async () => {
      const savedRemote = (await api.getSettings("git_backup_remote_url").catch(() => null))?.trim() || "";
      const status = await api.gitBackupStatus().catch(() => null);
      setGitStatus(status);
      // The saved setting is the single source of truth. Do not backfill from
      // `.git/config` — that made a cleared URL reappear after disconnect (#260).
      setGitRemoteConfig(savedRemote);
    })();
  }, []);

  useEffect(() => {
    const handleWindowFocus = () => {
      refreshGitStatus();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshGitStatus();
      }
    };

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshGitStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshGitStatusLocal();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [skills, refreshGitStatusLocal]);

  useEffect(() => {
    let cancelled = false;
    const loadToggles = async () => {
      if (!selectedSkill || !viewedPreset) {
        setToolToggles(null);
        return;
      }
      if (!selectedSkill.preset_ids.includes(viewedPreset.id)) {
        setToolToggles(null);
        return;
      }
      try {
        const toggles = await api.getSkillToolToggles(selectedSkill.id, viewedPreset.id);
        if (!cancelled) setToolToggles(toggles);
      } catch {
        if (!cancelled) setToolToggles(null);
      }
    };
    loadToggles();
    return () => {
      cancelled = true;
    };
  }, [selectedSkill, viewedPreset]);

  const handleToggleSkillTool = async (toolKey: string, enabled: boolean) => {
    if (!selectedSkill || !viewedPreset) return;
    setTogglingToolKey(toolKey);
    try {
      await api.setSkillToolToggle(selectedSkill.id, viewedPreset.id, toolKey, enabled);
      const displayName = getToolDisplayName(toolKey, tools);
      toast.success(
        enabled
          ? t("mySkills.agentToggleEnabled", { agent: displayName })
          : t("mySkills.agentToggleDisabled", { agent: displayName })
      );
      const [, toggles] = await Promise.all([
        refreshManagedSkills(),
        api.getSkillToolToggles(selectedSkill.id, viewedPreset.id),
      ]);
      setToolToggles(toggles);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
      await refreshManagedSkills();
    } finally {
      setTogglingToolKey(null);
    }
  };

  const handleToggleSkillTarget = useCallback(
    async (skill: ManagedSkill, toolKey: string, enabled: boolean) => {
      if (togglingTarget) return;
      setTogglingTarget({ skillId: skill.id, tool: toolKey });
      const displayName = getToolDisplayName(toolKey, tools);
      try {
        if (enabled) {
          await api.syncSkillToTool(skill.id, toolKey);
          toast.success(t("mySkills.targetInstalled", { name: skill.name, agent: displayName }));
        } else {
          await api.unsyncSkillFromTool(skill.id, toolKey);
          toast.success(t("mySkills.targetUninstalled", { name: skill.name, agent: displayName }));
        }
        await refreshManagedSkills();
      } catch (error: unknown) {
        toast.error(getErrorMessage(error, t("common.error")));
        await refreshManagedSkills();
      } finally {
        setTogglingTarget(null);
      }
    },
    [togglingTarget, tools, t, refreshManagedSkills]
  );

  const scheduleRefreshAfterDelete = useCallback(() => {
    if (refreshAfterDeleteRef.current !== null) {
      window.clearTimeout(refreshAfterDeleteRef.current);
    }
    refreshAfterDeleteRef.current = window.setTimeout(() => {
      refreshAfterDeleteRef.current = null;
      void Promise.all([refreshManagedSkills(), refreshPresets()]);
    }, 300);
  }, [refreshManagedSkills, refreshPresets]);

  useEffect(() => {
    return () => {
      if (refreshAfterDeleteRef.current !== null) {
        window.clearTimeout(refreshAfterDeleteRef.current);
      }
    };
  }, []);

  const handleDeleteSkill = useCallback(
    (skill: ManagedSkill) => {
      setDeletingIds((prev) => {
        if (prev.has(skill.id)) return prev;
        const next = new Set(prev);
        next.add(skill.id);
        return next;
      });
      void (async () => {
        try {
          await api.deleteManagedSkill(skill.id);
          if (selectedSkill?.id === skill.id) closeSkillDetail();
          toast.success(`${skill.name} ${t("mySkills.deleted")}`);
        } catch (error: unknown) {
          toast.error(getErrorMessage(error, t("common.error")));
        } finally {
          setDeletingIds((prev) => {
            if (!prev.has(skill.id)) return prev;
            const next = new Set(prev);
            next.delete(skill.id);
            return next;
          });
          scheduleRefreshAfterDelete();
        }
      })();
    },
    [selectedSkill, closeSkillDetail, t, scheduleRefreshAfterDelete]
  );

  const handleBatchDelete = async () => {
    const ids = Array.from(selectedIds);
    try {
      const result = await api.deleteManagedSkills(ids);
      if (selectedSkill && ids.includes(selectedSkill.id) && !result.failed.includes(selectedSkill.id)) {
        closeSkillDetail();
      }
      if (result.deleted > 0) {
        toast.success(t("mySkills.batchDeleted", { count: result.deleted }));
      }
      if (result.failed.length > 0) {
        toast.error(t("mySkills.batchDeleteFailed", { count: result.failed.length }));
      }
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
    } finally {
      exitMultiSelect();
      setBatchDeleteConfirm(false);
      await Promise.all([refreshManagedSkills(), refreshPresets()]);
    }
  };

  const handleBatchEditTags = async (adds: string[], removes: string[]) => {
    const selectedSkillsList = skills.filter((s) => selectedIds.has(s.id));
    let updated = 0;
    let failed = 0;
    for (const skill of selectedSkillsList) {
      const removeSet = new Set(removes);
      const remaining = skill.tags.filter((tag) => !removeSet.has(tag));
      const merged = [...remaining];
      for (const tag of adds) {
        if (!merged.includes(tag)) merged.push(tag);
      }
      const changed =
        merged.length !== skill.tags.length ||
        merged.some((tag, i) => tag !== skill.tags[i]);
      if (!changed) continue;
      try {
        await api.setSkillTags(skill.id, merged);
        updated++;
      } catch {
        failed++;
      }
    }
    if (updated > 0) {
      toast.success(t("mySkills.batchTagsUpdated", { count: updated }));
    }
    if (failed > 0) {
      toast.error(t("mySkills.batchTagsFailed", { count: failed }));
    }
    await refreshManagedSkills();
    await refreshAllTags();
  };

  const handleBatchTogglePreset = async () => {
    if (!viewedPreset) return;
    const selectedSkillsList = skills.filter((s) => selectedIds.has(s.id));
    const enabling = anyDisabled;
    let count = 0;
    let failed = 0;
    for (const skill of selectedSkillsList) {
      try {
        const enabledInPreset = skill.preset_ids.includes(viewedPreset.id);
        if (enabling && !enabledInPreset) {
          await api.addSkillToPreset(skill.id, viewedPreset.id);
          count++;
        } else if (!enabling && enabledInPreset) {
          await api.removeSkillFromPreset(skill.id, viewedPreset.id);
          count++;
        }
      } catch {
        failed++;
        // continue with remaining
      }
    }
    if (count > 0) {
      toast.success(enabling
        ? t("mySkills.batchEnabled", { count })
        : t("mySkills.batchDisabled", { count }));
    }
    if (failed > 0) {
      toast.error(t("mySkills.batchToggleFailed", { count: failed }));
    }
    await Promise.all([refreshManagedSkills(), refreshPresets()]);
  };

  const displayNameOf = (skill: ManagedSkill) =>
    skillDisplayNamesRef.current.get(skill.id) || skill.name;

  const workKey = (mode: "update" | "check", id: string) => `${mode}:${id}`;

  const publishQueueProgress = (
    mode: "update" | "check",
    name: string,
  ) => {
    const waiting = workQueueRef.current.filter((q) => q.mode === mode).length;
    const processed = workStatsRef.current.processed;
    // current item counts as processed+1; total = done + active + still waiting for this drain wave
    const total = processed + 1 + waiting;
    setBatchProgress({
      mode,
      current: processed + 1,
      total: Math.max(total, 1),
      name,
      waiting,
    });
  };

  /**
   * Drain deduped FIFO queue. Safe to call while running (no-op if already draining).
   * New enqueueUpdates/enqueueChecks can append while this loop is mid-flight.
   */
  const drainWorkQueue = async () => {
    if (workRunningRef.current) return;
    workRunningRef.current = true;
    workStatsRef.current = { ok: 0, unchanged: 0, failed: 0, processed: 0 };
    setBatchUpdating(true);
    setScopedChecking(true);
    let lastMode: "update" | "check" | null = null;
    try {
      while (workQueueRef.current.length > 0) {
        const job = workQueueRef.current.shift()!;
        lastMode = job.mode;
        const skill = skillsRef.current.find((s) => s.id === job.id);
        const name = skill ? displayNameOf(skill) : job.id;
        publishQueueProgress(job.mode, name);

        if (job.mode === "update") {
          setUpdatingSkillId(job.id);
          setCheckingSkillId(null);
        } else {
          setCheckingSkillId(job.id);
          setUpdatingSkillId(null);
        }

        try {
          if (!skill) {
            workStatsRef.current.failed += 1;
          } else if (job.mode === "check") {
            await api.checkSkillUpdate(skill.id, true);
            workStatsRef.current.ok += 1;
          } else if (
            skill.source_type === "local" ||
            skill.source_type === "import"
          ) {
            await api.reimportLocalSkill(skill.id);
            workStatsRef.current.ok += 1;
          } else {
            const result = await api.updateSkill(skill.id);
            if (result.content_changed) workStatsRef.current.ok += 1;
            else workStatsRef.current.unchanged += 1;
          }
        } catch {
          workStatsRef.current.failed += 1;
        } finally {
          workPendingRef.current.delete(workKey(job.mode, job.id));
          workStatsRef.current.processed += 1;
        }
      }

      const { ok, unchanged, failed } = workStatsRef.current;
      if (lastMode === "check") {
        toast.success(
          t("mySkills.checkProgressDone", {
            ok,
            total: workStatsRef.current.processed,
            failed,
          })
        );
      } else if (lastMode === "update") {
        toast.success(
          t("mySkills.batchProgressDone", { ok, unchanged, failed })
        );
      }
    } finally {
      setUpdatingSkillId(null);
      setCheckingSkillId(null);
      setBatchProgress(null);
      workRunningRef.current = false;
      setBatchUpdating(false);
      setScopedChecking(false);
      setGroupCheckingKey(null);
      // If something was enqueued after we exited the while but before clearing running, re-drain
      if (workQueueRef.current.length > 0) {
        void drainWorkQueue();
        return;
      }
      await refreshManagedSkills();
    }
  };

  /**
   * Enqueue skills for update. Dedupes by id while pending/in-flight.
   * Allows repeat enqueue after a skill finishes (re-update OK).
   * Does not lock tag/filter UI.
   */
  const enqueueUpdates = (targetSkills: ManagedSkill[]) => {
    const candidates = targetSkills.filter(
      (s) =>
        s.source_type === "git" ||
        s.source_type === "skillssh" ||
        ((s.source_type === "local" || s.source_type === "import") &&
          !!s.source_ref)
    );
    if (candidates.length === 0) {
      toast.info(t("mySkills.noUpdateableInScope"));
      return;
    }
    let added = 0;
    let skipped = 0;
    for (const skill of candidates) {
      const key = workKey("update", skill.id);
      if (workPendingRef.current.has(key)) {
        skipped += 1;
        continue;
      }
      workPendingRef.current.add(key);
      workQueueRef.current.push({ id: skill.id, mode: "update" });
      added += 1;
    }
    if (added === 0) {
      toast.info(t("mySkills.batchNothingNew"));
      return;
    }
    if (skipped > 0) {
      toast.info(t("mySkills.batchQueued", { added, skipped }));
    } else if (workRunningRef.current) {
      toast.info(t("mySkills.batchQueuedOnly", { added }));
    }
    void drainWorkQueue();
  };

  const enqueueChecks = (targetSkills: ManagedSkill[]) => {
    const candidates = targetSkills.filter(
      (s) =>
        s.source_type === "git" ||
        s.source_type === "skillssh" ||
        ((s.source_type === "local" || s.source_type === "import") &&
          !!s.source_ref)
    );
    if (candidates.length === 0) {
      toast.info(t("mySkills.noUpdateableInScope"));
      return;
    }
    let added = 0;
    let skipped = 0;
    for (const skill of candidates) {
      const key = workKey("check", skill.id);
      if (workPendingRef.current.has(key)) {
        skipped += 1;
        continue;
      }
      workPendingRef.current.add(key);
      workQueueRef.current.push({ id: skill.id, mode: "check" });
      added += 1;
    }
    if (added === 0) {
      toast.info(t("mySkills.batchNothingNew"));
      return;
    }
    if (skipped > 0) {
      toast.info(t("mySkills.batchQueued", { added, skipped }));
    } else if (workRunningRef.current) {
      toast.info(t("mySkills.batchQueuedOnly", { added }));
    }
    void drainWorkQueue();
  };

  const handleBatchRefresh = () => {
    const selected = skills.filter((skill) => selectedIds.has(skill.id));
    const updatable = selected.filter(
      (skill) => skill.update_status === "update_available" && canRefresh(skill)
    );
    const targets =
      updatable.length > 0 ? updatable : selected.filter((s) => canRefresh(s));
    enqueueUpdates(targets);
  };

  /** Toolbar update count is scoped to current Library filters. */
  const handleUpdateAvailableSkills = () => {
    const updatableSkills = filtered.filter(
      (skill) => skill.update_status === "update_available" && canRefresh(skill)
    );
    enqueueUpdates(updatableSkills);
  };

  const handleTogglePreset = async (skill: ManagedSkill) => {
    if (!viewedPreset) return;
    const enabledInPreset = skill.preset_ids.includes(viewedPreset.id);
    if (enabledInPreset) {
      await api.removeSkillFromPreset(skill.id, viewedPreset.id);
      toast.success(`${skill.name} ${t("mySkills.disabledInPreset")}`);
    } else {
      await api.addSkillToPreset(skill.id, viewedPreset.id);
      toast.success(`${skill.name} ${t("mySkills.enabledInPreset")}`);
    }
    await Promise.all([refreshManagedSkills(), refreshPresets()]);
  };

  const handleCheckAllUpdates = async () => {
    // Whole-library check stays one backend call (no per-item progress).
    setCheckingAll(true);
    try {
      await api.checkAllSkillUpdates(true);
      toast.success(t("mySkills.updateActions.checkedAll"));
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
    } finally {
      await refreshManagedSkills();
      setCheckingAll(false);
    }
  };

  const handleCheckUpdate = async (skill: ManagedSkill) => {
    setCheckingSkillId(skill.id);
    try {
      await api.checkSkillUpdate(skill.id, true);
      await refreshManagedSkills();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
      await refreshManagedSkills();
    } finally {
      setCheckingSkillId(null);
    }
  };

  const handleScopedCheckUpdates = (targetSkills: ManagedSkill[]) => {
    enqueueChecks(targetSkills);
  };

  const handleGroupCheckUpdates = (
    groupSkills: ManagedSkill[],
    key: string
  ) => {
    setGroupCheckingKey(key);
    enqueueChecks(groupSkills);
    // clear group spinner when queue idle — next tick after enqueue
    queueMicrotask(() => {
      if (!workRunningRef.current) setGroupCheckingKey(null);
    });
  };

  const handleGroupUpdateAvailable = (groupSkills: ManagedSkill[]) => {
    const updatable = groupSkills.filter(
      (skill) => skill.update_status === "update_available" && canRefresh(skill)
    );
    enqueueUpdates(updatable);
  };

  const handleBatchAddToPreset = async (presetId: string) => {
    const ids = [...selectedIds];
    let added = 0;
    let skipped = 0;
    let failed = 0;
    setPresetPickBusy(true);
    try {
      for (const id of ids) {
        const skill = skills.find((s) => s.id === id);
        if (!skill) continue;
        if (skill.preset_ids.includes(presetId)) {
          skipped += 1;
          continue;
        }
        try {
          await api.addSkillToPreset(id, presetId);
          added += 1;
        } catch {
          failed += 1;
        }
      }
      if (added > 0) toast.success(t("mySkills.batchPresetAdded", { count: added }));
      if (skipped > 0) toast.info(t("mySkills.batchPresetSkipped", { count: skipped }));
      if (failed > 0) toast.error(t("mySkills.batchPresetFailed", { count: failed }));
      await Promise.all([refreshManagedSkills(), refreshPresets()]);
      setPresetPickMode(null);
    } finally {
      setPresetPickBusy(false);
    }
  };

  const handleBatchRemoveFromPreset = async (presetId: string) => {
    const ids = [...selectedIds];
    let removed = 0;
    let failed = 0;
    setPresetPickBusy(true);
    try {
      for (const id of ids) {
        const skill = skills.find((s) => s.id === id);
        if (!skill || !skill.preset_ids.includes(presetId)) continue;
        try {
          await api.removeSkillFromPreset(id, presetId);
          removed += 1;
        } catch {
          failed += 1;
        }
      }
      if (removed > 0) toast.success(t("mySkills.batchPresetRemoved", { count: removed }));
      if (failed > 0) toast.error(t("mySkills.batchPresetFailed", { count: failed }));
      await Promise.all([refreshManagedSkills(), refreshPresets()]);
      setPresetPickMode(null);
    } finally {
      setPresetPickBusy(false);
    }
  };

  const toggleGroupCollapsed = (key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleRefreshSkill = async (skill: ManagedSkill) => {
    setUpdatingSkillId(skill.id);
    try {
      if (skill.source_type === "local" || skill.source_type === "import") {
        await api.reimportLocalSkill(skill.id);
        toast.success(t("mySkills.updateActions.reimported"));
      } else {
        const result = await api.updateSkill(skill.id);
        if (result.content_changed) {
          toast.success(t("mySkills.updateActions.updated"));
        } else {
          toast.info(t("mySkills.updateActions.alreadyUpToDate"));
        }
      }
      await refreshManagedSkills();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
      await refreshManagedSkills();
    } finally {
      setUpdatingSkillId(null);
    }
  };

  const handleRelinkSource = async (skill: ManagedSkill) => {
    const selected = await dialogOpen({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;

    setUpdatingSkillId(skill.id);
    try {
      await api.relinkLocalSkillSource(skill.id, selected);
      toast.success(t("mySkills.updateActions.relinked"));
      await refreshManagedSkills();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
      await refreshManagedSkills();
    } finally {
      setUpdatingSkillId(null);
    }
  };

  const handleDetachSource = async (skill: ManagedSkill) => {
    setUpdatingSkillId(skill.id);
    try {
      await api.detachLocalSkillSource(skill.id);
      toast.success(t("mySkills.updateActions.detachedSource"));
      await refreshManagedSkills();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
      await refreshManagedSkills();
    } finally {
      setUpdatingSkillId(null);
    }
  };

  const handleAddTag = async (skill: ManagedSkill, inputValue?: string) => {
    const trimmed = (inputValue ?? tagInput).trim();
    if (!trimmed || skill.tags.includes(trimmed)) {
      setTagInput("");
      return;
    }
    try {
      await api.setSkillTags(skill.id, [...skill.tags, trimmed]);
      toast.success(t("mySkills.tags.tagAdded"));
      setTagEditSkillId(null);
      setTagInput("");
      await refreshManagedSkills();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
    }
  };

  const handleRemoveTag = async (skill: ManagedSkill, tagToRemove: string) => {
    try {
      await api.setSkillTags(skill.id, skill.tags.filter((t) => t !== tagToRemove));
      toast.success(t("mySkills.tags.tagsUpdated"));
      await refreshManagedSkills();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
    }
  };

  // Replace `oldTag` with `newTag` in the active filter set so the current
  // filtering survives a rename/delete.
  const replaceTagInFilters = (oldTag: string, newTag?: string) =>
    setTagFilters((prev) => {
      if (!prev.has(oldTag)) return prev;
      const next = new Set(prev);
      next.delete(oldTag);
      if (newTag) next.add(newTag);
      return next;
    });

  // Throws on failure so the rename dialog stays open (it only closes after a
  // resolved onRename), matching how RenamePresetDialog behaves.
  const handleRenameTag = async (newName: string) => {
    const oldName = tagToRename;
    if (oldName === null) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    try {
      await api.renameTag(oldName, trimmed);
      replaceTagInFilters(oldName, trimmed);
      toast.success(t("mySkills.tags.tagRenamed"));
      await refreshManagedSkills();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
      throw error;
    }
  };

  const handleDeleteTag = async () => {
    const tag = tagToDelete;
    if (tag === null) return;
    try {
      await api.deleteTag(tag);
      replaceTagInFilters(tag);
      toast.success(t("mySkills.tags.tagDeleted"));
      await refreshManagedSkills();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
    }
  };

  const getTagOptions = (skill: ManagedSkill, keyword: string) => {
    const needle = keyword.trim().toLowerCase();
    return allTags.filter((tag) => {
      if (skill.tags.includes(tag)) return false;
      if (!needle) return true;
      return tag.toLowerCase().includes(needle);
    });
  };

  type GitToolbarMode =
    | "loading"
    | "uninitialized"
    | "needs_remote"
    | "needs_fix"
    | "up_to_date"
    | "pending_changes";

  const getGitToolbarMode = (): GitToolbarMode => {
    if (!gitStatus) return "loading";
    if (!gitStatus.is_repo) return "uninitialized";
    if (!gitStatus.remote_url && !gitRemoteConfig) return "needs_remote";
    if (
      gitStatus.upstream_health === "unrelated_histories"
      || gitStatus.upstream_health === "detached"
    ) {
      return "needs_fix";
    }
    // First-push case: remote is set but upstream tracking is not yet established.
    // Treat as a normal pending sync — the push path will set upstream automatically.
    if (gitStatus.upstream_health === "no_upstream") {
      return "pending_changes";
    }
    if (gitStatus.has_changes || gitStatus.ahead > 0 || gitStatus.behind > 0) {
      return "pending_changes";
    }
    return "up_to_date";
  };

  const getGitStatusMeta = (mode: GitToolbarMode) => {
    if (mode === "loading") {
      return {
        icon: Loader2,
        label: t("backup.status.loading"),
        className: "text-muted",
        iconClassName: "animate-spin",
      };
    }
    if (mode === "uninitialized" || mode === "needs_remote") {
      return {
        icon: GitBranch,
        label: t("backup.status.notConnected"),
        className: "text-muted",
        iconClassName: "",
      };
    }
    if (mode === "needs_fix") {
      return {
        icon: Wrench,
        label: t("backup.status.needsFix"),
        className: "text-red-500",
        iconClassName: "",
      };
    }
    if (mode === "pending_changes") {
      return {
        icon: ArrowUpCircle,
        label: t("backup.status.pending"),
        className: "text-amber-600 dark:text-amber-400",
        iconClassName: "",
      };
    }
    return {
      icon: CheckCircle2,
      label: t("backup.status.synced"),
      className: "text-muted",
      iconClassName: "",
    };
  };

  const sourceIcon = (type: string) => {
    switch (type) {
      case "git":
      case "skillssh":
        return <Github className="h-3 w-3" />;
      case "local":
      case "import":
        return <HardDrive className="h-3 w-3" />;
      default:
        return <Globe className="h-3 w-3" />;
    }
  };

  const canRefresh = (skill: ManagedSkill) =>
    skill.source_type === "git" ||
    skill.source_type === "skillssh" ||
    ((skill.source_type === "local" || skill.source_type === "import") && !!skill.source_ref);

  const anyRefreshableSelected = useMemo(
    () => skills.some((skill) => selectedIds.has(skill.id) && canRefresh(skill)),
    [skills, selectedIds]
  );
  // Scoped to current Library filters (search x channel x source_key x tags x preset mode)
  const availableUpdateCount = useMemo(
    () =>
      filtered.filter(
        (skill) => skill.update_status === "update_available" && canRefresh(skill)
      ).length,
    [filtered]
  );
  const libraryWideUpdateCount = useMemo(
    () =>
      skills.filter(
        (skill) => skill.update_status === "update_available" && canRefresh(skill)
      ).length,
    [skills]
  );
  const refreshableSelectedCount = useMemo(() => {
    const selected = skills.filter(
      (skill) => selectedIds.has(skill.id) && canRefresh(skill)
    );
    const updatable = selected.filter((s) => s.update_status === "update_available");
    return updatable.length > 0 ? updatable.length : selected.length;
  }, [skills, selectedIds]);

  const sourceTypeLabel = (skill: ManagedSkill) =>
    skill.source_type === "skillssh" ? "skills.sh" : skill.source_type;

  const refreshLabel = (skill: ManagedSkill) =>
    skill.source_type === "local" || skill.source_type === "import"
      ? t("mySkills.updateActions.reimport")
      : t("mySkills.updateActions.update");

  const statusBadge = (skill: ManagedSkill) => {
    if (skill.update_status === "update_available") {
      return {
        label: "Update",
        className: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
      };
    }
    if (skill.update_status === "source_missing") {
      return {
        label: t("mySkills.updateStatus.sourceMissing"),
        className: "bg-red-500/10 text-red-600 dark:text-red-300",
      };
    }
    if (skill.update_status === "error") {
      return {
        label: t("mySkills.updateStatus.error"),
        className: "bg-red-500/10 text-red-600 dark:text-red-300",
      };
    }
    return null;
  };

  return (
    <div className="app-page">
      <div className="app-page-header pr-2 pb-1 flex items-center justify-between gap-3">
        <h1 className="app-page-title flex items-center gap-2">
          {t("mySkills.title")}
          <span className="app-badge">
            {skills.length}
          </span>
        </h1>

      </div>

      <div className="app-toolbar">
        <div className="flex flex-1 gap-3">
          <div className="relative w-full max-w-[280px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("mySkills.searchPlaceholder")}
              className="app-input w-full pl-9 font-medium"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>

          <div className="app-segmented">
            {(["all", "enabled", "available"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                className={cn(
                  "app-segmented-button",
                  filterMode === mode && "app-segmented-button-active"
                )}
              >
                {t(`mySkills.filters.${mode}`)}
              </button>
            ))}
          </div>

        </div>

        <div className="app-segmented">
          {(() => {
            const mode = getGitToolbarMode();
            const meta = getGitStatusMeta(mode);
            const Icon = meta.icon;
            return (
              <button
                type="button"
                onClick={() => navigate("/backup")}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-3 py-2 text-[13px] font-medium transition-colors hover:bg-surface-hover hover:text-secondary",
                  meta.className
                )}
                title={t("sidebar.backup")}
              >
                <Icon className={cn("h-3.5 w-3.5", meta.iconClassName)} />
                {meta.label}
              </button>
            );
          })()}
          <button
            onClick={handleCheckAllUpdates}
            disabled={checkingAll}
            className="ml-2 mr-2 inline-flex items-center gap-1 rounded-md border-l border-border-subtle pl-4 pr-3 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-secondary disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", checkingAll && "animate-spin")} />
            {t("mySkills.updateActions.checkAll")}
          </button>
          <button
            onClick={handleUpdateAvailableSkills}
            disabled={availableUpdateCount === 0}
            title={
              hasActiveFilters
                ? t("mySkills.updateFiltered", { count: availableUpdateCount }) +
                  (libraryWideUpdateCount !== availableUpdateCount
                    ? ` / ${t("mySkills.updateActions.updateAvailable", { count: libraryWideUpdateCount })}`
                    : "")
                : undefined
            }
            className="mr-2 inline-flex items-center gap-1 rounded-md px-3 py-2 text-[13px] font-medium text-accent-light transition-colors hover:bg-accent-bg disabled:opacity-50"
          >
            <RotateCcw className={cn("h-3.5 w-3.5", batchUpdating && "animate-spin")} />
            {hasActiveFilters
              ? t("mySkills.updateFiltered", { count: availableUpdateCount })
              : t("mySkills.updateActions.updateAvailable", {
                  count: availableUpdateCount,
                })}
          </button>
          <button
            onClick={() => setViewMode("grid")}
            className={cn(
              "rounded-md p-2 transition-colors outline-none",
              viewMode === "grid" ? "bg-surface-active text-secondary" : "text-muted hover:text-tertiary"
            )}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={cn(
              "rounded-md p-2 transition-colors outline-none",
              viewMode === "list" ? "bg-surface-active text-secondary" : "text-muted hover:text-tertiary"
            )}
          >
            <List className="h-4 w-4" />
          </button>
          <button
            onClick={() => isMultiSelect ? exitMultiSelect() : setIsMultiSelect(true)}
            className={cn(
              "rounded-md p-2 transition-colors outline-none",
              isMultiSelect ? "bg-surface-active text-secondary" : "text-muted hover:text-tertiary"
            )}
            title={isMultiSelect ? t("mySkills.cancelSelect") : t("mySkills.selectMode")}
          >
            <SquareCheck className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 px-1 -mt-2 -mb-3">
        {(["local", "import", "git", "skillssh"] as const).map((src) => (
          <button
            key={src}
            onClick={() => setSourceFilters(toggleFilter(sourceFilters, src))}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-colors",
              sourceFilters.has(src)
                ? "bg-accent text-white dark:bg-accent dark:text-white"
                : "bg-surface-hover text-muted hover:text-secondary"
            )}
          >
            {t(`mySkills.sourceFilter.${src}`)}
          </button>
        ))}

        <span className="mx-0.5 h-3 w-px bg-border-subtle" />

        {/* Concrete source_key filter (searchable dropdown) */}
        <div className="relative" ref={sourceMenuRef}>
          <button
            type="button"
            onClick={() => {
              setSourceMenuOpen((open) => !open);
              if (sourceMenuOpen) setSourceMenuQuery("");
            }}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-colors",
              sourceKeyFilter
                ? "bg-accent text-white dark:bg-accent dark:text-white"
                : "bg-surface-hover text-muted hover:text-secondary"
            )}
            title={t("mySkills.sourceKeyFilter.placeholder")}
          >
            {sourceKeyFilter
              ? selectedSourceEntry?.label || t("mySkills.unknownSource")
              : t("mySkills.sourceKeyFilter.all")}
            {sourceKeyFilter ? (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  setSourceKeyFilter(null);
                  setSourceMenuOpen(false);
                  setSourceMenuQuery("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    setSourceKeyFilter(null);
                    setSourceMenuOpen(false);
                    setSourceMenuQuery("");
                  }
                }}
                className="ml-0.5 inline-flex rounded-full p-0.5 hover:bg-white/20"
                title={t("mySkills.sourceKeyFilter.clear")}
                aria-label={t("mySkills.sourceKeyFilter.clear")}
              >
                <X className="h-3 w-3" />
              </span>
            ) : (
              <ChevronDown className="h-3 w-3 opacity-70" />
            )}
          </button>

          {sourceMenuOpen && (
            <div className="absolute left-0 top-full z-40 mt-1 w-80 max-w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
              <div className="border-b border-border-subtle p-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                  <input
                    type="text"
                    value={sourceMenuQuery}
                    onChange={(e) => setSourceMenuQuery(e.target.value)}
                    placeholder={t("mySkills.sourceKeyFilter.search")}
                    className="app-input w-full py-1.5 pl-8 pr-2 text-[12px]"
                    autoFocus
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>
              </div>
              <div className="max-h-60 overflow-y-auto py-1">
                <button
                  type="button"
                  onClick={() => {
                    setSourceKeyFilter(null);
                    setSourceMenuOpen(false);
                    setSourceMenuQuery("");
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-surface-hover",
                    !sourceKeyFilter ? "bg-accent-bg text-accent-light" : "text-secondary"
                  )}
                >
                  <span className="font-medium">{t("mySkills.sourceKeyFilter.all")}</span>
                </button>
                {filteredSourceIndex.length === 0 ? (
                  <div className="px-3 py-3 text-center text-[12px] text-muted">
                    {t("mySkills.noMatch")}
                  </div>
                ) : (
                  filteredSourceIndex.map((entry) => {
                    const primary =
                      entry.label || t("mySkills.unknownSource");
                    // Secondary line: host or full ref when label is short owner/repo
                    const secondary =
                      entry.url && entry.url !== primary
                        ? entry.url
                            .replace(/^https?:\/\//i, "")
                            .replace(/\.git$/i, "")
                        : entry.key.startsWith("git:") ||
                            entry.key.startsWith("skillssh:")
                          ? entry.key.replace(/^(git|skillssh):/, "")
                          : null;
                    return (
                    <button
                      key={entry.key}
                      type="button"
                      onClick={() => {
                        setSourceKeyFilter(entry.key);
                        setSourceMenuOpen(false);
                        setSourceMenuQuery("");
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-surface-hover",
                        sourceKeyFilter === entry.key
                          ? "bg-accent-bg text-accent-light"
                          : "text-secondary"
                      )}
                      title={entry.url || entry.key}
                    >
                      <span className="shrink-0 text-muted">
                        {sourceIcon(entry.channel)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {primary}
                        </span>
                        {secondary && secondary !== primary && (
                          <span className="block truncate text-[10px] text-muted opacity-80">
                            {secondary}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted">
                        {t("mySkills.sourceKeyFilter.count", { count: entry.count })}
                      </span>
                    </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Group-by toggle (list grouping lands in Task 3; state is live now) */}
        <button
          type="button"
          onClick={() => setGroupBySource((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-colors",
            groupBySource
              ? "bg-accent text-white dark:bg-accent dark:text-white"
              : "bg-surface-hover text-muted hover:text-secondary"
          )}
          title={t("mySkills.groupBySource")}
          aria-pressed={groupBySource}
        >
          <FolderTree className="h-3 w-3" />
          {t("mySkills.groupBySource")}
        </button>

        {allTags.length > 0 && (
          <>
            <span className="mx-0.5 h-3 w-px bg-border-subtle" />
            {skills.some((s) => s.tags.length === 0) && (() => {
              const isActive = tagFilters.has(UNTAGGED_FILTER);
              return (
                <button
                  onClick={() => setTagFilters(toggleFilter(tagFilters, UNTAGGED_FILTER))}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-colors",
                    isActive
                      ? "bg-surface-active text-primary"
                      : "border border-dashed border-border text-muted hover:text-secondary"
                  )}
                  title={t("mySkills.tags.untagged")}
                >
                  <CircleSlash className="h-3 w-3" />
                  {t("mySkills.tags.untagged")}
                </button>
              );
            })()}
            {allTags.map((tag) => {
              const isActive = tagFilters.has(tag);
              return (
                <button
                  key={tag}
                  onClick={() => setTagFilters(toggleFilter(tagFilters, tag))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setTagMenu({
                      tag,
                      x: Math.min(e.clientX, window.innerWidth - 160),
                      y: Math.min(e.clientY, window.innerHeight - 90),
                    });
                  }}
                  title={t("mySkills.tags.manageHint")}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-colors",
                    isActive ? getTagActiveColor(tag, allTags) : getTagColor(tag, allTags)
                  )}
                >
                  {tag}
                </button>
              );
            })}
          </>
        )}
      </div>

      {batchProgress && (
        <div className="mx-1 mb-1 rounded-lg border border-accent/30 bg-accent-bg/40 px-3 py-2">
          <div className="mb-1 flex items-center justify-between gap-2 text-[12px] text-secondary">
            <span className="min-w-0 truncate font-medium">
              {batchProgress.mode === "check"
                ? t("mySkills.checkProgress", {
                    current: batchProgress.current,
                    total: batchProgress.total,
                    name: batchProgress.name,
                  })
                : t("mySkills.updateProgress", {
                    current: batchProgress.current,
                    total: batchProgress.total,
                    name: batchProgress.name,
                  })}
            </span>
            <span className="shrink-0 text-muted">
              {batchProgress.current}/{batchProgress.total}
              {batchProgress.waiting > 0
                ? ` · ${t("mySkills.queueRemaining", { n: batchProgress.waiting })}`
                : ""}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-hover">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{
                width: `${Math.round(
                  (batchProgress.current / Math.max(batchProgress.total, 1)) * 100
                )}%`,
              }}
            />
          </div>
        </div>
      )}

      {isMultiSelect && (
        <MultiSelectToolbar
          selectedCount={selectedIds.size}
          isAllSelected={isAllSelected}
          anyDisabled={viewedPreset ? anyDisabled : false}
          anyUpdatable={anyRefreshableSelected}
          showToggle={!!viewedPreset}
          updating={batchUpdating}
          checking={scopedChecking}
          labels={{
            hint: t("mySkills.selectHint"),
            selected: t("mySkills.selectedCount", { count: selectedIds.size }),
            update: t("mySkills.batchUpdate", { count: refreshableSelectedCount }),
            delete: t("mySkills.deleteSelected", { count: selectedIds.size }),
            enable: t("mySkills.batchEnable", { count: selectedIds.size }),
            disable: t("mySkills.batchDisable", { count: selectedIds.size }),
            selectAll: t("mySkills.selectAll"),
            deselectAll: t("mySkills.deselectAll"),
            cancel: t("common.cancel"),
            editTags: t("mySkills.batchEditTags", { count: selectedIds.size }),
            addToPreset: t("mySkills.batchAddToPreset"),
            removeFromPreset: t("mySkills.batchRemoveFromPreset"),
            checkUpdates: t("mySkills.sourceGroup.checkUpdates"),
          }}
          onUpdate={handleBatchRefresh}
          onDelete={() => setBatchDeleteConfirm(true)}
          onToggle={handleBatchTogglePreset}
          onSelectAll={handleSelectAll}
          onCancel={exitMultiSelect}
          onEditTags={() => setBatchTagDialogOpen(true)}
          onAddToPreset={() => setPresetPickMode("add")}
          onRemoveFromPreset={() => setPresetPickMode("remove")}
          onCheckUpdates={() =>
            handleScopedCheckUpdates(skills.filter((s) => selectedIds.has(s.id)))
          }
        />
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center pb-20 text-center">
          <Layers className="mb-4 h-12 w-12 text-faint" />
          <h3 className="mb-1.5 text-[14px] font-semibold text-tertiary">{t("mySkills.noSkills")}</h3>
          <p className="text-[13px] text-muted">
            {skills.length === 0 ? t("mySkills.addFirst") : t("mySkills.noMatch")}
          </p>
          {skills.length > 0 && hasActiveFilters && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {!!search.trim() && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="rounded-md border border-border-subtle px-2.5 py-1 text-[12px] text-secondary hover:bg-surface-hover"
                >
                  {t("mySkills.clearSearch")}
                </button>
              )}
              {tagFilters.size > 0 && (
                <button
                  type="button"
                  onClick={() => setTagFilters(new Set())}
                  className="rounded-md border border-border-subtle px-2.5 py-1 text-[12px] text-secondary hover:bg-surface-hover"
                >
                  {t("mySkills.clearTags")}
                </button>
              )}
              {sourceKeyFilter && (
                <button
                  type="button"
                  onClick={() => setSourceKeyFilter(null)}
                  className="rounded-md border border-border-subtle px-2.5 py-1 text-[12px] text-secondary hover:bg-surface-hover"
                >
                  {t("mySkills.clearSourceKey")}
                </button>
              )}
              {sourceFilters.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSourceFilters(new Set())}
                  className="rounded-md border border-border-subtle px-2.5 py-1 text-[12px] text-secondary hover:bg-surface-hover"
                >
                  {t("mySkills.clearFilters")}
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={filtered.map((s) => s.id)}
            strategy={viewMode === "grid" ? rectSortingStrategy : verticalListSortingStrategy}
          >
          <div className="flex flex-col gap-3 pb-8">
          {(grouped ?? [{ meta: null as NormalizedSource | null, skills: filtered }]).map((group) => {
            const groupKey = group.meta?.key ?? "__flat__";
            const collapsed = group.meta ? collapsedKeys.has(group.meta.key) : false;
            const updatableInGroup = group.skills.filter(
              (s) => s.update_status === "update_available" && canRefresh(s)
            ).length;
            const refreshableInGroup = group.skills.filter((s) => canRefresh(s)).length;
            return (
              <div key={groupKey} className="flex flex-col gap-2">
                {group.meta && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-surface-hover/40 px-2.5 py-1.5">
                    <button
                      type="button"
                      onClick={() => toggleGroupCollapsed(group.meta!.key)}
                      className="inline-flex items-center gap-1 text-[13px] font-semibold text-secondary hover:text-primary"
                    >
                      {collapsed ? (
                        <ChevronRight className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                      <span className="text-muted">{sourceIcon(group.meta.channel)}</span>
                      <span>{group.meta.label || t("mySkills.unknownSource")}</span>
                    </button>
                    <span className="text-[12px] text-muted">
                      {t("mySkills.sourceKeyFilter.count", { count: group.skills.length })}
                      {updatableInGroup > 0
                        ? ` · ${t("mySkills.sourceKeyFilter.updatable", { count: updatableInGroup })}`
                        : ""}
                    </span>
                    <div className="ml-auto flex flex-wrap items-center gap-1">
                      {refreshableInGroup > 0 && (
                        <button
                          type="button"
                          onClick={() => handleGroupCheckUpdates(group.skills, group.meta!.key)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-muted hover:bg-surface-hover hover:text-secondary"
                        >
                          <RefreshCw
                            className={cn(
                              "h-3 w-3",
                              groupCheckingKey === group.meta.key && "animate-spin"
                            )}
                          />
                          {t("mySkills.sourceGroup.checkUpdates")}
                        </button>
                      )}
                      {updatableInGroup > 0 && (
                        <button
                          type="button"
                          onClick={() => handleGroupUpdateAvailable(group.skills)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-accent-light hover:bg-accent-bg"
                        >
                          <RotateCcw className={cn("h-3 w-3", batchUpdating && "animate-spin")} />
                          {t("mySkills.sourceGroup.updateAvailable", {
                            count: updatableInGroup,
                          })}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => selectKeys(group.skills.map((s) => s.id))}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-muted hover:bg-surface-hover hover:text-secondary"
                      >
                        <SquareCheck className="h-3 w-3" />
                        {t("mySkills.sourceGroup.selectAll")}
                      </button>
                    </div>
                  </div>
                )}
                {!collapsed && (
          <div
            className={cn(
              viewMode === "grid"
                ? "grid grid-cols-2 gap-3 lg:grid-cols-3"
                : "flex flex-col gap-0.5"
            )}
          >
          {group.skills.map((skill) => {
            const enabledInPreset = viewedPreset
              ? skill.preset_ids.includes(viewedPreset.id)
              : false;
            const badge = statusBadge(skill);
            const isMissingLocalSource =
              skill.update_status === "source_missing"
              && (skill.source_type === "local" || skill.source_type === "import");
            const displayName = skillDisplayNames.get(skill.id) || skill.name;

            if (viewMode === "grid") {
              return (
                <SortableSkillItem
                  key={skill.id}
                  id={skill.id}
                  disabled={!canDrag}
                  className={tagEditSkillId === skill.id ? "relative z-30" : undefined}
                >
                {(dragHandle) => (
                <div
                  className={cn(
                    "app-panel group relative flex h-full cursor-pointer flex-col transition-all hover:border-border hover:bg-surface-hover",
                    enabledInPreset && "border-l-2 border-l-accent",
                    isMultiSelect && selectedIds.has(skill.id) && "ring-1 ring-accent border-accent/40"
                  )}
                  onClick={() =>
                    isMultiSelect ? toggleSelect(skill.id) : openSkillDetailById(skill.id)
                  }
                >
                  <div className={cn("absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-lg border border-border-subtle bg-surface px-1 py-0.5 opacity-0 shadow-sm transition-all", !isMultiSelect && "group-hover:opacity-100")}>
                    {dragHandle}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCheckUpdate(skill); }}
                      disabled={checkingSkillId === skill.id}
                      className="rounded p-1 text-muted transition-colors hover:bg-surface-hover hover:text-secondary disabled:opacity-50"
                      title={t("mySkills.updateActions.check")}
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5", checkingSkillId === skill.id && "animate-spin")} />
                    </button>
                    {canRefresh(skill) ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRefreshSkill(skill); }}
                        disabled={updatingSkillId === skill.id}
                        className="rounded p-1 text-accent-light transition-colors hover:bg-accent-bg disabled:opacity-50"
                        title={refreshLabel(skill)}
                      >
                        <RotateCcw className={cn("h-3.5 w-3.5", updatingSkillId === skill.id && "animate-spin")} />
                      </button>
                    ) : null}
                    <DeleteSkillButton
                      skill={skill}
                      onConfirm={handleDeleteSkill}
                      buttonClassName="p-1"
                    />
                  </div>
                  {deletingIds.has(skill.id) && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-surface/70 backdrop-blur-[1px]">
                      <Loader2 className="h-5 w-5 animate-spin text-muted" />
                    </div>
                  )}

                  <div className="flex items-center gap-2.5 px-3.5 pr-20 pt-3 pb-1.5">
                    {isMultiSelect && (
                      selectedIds.has(skill.id)
                        ? <SquareCheck className="h-3.5 w-3.5 shrink-0 text-accent" />
                        : <Square className="h-3.5 w-3.5 shrink-0 text-faint" />
                    )}
                    <h3
                      className="flex-1 truncate text-[14px] font-semibold text-primary group-hover:text-accent-light"
                      title={displayName}
                    >
                      {displayName}
                    </h3>
                  </div>

                  <div className="px-3.5 pb-3">
                    <p className="text-[13px] leading-[18px] text-muted truncate">
                      {skill.description || "—"}
                    </p>
                    {(badge || conflictIds.has(skill.id)) && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {conflictIds.has(skill.id) && (
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate("/backup"); }}
                            className="rounded-full bg-amber-500/12 px-2 py-0.5 text-[13px] font-medium text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
                            title={t("mySkills.needsAttentionHint")}
                          >
                            {t("mySkills.needsAttention")}
                          </button>
                        )}
                        {badge && (
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[13px] font-medium",
                              badge.className
                            )}
                          >
                            {badge.label}
                          </span>
                        )}
                        {isMissingLocalSource && (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRelinkSource(skill); }}
                              disabled={updatingSkillId === skill.id}
                              className="rounded-full border border-border-subtle px-2 py-0.5 text-[12px] font-medium text-secondary transition-colors hover:bg-surface-hover disabled:opacity-50"
                            >
                              {t("mySkills.updateActions.relink")}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDetachSource(skill); }}
                              disabled={updatingSkillId === skill.id}
                              className="rounded-full border border-border-subtle px-2 py-0.5 text-[12px] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-secondary disabled:opacity-50"
                            >
                              {t("mySkills.updateActions.detachSource")}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {skill.tags.map((tag) => (
                        <span
                          key={tag}
                          className={cn(
                            "group/tag inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                            getTagColor(tag, allTags)
                          )}
                        >
                          {tag}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRemoveTag(skill, tag); }}
                            className="hidden group-hover/tag:inline-flex rounded-full p-0 opacity-60 hover:opacity-100"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </span>
                      ))}
                      {tagEditSkillId === skill.id ? (
                        <div className="relative" onClick={(e) => e.stopPropagation()}>
                          <input
                            ref={tagInputRef}
                            type="text"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { handleAddTag(skill); }
                              if (e.key === "Escape") { setTagEditSkillId(null); setTagInput(""); }
                            }}
                            onBlur={() => {
                              if (tagInput.trim()) handleAddTag(skill);
                              else { setTagEditSkillId(null); setTagInput(""); }
                            }}
                            placeholder={t("mySkills.tags.addTag")}
                            className="h-5 w-28 rounded-full border border-border-subtle bg-transparent px-1.5 text-[11px] text-secondary outline-none focus:border-accent"
                            autoCapitalize="none"
                            autoCorrect="off"
                            autoComplete="off"
                            spellCheck={false}
                            autoFocus
                          />
                          {getTagOptions(skill, tagInput).length > 0 && (
                            <div className="absolute left-0 top-6 z-50 max-h-56 min-w-[112px] max-w-[180px] overflow-y-auto rounded-md border border-border-subtle bg-surface p-1 shadow-lg">
                              {getTagOptions(skill, tagInput).map((tagOption) => (
                                <button
                                  key={tagOption}
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={(e) => { e.stopPropagation(); handleAddTag(skill, tagOption); }}
                                  className="w-full truncate rounded px-1.5 py-1 text-left text-[11px] text-secondary hover:bg-surface-hover"
                                  title={tagOption}
                                >
                                  {tagOption}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setTagEditSkillId(skill.id); setTagInput(""); }}
                          className="inline-flex items-center rounded-full p-0.5 text-faint transition-colors hover:text-muted opacity-0 group-hover:opacity-100"
                          title={t("mySkills.tags.addTag")}
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-2 border-t border-border-subtle px-3.5 py-2.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="inline-flex shrink-0 items-center gap-1 text-[13px] text-muted">
                        {sourceIcon(skill.source_type)}
                        {sourceTypeLabel(skill)}
                      </span>
                      {enabledInPreset && (
                        <>
                          <span className="text-faint">·</span>
                          <span className="truncate text-[13px] font-medium text-amber-600 dark:text-amber-400/80">
                            {viewedPresetName}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <SyncDots
                        skill={skill}
                        tools={tools}
                        limit={6}
                        onToggle={
                          isMultiSelect
                            ? undefined
                            : (tool, enabled) => handleToggleSkillTarget(skill, tool, enabled)
                        }
                        pendingKey={togglingTarget?.skillId === skill.id ? togglingTarget.tool : null}
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); handleTogglePreset(skill); }}
                        disabled={!viewedPreset}
                        className={cn(
                          "rounded px-2 py-1 text-[13px] font-medium transition-colors outline-none",
                          enabledInPreset
                            ? "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                            : "text-muted hover:bg-surface-hover hover:text-secondary"
                        )}
                      >
                        {enabledInPreset ? t("mySkills.enabledButton") : t("mySkills.enable")}
                      </button>
                    </div>
                  </div>
                </div>
                )}
                </SortableSkillItem>
              );
            }

            return (
              <SortableSkillItem key={skill.id} id={skill.id} disabled={!canDrag}>
              {(dragHandle) => (
              <div
                className={cn(
                  "app-panel group relative flex cursor-pointer items-center gap-3.5 rounded-xl border-transparent px-3.5 py-3 transition-all hover:border-border hover:bg-surface-hover",
                  enabledInPreset && "border-l-2 border-l-accent",
                  isMultiSelect && selectedIds.has(skill.id) && "ring-1 ring-accent border-accent/40"
                )}
                onClick={() =>
                  isMultiSelect ? toggleSelect(skill.id) : openSkillDetailById(skill.id)
                }
              >
                {deletingIds.has(skill.id) && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-surface/70 backdrop-blur-[1px]">
                    <Loader2 className="h-5 w-5 animate-spin text-muted" />
                  </div>
                )}
                {dragHandle}
                {isMultiSelect && (
                  selectedIds.has(skill.id)
                    ? <SquareCheck className="h-3.5 w-3.5 shrink-0 text-accent" />
                    : <Square className="h-3.5 w-3.5 shrink-0 text-faint" />
                )}

                <h3
                  className="w-[180px] shrink-0 truncate text-[14px] font-semibold text-secondary group-hover:text-primary"
                  title={displayName}
                >
                  {displayName}
                </h3>

                <p className="min-w-0 flex-1 truncate text-[13px] text-muted">
                  {skill.description || "—"}
                </p>

                <div className="flex shrink-0 items-center gap-1.5">
                  {skill.tags.map((tag) => (
                    <span
                      key={tag}
                      className={cn(
                        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-medium",
                        getTagColor(tag, allTags)
                      )}
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="flex shrink-0 items-center gap-2.5">
                  {conflictIds.has(skill.id) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate("/backup"); }}
                      className="rounded-full bg-amber-500/12 px-2 py-0.5 text-[12px] font-medium text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
                      title={t("mySkills.needsAttentionHint")}
                    >
                      {t("mySkills.needsAttention")}
                    </button>
                  )}
                  {badge && (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[12px] font-medium",
                        badge.className
                      )}
                    >
                      {badge.label}
                    </span>
                  )}
                  <SyncDots
                    skill={skill}
                    tools={tools}
                    limit={6}
                    size="sm"
                    onToggle={
                      isMultiSelect
                        ? undefined
                        : (tool, enabled) => handleToggleSkillTarget(skill, tool, enabled)
                    }
                    pendingKey={togglingTarget?.skillId === skill.id ? togglingTarget.tool : null}
                  />
                  <span className="inline-flex items-center gap-1 text-[13px] text-muted">
                    {sourceIcon(skill.source_type)}
                    {sourceTypeLabel(skill)}
                  </span>
                  {enabledInPreset && (
                    <span className="text-[13px] font-medium text-amber-600 dark:text-amber-400/80">
                      {viewedPresetName}
                    </span>
                  )}
                </div>

                <div className={cn("flex shrink-0 items-center gap-1 opacity-0 transition-opacity", !isMultiSelect && "group-hover:opacity-100")}>
                  {isMissingLocalSource && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRelinkSource(skill); }}
                        disabled={updatingSkillId === skill.id}
                        className="rounded px-2 py-0.5 text-[13px] font-medium text-secondary transition-colors hover:bg-surface-hover disabled:opacity-50"
                      >
                        {t("mySkills.updateActions.relink")}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDetachSource(skill); }}
                        disabled={updatingSkillId === skill.id}
                        className="rounded px-2 py-0.5 text-[13px] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-secondary disabled:opacity-50"
                      >
                        {t("mySkills.updateActions.detachSource")}
                      </button>
                    </>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleTogglePreset(skill); }}
                    disabled={!viewedPreset}
                    className={cn(
                      "rounded px-2 py-0.5 text-[13px] font-medium transition-colors outline-none",
                      enabledInPreset
                        ? "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                        : "text-muted hover:bg-surface-hover hover:text-secondary"
                    )}
                  >
                    {enabledInPreset ? t("mySkills.enabledButton") : t("mySkills.enable")}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCheckUpdate(skill); }}
                    disabled={checkingSkillId === skill.id}
                    className="rounded p-0.5 text-muted transition-colors hover:bg-surface-hover hover:text-secondary disabled:opacity-50"
                    title={t("mySkills.updateActions.check")}
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", checkingSkillId === skill.id && "animate-spin")} />
                  </button>
                  {canRefresh(skill) ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRefreshSkill(skill); }}
                      disabled={updatingSkillId === skill.id}
                      className="rounded p-0.5 text-accent-light transition-colors hover:bg-accent-bg disabled:opacity-50"
                      title={refreshLabel(skill)}
                    >
                      <RotateCcw className={cn("h-3.5 w-3.5", updatingSkillId === skill.id && "animate-spin")} />
                    </button>
                  ) : null}
                  <DeleteSkillButton
                    skill={skill}
                    onConfirm={handleDeleteSkill}
                    buttonClassName="p-0.5"
                  />
                </div>
              </div>
              )}
              </SortableSkillItem>
            );
          })}
        </div>
                )}
              </div>
            );
          })}
        </div>
          </SortableContext>
        </DndContext>
      )}

      <SkillDetailPanel
        key={selectedSkill?.id ?? "skill-detail-empty"}
        skill={selectedSkill}
        onClose={closeSkillDetail}
        tools={tools}
        toolToggles={toolToggles}
        togglingTool={togglingToolKey}
        onToggleTool={handleToggleSkillTool}
        projects={projects}
        onProjectsChanged={refreshProjects}
      />

      <ConfirmDialog
        open={batchDeleteConfirm}
        message={t("mySkills.batchDeleteConfirm", { count: selectedIds.size })}
        onClose={() => setBatchDeleteConfirm(false)}
        onConfirm={handleBatchDelete}
      />
      <ConfirmDialog
        open={tagToDelete !== null}
        title={t("mySkills.tags.deleteTag")}
        message={t("mySkills.tags.deleteConfirm", { tag: tagToDelete || "" })}
        onClose={() => setTagToDelete(null)}
        onConfirm={handleDeleteTag}
      />
      <TagRenameDialog
        open={tagToRename !== null}
        currentName={tagToRename || ""}
        onClose={() => setTagToRename(null)}
        onRename={handleRenameTag}
      />
      {tagMenu && (
        <>
          {/* Backdrop closes on left- or right-click outside the menu. Explicit
              z-index (z-40/z-50) to avoid the macOS WKWebView stacking bug. */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setTagMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setTagMenu(null);
            }}
          />
          <div
            className="fixed z-50 min-w-[140px] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-2xl"
            style={{ top: tagMenu.y, left: tagMenu.x }}
          >
            <button
              onClick={() => {
                setTagToRename(tagMenu.tag);
                setTagMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-secondary hover:bg-surface-hover"
            >
              <Pencil className="h-3.5 w-3.5" />
              {t("mySkills.tags.renameTag")}
            </button>
            <button
              onClick={() => {
                setTagToDelete(tagMenu.tag);
                setTagMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-red-400 hover:bg-surface-hover"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("mySkills.tags.deleteTag")}
            </button>
          </div>
        </>
      )}
      <BatchTagDialog
        open={batchTagDialogOpen}
        skills={skills.filter((s) => selectedIds.has(s.id))}
        allTags={allTags}
        onClose={() => setBatchTagDialogOpen(false)}
        onApply={handleBatchEditTags}
      />
      <PresetPickDialog
        open={presetPickMode !== null}
        mode={presetPickMode ?? "add"}
        presets={presets}
        busy={presetPickBusy}
        onClose={() => {
          if (!presetPickBusy) setPresetPickMode(null);
        }}
        onConfirm={(presetId) => {
          if (presetPickMode === "remove") {
            void handleBatchRemoveFromPreset(presetId);
          } else {
            void handleBatchAddToPreset(presetId);
          }
        }}
      />
    </div>
  );
}
