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

/**
 * Prefer a short human label: owner/repo for git hosts, tail segments for paths.
 * Never leave a full https://... string as the primary UI label when we can shorten it.
 */
export function shortSourceLabel(raw: string | null | undefined): string {
  const s = (raw || "").trim();
  if (!s) return "Unknown source";

  const gitId = normalizeGitRepoIdentity(s);
  if (gitId?.label && !looksLikeFullUrl(gitId.label)) {
    return gitId.label;
  }

  // Already owner/repo or slug
  if (/^[\w.-]+\/[\w.-]+$/i.test(s)) return s;

  // Local / file path — last 1–2 segments
  if (/^[a-zA-Z]:[\\/]/.test(s) || s.includes("\\") || s.startsWith("/")) {
    const norm = s.replace(/\\/g, "/").replace(/\/+$/, "");
    const parts = norm.split("/").filter(Boolean);
    if (parts.length >= 2) return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    return parts[parts.length - 1] || s;
  }

  // Long string fallback: strip scheme and keep host + first path bits, still short
  if (looksLikeFullUrl(s)) {
    try {
      const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
      const segs = u.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
      if (segs.length >= 2) return `${segs[0]}/${segs[1]}`;
      if (segs[0]) return segs[0];
      return u.hostname;
    } catch {
      /* fall through */
    }
  }

  // Hard cap so the dropdown never becomes unreadable
  if (s.length > 40) return `${s.slice(0, 18)}…${s.slice(-12)}`;
  return s;
}

function looksLikeFullUrl(s: string): boolean {
  return /^https?:\/\//i.test(s) || /^git@/i.test(s) || /^github\.com\//i.test(s);
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
    const repoPath = stripGitSuffix(ssh[2]).replace(/^\/+/, "").toLowerCase();
    const segs = repoPath.split("/").filter(Boolean);
    // first two path segments only (owner/repo), ignore nested paths
    const ownerRepo =
      segs.length >= 2 ? `${segs[0]}/${segs[1]}` : segs[0] || repoPath;
    const hostPath = `${ssh[1].toLowerCase()}/${ownerRepo}`;
    return { hostPath, label: ownerRepo };
  }

  // bare github.com/owner/repo (no scheme)
  const bareHost = s.match(
    /^(github\.com|gitlab\.com|gitee\.com|bitbucket\.org)[/:](.+)$/i
  );
  if (bareHost) {
    const host = bareHost[1].toLowerCase();
    let path = stripGitSuffix(bareHost[2]).replace(/^\/+/, "").toLowerCase();
    const treeIdx = path.search(/\/(?:tree|blob|src|raw)\//);
    if (treeIdx > 0) path = path.slice(0, treeIdx);
    const segs = path.split("/").filter(Boolean);
    const ownerRepo =
      segs.length >= 2 ? `${segs[0]}/${segs[1]}` : segs[0] || path;
    if (!ownerRepo) return null;
    return { hostPath: `${host}/${ownerRepo}`, label: ownerRepo };
  }

  try {
    // Only parse as URL when it already has a scheme or looks like host/path
    // (e.g. github.com/foo/bar). Bare "owner/repo" must NOT become https://owner/repo.
    const looksAbsolute =
      /^https?:\/\//i.test(s) ||
      /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(s); // host.tld/...
    if (!looksAbsolute) {
      if (/^[\w.-]+\/[\w.-]+/.test(s)) {
        const segs = stripGitSuffix(s).toLowerCase().split("/").filter(Boolean);
        const ownerRepo =
          segs.length >= 2 ? `${segs[0]}/${segs[1]}` : segs[0] || s.toLowerCase();
        return { hostPath: ownerRepo, label: ownerRepo };
      }
      return null;
    }
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
    // Require at least owner/repo for github-like hosts
    if (segs.length < 2 && !u.hostname.includes(".")) {
      return null;
    }
    const hostPath = `${u.hostname.toLowerCase()}/${ownerRepo}`;
    return { hostPath, label: ownerRepo };
  } catch {
    if (/^[\w.-]+\/[\w.-]+/.test(s)) {
      const segs = stripGitSuffix(s).toLowerCase().split("/").filter(Boolean);
      const ownerRepo =
        segs.length >= 2 ? `${segs[0]}/${segs[1]}` : segs[0] || s.toLowerCase();
      return { hostPath: ownerRepo, label: ownerRepo };
    }
    return null;
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
        label: shortSourceLabel(ref),
        channel: "unknown",
        updateable: false,
        url: ref,
      };
    }
    return {
      key: `git:${id.hostPath}`,
      label: shortSourceLabel(id.label) || id.label,
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
    // skills.sh may store owner/repo slug OR a full github URL
    const gitId = normalizeGitRepoIdentity(ref);
    if (gitId) {
      return {
        key: `skillssh:${gitId.label.toLowerCase()}`,
        label: gitId.label,
        channel: "skillssh",
        updateable: true,
        url: ref,
      };
    }
    const slug = ref
      .replace(/^skills\.sh\//i, "")
      .replace(/^https?:\/\/skills\.sh\//i, "")
      .toLowerCase();
    return {
      key: `skillssh:${slug}`,
      label: shortSourceLabel(slug),
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
    // Local path may still be a git checkout URL in some installs
    const gitId = normalizeGitRepoIdentity(ref);
    if (gitId && looksLikeFullUrl(ref)) {
      return {
        key: `${channel}:${gitId.hostPath}`,
        label: gitId.label,
        channel,
        updateable: true,
        url: ref,
      };
    }
    const norm = ref.replace(/\\/g, "/").replace(/\/+$/, "");
    return {
      key: `${channel}:${norm.toLowerCase()}`,
      label: shortSourceLabel(ref),
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
      label: shortSourceLabel(base),
      channel: "archive",
      updateable: false,
      url: ref,
    };
  }

  // Unknown channel — still try to shorten URL/path for display
  if (ref) {
    const gitId = normalizeGitRepoIdentity(ref);
    if (gitId) {
      return {
        key: `unknown:${gitId.hostPath}`,
        label: gitId.label,
        channel: "unknown",
        updateable: false,
        url: ref,
      };
    }
    return {
      key: `unknown:${ref.toLowerCase().slice(0, 120)}`,
      label: shortSourceLabel(ref),
      channel: "unknown",
      updateable: false,
      url: ref,
    };
  }

  return {
    key: "unknown",
    label: "Unknown source",
    channel: "unknown",
    updateable: false,
    url: null,
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
