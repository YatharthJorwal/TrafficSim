#!/usr/bin/env node
/**
 * Apply a Claude-delivered bundle (a zip of changed/new files at repo-relative paths) to this repo.
 *
 *   npm run apply -- <path-to-bundle.zip> [--dry-run] [--no-test] [--force]
 *
 * - Refuses to run on a dirty git tree (so git can always undo a bundle) unless --force.
 * - Optional BUNDLE.json in the zip: { "name": "...", "description": "...", "delete": ["old/file.ts"] }.
 *   It is read but never written into the repo.
 * - Never writes outside the repo, or into .git/ or node_modules/.
 * - Runs `npm install` only if package.json / package-lock.json changed, then `npm test`.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const zipArg = args.find((a) => !a.startsWith('--'));
const dryRun = flags.has('--dry-run');
const root = process.cwd();

function fail(msg) {
  console.error(`\nERROR: ${msg}`);
  process.exit(1);
}
function run(cmd, cmdArgs, opts = {}) {
  return spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: true, cwd: root, ...opts });
}

if (!zipArg) fail('usage: npm run apply -- <path-to-bundle.zip> [--dry-run] [--no-test] [--force]');
if (!existsSync(zipArg)) fail(`bundle not found: ${zipArg}`);
if (!existsSync(resolve(root, 'package.json')) || !existsSync(resolve(root, 'src/sim'))) {
  fail('run this from the repository root (the folder that contains package.json and src/).');
}

const git = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', shell: true });
const hasGit = git.status === 0;
if (hasGit && git.stdout.trim() && !flags.has('--force') && !dryRun) {
  console.error(git.stdout);
  fail('git working tree is not clean. Commit your changes first (git add . ; git commit -m "..."), or use --force.');
}

const entries = unzipSync(new Uint8Array(readFileSync(zipArg)));
let manifest = {};
if (entries['BUNDLE.json']) {
  try {
    manifest = JSON.parse(Buffer.from(entries['BUNDLE.json']).toString('utf8'));
  } catch {
    fail('BUNDLE.json in the zip is not valid JSON.');
  }
}

function safeTarget(name) {
  const clean = name.replace(/\\/g, '/');
  if (clean.startsWith('/') || /^[a-zA-Z]:/.test(clean)) fail(`absolute path in bundle: ${name}`);
  const target = resolve(root, clean);
  const rel = relative(root, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) fail(`path escapes the repository: ${name}`);
  const top = rel.split(/[\\/]/)[0];
  if (top === '.git' || top === 'node_modules') fail(`refusing to touch ${top}/: ${name}`);
  return { target, rel: rel.replace(/\\/g, '/') };
}

const added = [];
const changed = [];
let unchanged = 0;
const writes = [];
for (const [name, data] of Object.entries(entries)) {
  if (name.endsWith('/') || name === 'BUNDLE.json') continue;
  const { target, rel } = safeTarget(name);
  const buf = Buffer.from(data);
  if (!existsSync(target)) added.push(rel);
  else if (readFileSync(target).equals(buf)) {
    unchanged++;
    continue;
  } else changed.push(rel);
  writes.push({ target, buf });
}
const removed = [];
for (const name of manifest.delete ?? []) {
  const { target, rel } = safeTarget(name);
  if (existsSync(target)) removed.push({ target, rel });
}

console.log(`Bundle: ${manifest.name ?? zipArg}${manifest.description ? ` - ${manifest.description}` : ''}`);
for (const f of added) console.log(`  + ${f}`);
for (const f of changed) console.log(`  ~ ${f}`);
for (const f of removed) console.log(`  - ${f.rel}`);
console.log(`${added.length} added, ${changed.length} changed, ${removed.length} deleted, ${unchanged} identical (skipped)`);

if (dryRun) {
  console.log('\nDry run: nothing was written.');
  process.exit(0);
}
if (writes.length === 0 && removed.length === 0) {
  console.log('\nNothing to do: this bundle is already applied.');
  process.exit(0);
}

const depsBefore = ['package.json', 'package-lock.json'].map((f) => (existsSync(resolve(root, f)) ? readFileSync(resolve(root, f), 'utf8') : ''));
for (const { target, buf } of writes) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, buf);
}
for (const { target } of removed) rmSync(target, { force: true });
const depsAfter = ['package.json', 'package-lock.json'].map((f) => (existsSync(resolve(root, f)) ? readFileSync(resolve(root, f), 'utf8') : ''));

if (depsBefore[0] !== depsAfter[0] || depsBefore[1] !== depsAfter[1]) {
  console.log('\nDependencies changed: running npm install ...');
  if (run('npm', ['install']).status !== 0) fail('npm install failed.');
}
if (!flags.has('--no-test')) {
  console.log('\nRunning tests ...');
  if (run('npm', ['test']).status !== 0) {
    fail('tests failed after applying the bundle. Undo with: git checkout . ; git clean -fd   (then tell Claude the failing output)');
  }
}
if (hasGit) {
  console.log('\nChanges in your working tree:');
  run('git', ['status', '--short']);
}
console.log(`\nApplied OK. Next:\n  git add .\n  git commit -m "${manifest.commitMessage ?? manifest.name ?? 'Apply bundle'}"\n  git push`);
