import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Layers, X } from "lucide-react";
import { cn } from "../utils";
import type { Preset } from "../lib/tauri";

interface PresetPickDialogProps {
  open: boolean;
  mode: "add" | "remove";
  presets: Preset[];
  onClose: () => void;
  onConfirm: (presetId: string) => void;
  busy?: boolean;
}

export function PresetPickDialog({
  open,
  mode,
  presets,
  onClose,
  onConfirm,
  busy = false,
}: PresetPickDialogProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return presets;
    return presets.filter((p) => p.name.toLowerCase().includes(q));
  }, [presets, query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={busy ? undefined : onClose} />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <div>
            <h2 className="text-[15px] font-semibold text-primary">
              {mode === "add"
                ? t("mySkills.presetPickTitleAdd")
                : t("mySkills.presetPickTitleRemove")}
            </h2>
            <p className="mt-0.5 text-[12px] text-muted">
              {t("mySkills.presetMembershipHint")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-secondary disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 pt-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("mySkills.searchPlaceholder")}
            className="app-input w-full"
            autoFocus
          />
        </div>

        <div className="max-h-64 overflow-y-auto px-2 py-2">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-muted">
              <Layers className="h-8 w-8 text-faint" />
              <span className="text-[13px]">{t("mySkills.noPreset")}</span>
            </div>
          ) : (
            filtered.map((preset) => {
              const active = selectedId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setSelectedId(preset.id)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition-colors",
                    active
                      ? "bg-accent/15 text-primary"
                      : "text-secondary hover:bg-surface-hover"
                  )}
                >
                  <span className="font-medium">{preset.name}</span>
                  <span className="text-[12px] text-muted">
                    {preset.skill_count != null
                      ? t("mySkills.sourceKeyFilter.count", {
                          count: preset.skill_count,
                        })
                      : null}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border-subtle px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-[13px] font-medium text-muted hover:bg-surface-hover hover:text-secondary disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={!selectedId || busy}
            onClick={() => selectedId && onConfirm(selectedId)}
            className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
