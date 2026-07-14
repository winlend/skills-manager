/**
 * Module-level batch update/check queue.
 * Survives MySkills remounts and filter/tag UI changes so progress does not vanish.
 */

export type WorkMode = "update" | "check";

export type BatchProgressSnapshot = {
  mode: WorkMode;
  current: number;
  total: number;
  name: string;
  waiting: number;
  skillId: string | null;
  running: boolean;
  downloadDetail: string | null;
  downloadSpeedLabel: string | null;
};

export type WorkSkill = {
  id: string;
  name: string;
  source_type: string;
  source_ref: string | null;
};

type Job = {
  id: string;
  mode: WorkMode;
  name: string;
  source_type: string;
  source_ref: string | null;
};

type Runners = {
  updateSkill: (id: string) => Promise<{ content_changed: boolean }>;
  reimportLocal: (id: string) => Promise<unknown>;
  checkSkill: (id: string) => Promise<unknown>;
  refreshManagedSkills: () => Promise<unknown>;
  displayName: (id: string, fallback: string) => string;
};

type Listener = () => void;

const queue: Job[] = [];
const pending = new Set<string>();
let running = false;
let stats = { ok: 0, unchanged: 0, failed: 0, processed: 0 };
let snapshot: BatchProgressSnapshot = emptySnapshot();
const listeners = new Set<Listener>();
let runners: Runners | null = null;
let downloadMeter: { bytes: number; at: number } | null = null;

function emptySnapshot(): BatchProgressSnapshot {
  return {
    mode: "update",
    current: 0,
    total: 0,
    name: "",
    waiting: 0,
    skillId: null,
    running: false,
    downloadDetail: null,
    downloadSpeedLabel: null,
  };
}

function workKey(mode: WorkMode, id: string) {
  return `${mode}:${id}`;
}

function emit() {
  for (const l of listeners) l();
}

function setSnapshot(partial: Partial<BatchProgressSnapshot>) {
  snapshot = { ...snapshot, ...partial };
  emit();
}

export function getBatchProgressSnapshot(): BatchProgressSnapshot {
  return snapshot;
}

export function subscribeBatchProgress(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function configureBatchWorkRunners(next: Runners) {
  runners = next;
}

export function canRefreshSkill(s: {
  source_type: string;
  source_ref: string | null;
}): boolean {
  return (
    s.source_type === "git" ||
    s.source_type === "skillssh" ||
    ((s.source_type === "local" || s.source_type === "import") && !!s.source_ref)
  );
}

function publishProgress(mode: WorkMode, name: string, skillId: string | null) {
  const waiting = queue.filter((q) => q.mode === mode).length;
  const processed = stats.processed;
  const total = Math.max(processed + 1 + waiting, 1);
  setSnapshot({
    mode,
    current: processed + 1,
    total,
    name,
    waiting,
    skillId,
    running: true,
  });
}

type DrainResult = {
  mode: WorkMode | null;
  ok: number;
  unchanged: number;
  failed: number;
  processed: number;
};

async function drain(): Promise<DrainResult> {
  if (running) {
    return { mode: null, ok: 0, unchanged: 0, failed: 0, processed: 0 };
  }
  if (!runners) {
    console.error("batchWorkQueue: runners not configured");
    return { mode: null, ok: 0, unchanged: 0, failed: 0, processed: 0 };
  }

  running = true;
  stats = { ok: 0, unchanged: 0, failed: 0, processed: 0 };
  setSnapshot({
    ...emptySnapshot(),
    running: true,
  });
  downloadMeter = null;

  let lastMode: WorkMode | null = null;
  const r = runners;

  try {
    while (queue.length > 0) {
      const job = queue.shift()!;
      lastMode = job.mode;
      const name = r.displayName(job.id, job.name);
      publishProgress(job.mode, name, job.id);
      setSnapshot({ downloadDetail: null, downloadSpeedLabel: null });
      downloadMeter = null;

      try {
        if (job.mode === "check") {
          await r.checkSkill(job.id);
          stats.ok += 1;
        } else if (job.source_type === "local" || job.source_type === "import") {
          await r.reimportLocal(job.id);
          stats.ok += 1;
        } else {
          const result = await r.updateSkill(job.id);
          if (result.content_changed) stats.ok += 1;
          else stats.unchanged += 1;
        }
      } catch {
        stats.failed += 1;
      } finally {
        pending.delete(workKey(job.mode, job.id));
        stats.processed += 1;
      }
    }
  } finally {
    running = false;
    const result: DrainResult = {
      mode: lastMode,
      ok: stats.ok,
      unchanged: stats.unchanged,
      failed: stats.failed,
      processed: stats.processed,
    };
    setSnapshot(emptySnapshot());
    if (queue.length > 0) {
      void drainAndNotify();
      return result;
    }
    try {
      await r.refreshManagedSkills();
    } catch {
      /* ignore */
    }
    return result;
  }
}

export type EnqueueResult = { added: number; skipped: number };

export function enqueueUpdates(skills: WorkSkill[]): EnqueueResult {
  const candidates = skills.filter(canRefreshSkill);
  let added = 0;
  let skipped = 0;
  for (const s of candidates) {
    const key = workKey("update", s.id);
    if (pending.has(key)) {
      skipped += 1;
      continue;
    }
    pending.add(key);
    queue.push({
      id: s.id,
      mode: "update",
      name: s.name,
      source_type: s.source_type,
      source_ref: s.source_ref,
    });
    added += 1;
  }
  if (added > 0) void drainAndNotify();
  return { added, skipped };
}

export function enqueueChecks(skills: WorkSkill[]): EnqueueResult {
  const candidates = skills.filter(canRefreshSkill);
  let added = 0;
  let skipped = 0;
  for (const s of candidates) {
    const key = workKey("check", s.id);
    if (pending.has(key)) {
      skipped += 1;
      continue;
    }
    pending.add(key);
    queue.push({
      id: s.id,
      mode: "check",
      name: s.name,
      source_type: s.source_type,
      source_ref: s.source_ref,
    });
    added += 1;
  }
  if (added > 0) void drainAndNotify();
  return { added, skipped };
}

type NotifyFns = {
  onDone?: (r: DrainResult) => void;
};

let notify: NotifyFns = {};

export function setBatchWorkNotify(fns: NotifyFns) {
  notify = fns;
}

async function drainAndNotify() {
  const result = await drain();
  if (result.processed > 0) {
    notify.onDone?.(result);
  }
}

/** Called from skill-update-progress event listener (can live at app level). */
export function reportDownloadProgress(skillId: string, detail: string) {
  if (snapshot.skillId && snapshot.skillId !== skillId) return;

  const bytes = parseReceivedBytes(detail);
  let speedLabel: string | null = snapshot.downloadSpeedLabel;
  const now =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  if (bytes != null) {
    const prev = downloadMeter;
    if (prev && now > prev.at && bytes >= prev.bytes) {
      const dt = (now - prev.at) / 1000;
      if (dt >= 0.2) {
        speedLabel = formatByteRate((bytes - prev.bytes) / dt);
      }
    }
    if (prev && bytes + 1024 < prev.bytes) {
      downloadMeter = { bytes, at: now };
    } else if (!prev || now - prev.at >= 200) {
      downloadMeter = { bytes, at: now };
    }
  }
  setSnapshot({
    skillId: skillId || snapshot.skillId,
    downloadDetail: detail,
    downloadSpeedLabel: speedLabel,
  });
}

export function parseReceivedBytes(detail: string): number | null {
  const kb = detail.match(/\(([\d.]+)\s*KB\)/i);
  if (kb) return Math.round(parseFloat(kb[1]) * 1024);
  const mib = detail.match(/\(([\d.]+)\s*MiB\)/i);
  if (mib) return Math.round(parseFloat(mib[1]) * 1024 * 1024);
  const mibPipe = detail.match(/([\d.]+)\s*MiB\s*\|/i);
  if (mibPipe) return Math.round(parseFloat(mibPipe[1]) * 1024 * 1024);
  const kibPipe = detail.match(/([\d.]+)\s*KiB\s*\|/i);
  if (kibPipe) return Math.round(parseFloat(kibPipe[1]) * 1024);
  const raw = detail.match(/(\d+)\s*bytes/i);
  if (raw) return parseInt(raw[1], 10);
  return null;
}

export function formatByteRate(bps: number): string {
  if (!Number.isFinite(bps) || bps < 0) return "—";
  if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB`;
  return `${Math.round(bps)} B`;
}

export function isBatchWorkRunning(): boolean {
  return running || queue.length > 0;
}
