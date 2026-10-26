import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scrape-log-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const checkout = path.join(root, "checkout");
  const remote = path.join(root, "remote.git");
  const bin = path.join(root, "bin");
  const tmp = path.join(root, "tmp");
  for (const directory of [checkout, bin, tmp]) await fs.mkdir(directory);
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Scrape test",
    GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "Scrape test",
    GIT_COMMITTER_EMAIL: "test@example.invalid",
    PATH: `${bin}:${process.env.PATH}`,
    TMPDIR: tmp,
  };
  function git(...args) {
    const result = spawnSync("git", args, { cwd: checkout, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  git("init", "--bare", "--initial-branch=main", remote);
  git("init", "--initial-branch=main");
  await fs.mkdir(path.join(checkout, "scripts"));
  await fs.mkdir(path.join(checkout, "data/raw"), { recursive: true });
  await fs.copyFile(new URL("../scripts/scrape.sh", import.meta.url), path.join(checkout, "scripts/scrape.sh"));
  await fs.writeFile(path.join(checkout, "data/raw/existing.jsonl"), "existing\n");
  await fs.writeFile(path.join(checkout, "data/result.json"), "old summary\n");
  await fs.writeFile(path.join(checkout, "data/result.log"), "old log\n");
  git("add", ".");
  git("commit", "-m", "Initial data");
  git("remote", "add", "origin", remote);
  git("push", "-u", "origin", "main");
  await fs.writeFile(path.join(bin, "npm"), `#!/usr/bin/env bash
if [ "$1" = ci ]; then exit "\${INSTALL_STATUS:-0}"; fi
echo "progress \${RUN_MARKER:-first}"
echo 'scraper diagnostic' >&2
echo 'partial listing' >> data/raw/existing.jsonl
echo 'new listing' > data/raw/new.jsonl
if [ "\${SCRAPE_STATUS:-0}" -ne 0 ]; then exit "$SCRAPE_STATUS"; fi
echo 'new summary' > data/result.json
`, { mode: 0o755 });
  return {
    checkout, bin, remote, tmp, git,
    run(overrides = {}) {
      return spawnSync("bash", ["scripts/scrape.sh"], {
        cwd: checkout, env: { ...env, ...overrides }, encoding: "utf8", timeout: 30_000,
      });
    },
    remoteFile(name) { return git("--git-dir", remote, "show", `main:${name}`); },
    async assertCleanedUp() {
      assert.deepEqual(await fs.readdir(tmp), []);
      assert.equal(git("worktree", "list", "--porcelain").split("worktree ").length - 1, 1);
    },
  };
}

test("successful scrapes publish both streams with data and replace the previous log", async t => {
  const f = await fixture(t);
  for (const marker of ["first", "second"]) {
    const result = f.run({ RUN_MARKER: marker });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`progress ${marker}\\nscraper diagnostic`));
    assert.equal(f.remoteFile("data/result.log"), `progress ${marker}\nscraper diagnostic`);
    assert.equal(f.remoteFile("data/result.json"), "new summary");
    assert.equal(f.remoteFile("data/raw/new.jsonl"), "new listing");
    assert.equal(f.git("status", "--porcelain"), "");
  }
  assert.equal(f.git("--git-dir", f.remote, "show", "main~1:data/result.log"), "progress first\nscraper diagnostic");
  await f.assertCleanedUp();
});

test("fatal scrapes publish only the log, preserve partial data, and remain failed", async t => {
  const f = await fixture(t);
  const result = f.run({ SCRAPE_STATUS: "42" });
  assert.equal(result.status, 42, result.stderr);
  assert.match(result.stdout, /progress first\nscraper diagnostic/);
  assert.equal(f.remoteFile("data/result.log"), "progress first\nscraper diagnostic");
  assert.equal(f.remoteFile("data/result.json"), "old summary");
  assert.equal(f.remoteFile("data/raw/existing.jsonl"), "existing");
  assert.equal(f.git("--git-dir", f.remote, "diff-tree", "--no-commit-id", "--name-only", "-r", "main"), "data/result.log");
  assert.equal(await fs.readFile(path.join(f.checkout, "data/raw/existing.jsonl"), "utf8"), "existing\npartial listing\n");
  assert.equal(await fs.readFile(path.join(f.checkout, "data/raw/new.jsonl"), "utf8"), "new listing\n");
  assert.equal(await fs.readFile(path.join(f.checkout, "data/result.json"), "utf8"), "old summary\n");
  await f.assertCleanedUp();
});

for (const status of ["0", "42"]) {
  test(`publication failure retains the local log (scraper status ${status})`, async t => {
    const f = await fixture(t);
    await fs.writeFile(path.join(f.remote, "hooks/pre-receive"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const result = f.run({ SCRAPE_STATUS: status });
    assert.notEqual(result.status, 0);
    if (status === "42") {
      assert.equal(result.status, 42);
      assert.match(result.stderr, /Failed to publish scraper log/);
    }
    assert.equal(f.remoteFile("data/result.log"), "old log");
    assert.equal(await fs.readFile(path.join(f.checkout, "data/result.log"), "utf8"), "progress first\nscraper diagnostic\n");
    await f.assertCleanedUp();
  });
}

test("log write failure prevents successful publication", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.bin, "tee"), "#!/bin/sh\ncat >/dev/null\nexit 7\n", { mode: 0o755 });
  const result = f.run();
  assert.equal(result.status, 7);
  assert.match(result.stderr, /Failed to capture scraper output/);
  assert.equal(f.remoteFile("data/result.log"), "old log");
  assert.equal(f.remoteFile("data/result.json"), "old summary");
  await f.assertCleanedUp();
});

test("failure before scraping leaves the previous log unchanged", async t => {
  const f = await fixture(t);
  assert.equal(f.run({ INSTALL_STATUS: "9" }).status, 9);
  assert.equal(f.remoteFile("data/result.log"), "old log");
  assert.equal(f.git("status", "--porcelain"), "");
  await f.assertCleanedUp();
});
