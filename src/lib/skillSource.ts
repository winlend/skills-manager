export type SourceChannel =
  | "git"
  | "skillssh"
  | "local"
  | "import"
  | "archive"
  | "unknown";

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
  if (
    type === "git" ||
    type === "skillssh" ||
    type === "local" ||
    type === "import"
  ) {
    return type;
  }
  if (type === "archive" || type === "zip") return "archive";
  return "unknown";
}

function stripGitSuffix(s: string): string {
  return s.replace(/\.git$/i, "");
}

/** host/owner/repo (lowercase) for github/gitlab-like https or ssh urls */
export function normalizeGitRepoIdentity(
  raw: string
): { hostPath: string; label: string } | null {
  const s = raw.trim();
  if (!s) return null;

  // git@host:owner/repo.git
  const ssh = s.match(/^git@([^:]+):(.+)$/i);
  if (ssh) {
    const hostPath = `${ssh[1].toLowerCase()}/${stripGitSuffix(ssh[2])
      .replace(/^\/+/, "")
      .toLowerCase()}`;
    const parts = hostPath.split("/").filter(Boolean);
    const label =
      parts.length >= 2
        ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
        : parts[parts.length - 1] || hostPath;
    return { hostPath, label };
  }

  try {
    const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    const u = new URL(withProto);
    // Drop query/hash; keep path only (ignore .git suffix)
    let path = stripGitSuffix(u.pathname).replace(/^\/+|\/+$/g, "").toLowerCase();
    // Ignore tree/blob suffixes: owner/repo/tree/main/...
    const treeIdx = path.search(/\/(?:tree|blob|src|raw)\//);
    if (treeIdx > 0) path = path.slice(0, treeIdx);
    if (!path) return null;
    // owner/repo only (first two segments) for monorepo stability
    const segs = path.split("/").filter(Boolean);
    const ownerRepo =
      segs.length >= 2 ? `${segs[0]}/${segs[1]}` : segs[0] || path;
    const hostPath = `${u.hostname.toLowerCase()}/${ownerRepo}`;
    const label = ownerRepo;
    return { hostPath, label };
  } catch {
    const cleaned = stripGitSuffix(s).toLowerCase();
    if (!cleaned) return null;
    return { hostPath: cleaned, label: cleaned };
  }
}

export function normalizeSourceKey(skill: SkillSourceFields): NormalizedSource {
  const channel = channelFromSourceType(skill.source_type);
  const ref = (skill.source_ref_resolved || skill.source_ref || "").trim();

  if (channel === "git") {
    if (!ref) {
      return {
        key: "unknown",
        label: "Unknown source",
        channel: "unknown",
        updateable: false,
        url: null,
      };
    }
    const id = normalizeGitRepoIdentity(ref);
    if (!id) {
      return {
        key: "unknown",
        label: "Unknown source",
        channel: "unknown",
        updateable: false,
        url: ref,
      };
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
      return {
        key: "unknown",
        label: "Unknown source",
        channel: "unknown",
        updateable: false,
        url: null,
      };
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
    const norm = ref.replace(/\\/g, "/").replace(/\/+$/, "");
    const parts = norm.split("/").filter(Boolean);
    const label =
      parts.length >= 2
        ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
        : parts[parts.length - 1] || norm;
    return {
      key: `${channel}:${norm.toLowerCase()}`,
      label,
      channel,
      updateable: true,
      url: ref,
    };
  }

  if (channel === "archive") {
    if (!ref) {
      return {
        key: "archive:unknown",
        label: "Archive",
        channel: "archive",
        updateable: false,
        url: null,
      };
    }
    const norm = ref.replace(/\\/g, "/");
    const base = norm.split("/").filter(Boolean).pop() || norm;
    return {
      key: `archive:${base.toLowerCase()}`,
      label: base,
      channel: "archive",
      updateable: false,
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
  return Array.from(map.values()).sort((a, b) =>
    a.label.localeCompare(b.label)
  );
}
