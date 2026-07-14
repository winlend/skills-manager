import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import {
  getBatchProgressSnapshot,
  subscribeBatchProgress,
} from "../lib/batchWorkQueue";

/**
 * Global batch progress strip. Reads module-level queue state so it stays
 * visible across MySkills filter changes and component remounts.
 * Place once in Layout (main content column).
 */
export function BatchProgressBanner() {
  const { t } = useTranslation();
  const progress = useSyncExternalStore(
    subscribeBatchProgress,
    getBatchProgressSnapshot,
    getBatchProgressSnapshot
  );

  if (!progress.running && progress.current === 0) {
    return null;
  }

  return (
    <div className="shrink-0 rounded-lg border border-accent/40 bg-accent-bg/40 px-3 py-2 shadow-sm">
      <div className="mb-1 flex items-center justify-between gap-2 text-[12px] text-secondary">
        <span className="inline-flex min-w-0 items-center gap-1.5 truncate font-medium">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent-light" />
          <span className="truncate">
            {progress.mode === "check"
              ? t("mySkills.checkProgress", {
                  current: progress.current,
                  total: progress.total,
                  name: progress.name,
                })
              : t("mySkills.updateProgress", {
                  current: progress.current,
                  total: progress.total,
                  name: progress.name,
                })}
          </span>
        </span>
        <span className="shrink-0 text-muted">
          {progress.current}/{progress.total}
          {progress.waiting > 0
            ? ` · ${t("mySkills.queueRemaining", { n: progress.waiting })}`
            : ""}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-hover">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300"
          style={{
            width: `${Math.round(
              (progress.current / Math.max(progress.total, 1)) * 100
            )}%`,
          }}
        />
      </div>
      {progress.downloadDetail && (
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted">
          <span className="min-w-0 truncate font-mono">
            {progress.downloadDetail}
          </span>
          {progress.downloadSpeedLabel && (
            <span className="shrink-0 font-semibold text-accent-light">
              {progress.downloadSpeedLabel}/s
            </span>
          )}
        </div>
      )}
      <p className="mt-1 text-[10px] text-muted">
        {t("mySkills.batchBackgroundHint")}
      </p>
    </div>
  );
}
