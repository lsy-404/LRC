import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 按 solution.ref 固定的 commit 签出私有方案源码，构建后把产物 stage 到 .solution/package 供 studio/ 与 worker/ 以 file: 依赖使用
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ref = readFileSync(resolve(root, 'solution.ref'), 'utf8').trim();
if (!/^[0-9a-f]{40}$/.test(ref)) throw new Error('solution.ref must hold a full 40-character commit hash');
const src = resolve(root, '.solution/src');
const out = resolve(root, '.solution/package');
const repo = process.env.SOLUTION_REPO || 'https://github.com/lsy-404/platform-kit-internal.git';

const git = (...args) => execFileSync('git', ['-C', src, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const has = (rev) => { try { git('cat-file', '-e', `${rev}^{commit}`); return true; } catch { return false; } };
if (!existsSync(resolve(src, '.git'))) {
  mkdirSync(src, { recursive: true });
  execFileSync('git', ['clone', '--no-checkout', repo, src], { stdio: 'inherit' });
}
if (!has(ref)) git('fetch', '--no-tags', 'origin', ref);
git('checkout', '--detach', '--force', ref);

const env = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' };
execSync('corepack pnpm install --frozen-lockfile', { cwd: src, env, stdio: 'inherit' });
execSync(`corepack pnpm run studio:stage "${out}"`, { cwd: src, env, stdio: 'inherit' });
