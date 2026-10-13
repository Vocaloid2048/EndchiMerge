#!/usr/bin/env node
/**
 * 讓 git 使用 repo 內的 `.githooks/`（由 `package.json` 的 `prepare` 在 `npm install` 後執行）。
 * Points git at the in-repo `.githooks/` directory.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CWD = process.cwd();
const HOOKS_SRC = path.join(CWD, '.githooks');

/**
 * 解析 git 目錄；支援一般 repo（`.git` 是目錄）與 worktree／submodule（`.git` 是檔案）。
 * Resolves the git directory; supports a plain repo (`.git` is a directory) and worktrees /
 * submodules (`.git` is a file).
 */
function resolveGitDir() {
  const dotGit = path.join(CWD, '.git');
  if (!fs.existsSync(dotGit)) return null;
  if (fs.statSync(dotGit).isDirectory()) return dotGit;
  const text = fs.readFileSync(dotGit, 'utf8').trim();
  const m = text.match(/^gitdir:\s*(.+)$/i);
  if (!m) return null;
  return path.resolve(CWD, m[1]);
}

function tryGitConfig() {
  try {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'pipe' });
    const current = execFileSync('git', ['config', '--get', 'core.hooksPath'], {
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
    return current === '.githooks';
  } catch {
    return false;
  }
}

function copyHooks(gitDir) {
  const target = path.join(gitDir, 'hooks');
  fs.mkdirSync(target, { recursive: true });
  let copied = 0;
  for (const name of fs.readdirSync(HOOKS_SRC)) {
    const src = path.join(HOOKS_SRC, name);
    if (!fs.statSync(src).isFile()) continue;
    const dst = path.join(target, name);
    fs.copyFileSync(src, dst);
    try {
      fs.chmodSync(dst, 0o755);
    } catch {
      // Windows 沒有 POSIX 權限位元，忽略即可。
      // Windows has no POSIX permission bits, so this is fine to ignore.
    }
    copied++;
  }
  return copied;
}

const gitDir = resolveGitDir();
if (!gitDir || !fs.existsSync(HOOKS_SRC)) {
  console.log('[hooks] 不在 git 工作區內，略過 / not a git work tree — skipping.');
  process.exit(0);
}

if (tryGitConfig()) {
  console.log('[hooks] core.hooksPath → .githooks');
  process.exit(0);
}

const copied = copyHooks(gitDir);
console.log(`[hooks] 無法設定 core.hooksPath，已改為複製 ${copied} 個 hook 到 ${path.join(gitDir, 'hooks')}`);
console.log('[hooks] 注意：複製的副本不會自動更新，建議手動執行 git config core.hooksPath .githooks');
