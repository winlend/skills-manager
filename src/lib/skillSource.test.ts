import { describe, it, expect } from "vitest";
import {
  normalizeSourceKey,
  sourceLabelFromSkill,
  channelFromSourceType,
  skillMatchesSourceSearch,
  buildSourceIndex,
  shortSourceLabel,
} from "./skillSource";

describe("channelFromSourceType", () => {
  it("maps known types", () => {
    expect(channelFromSourceType("git")).toBe("git");
    expect(channelFromSourceType("skillssh")).toBe("skillssh");
    expect(channelFromSourceType("local")).toBe("local");
    expect(channelFromSourceType("import")).toBe("import");
    expect(channelFromSourceType("zip")).toBe("archive");
    expect(channelFromSourceType("other")).toBe("unknown");
  });
});

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

  it("normalizes ssh git urls to the same key as https", () => {
    const https = normalizeSourceKey({
      source_type: "git",
      source_ref: "https://github.com/foo/bar.git",
      source_ref_resolved: null,
      source_subpath: null,
    });
    const ssh = normalizeSourceKey({
      source_type: "git",
      source_ref: "git@github.com:foo/bar.git",
      source_ref_resolved: null,
      source_subpath: null,
    });
    expect(https.key).toBe(ssh.key);
    expect(https.key).toBe("git:github.com/foo/bar");
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
    expect(r.label).toBe("vercel-labs/agent-skills");
  });

  it("skillssh full github url becomes short owner/repo label", () => {
    const r = normalizeSourceKey({
      source_type: "skillssh",
      source_ref: "https://github.com/obra/superpowers",
      source_ref_resolved: null,
      source_subpath: null,
    });
    expect(r.label).toBe("obra/superpowers");
    expect(r.label.startsWith("http")).toBe(false);
    expect(r.key).toBe("skillssh:obra/superpowers");
  });

  it("never uses full https url as primary label for git", () => {
    const r = normalizeSourceKey({
      source_type: "git",
      source_ref: "https://github.com/conardli/some-long-repo-name.git",
      source_ref_resolved: null,
      source_subpath: null,
    });
    expect(r.label).toBe("conardli/some-long-repo-name");
    expect(r.label.includes("https://")).toBe(false);
  });

  it("shortSourceLabel shortens bare github.com paths", () => {
    expect(shortSourceLabel("https://github.com/obra/superpowers")).toBe(
      "obra/superpowers"
    );
    expect(shortSourceLabel("git@github.com:foo/bar.git")).toBe("foo/bar");
    expect(shortSourceLabel("mindfold-ai/trellis")).toBe("mindfold-ai/trellis");
  });

  it("local uses path", () => {
    const r = normalizeSourceKey({
      source_type: "local",
      source_ref: "D:\\skills\\foo",
      source_ref_resolved: null,
      source_subpath: null,
    });
    expect(r.key.startsWith("local:")).toBe(true);
    expect(r.key).toContain("skills/foo");
    expect(r.updateable).toBe(true);
  });

  it("unknown when missing git ref", () => {
    const r = normalizeSourceKey({
      source_type: "git",
      source_ref: null,
      source_ref_resolved: null,
      source_subpath: null,
    });
    expect(r.key).toBe("unknown");
    expect(r.updateable).toBe(false);
  });

  it("prefers source_ref_resolved over source_ref", () => {
    const r = normalizeSourceKey({
      source_type: "git",
      source_ref: "https://github.com/old/name",
      source_ref_resolved: "https://github.com/new/name.git",
      source_subpath: null,
    });
    expect(r.key).toBe("git:github.com/new/name");
  });
});

describe("sourceLabelFromSkill", () => {
  it("returns short label", () => {
    expect(
      sourceLabelFromSkill({
        source_type: "git",
        source_ref: "https://github.com/a/b",
        source_ref_resolved: null,
      })
    ).toBe("a/b");
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

  it("matches skill name", () => {
    expect(
      skillMatchesSourceSearch(
        {
          name: "weekly-report",
          description: "d",
          source_type: "local",
          source_ref: "C:/x",
        },
        "weekly"
      )
    ).toBe(true);
  });

  it("empty query matches all", () => {
    expect(
      skillMatchesSourceSearch(
        {
          name: "x",
          description: "",
          source_type: "git",
          source_ref: null,
        },
        "  "
      )
    ).toBe(true);
  });
});

describe("buildSourceIndex", () => {
  it("aggregates counts by key", () => {
    const index = buildSourceIndex([
      {
        source_type: "git",
        source_ref: "https://github.com/foo/bar",
        source_ref_resolved: null,
        source_subpath: "a",
      },
      {
        source_type: "git",
        source_ref: "https://github.com/foo/bar.git",
        source_ref_resolved: null,
        source_subpath: "b",
      },
      {
        source_type: "skillssh",
        source_ref: "org/pkg",
        source_ref_resolved: null,
      },
    ]);
    const git = index.find((i) => i.key === "git:github.com/foo/bar");
    expect(git?.count).toBe(2);
    const sh = index.find((i) => i.key === "skillssh:org/pkg");
    expect(sh?.count).toBe(1);
  });
});
