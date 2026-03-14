import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createSingleInstanceLock } from '../src/single-instance-lock.js';

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agents-in-discord-lock-'));
}

function createLogger() {
  return {
    log() {},
    warn() {},
    error() {},
  };
}

test('createSingleInstanceLock acquires and releases a fresh lock file', () => {
  const rootDir = makeTempRoot();
  const dataDir = path.join(rootDir, 'data');
  const lockFile = path.join(dataDir, 'bot.lock');
  const lock = createSingleInstanceLock({
    dataDir,
    lockFile,
    rootDir,
    ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
    logger: createLogger(),
    processRef: {
      pid: 321,
      kill() {
        throw Object.assign(new Error('missing'), { code: 'ESRCH' });
      },
      on() {},
    },
  });

  assert.equal(lock.acquire(), true);
  assert.equal(fs.existsSync(lockFile), true);

  const parsed = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  assert.equal(parsed.pid, 321);
  assert.equal(parsed.root, rootDir);

  lock.release();
  assert.equal(fs.existsSync(lockFile), false);
});

test('createSingleInstanceLock replaces a stale lock', () => {
  const rootDir = makeTempRoot();
  const dataDir = path.join(rootDir, 'data');
  const lockFile = path.join(dataDir, 'bot.lock');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(lockFile, JSON.stringify({ pid: 111, root: '/old' }), 'utf8');

  const lock = createSingleInstanceLock({
    dataDir,
    lockFile,
    rootDir,
    ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
    logger: createLogger(),
    processRef: {
      pid: 222,
      kill() {
        throw Object.assign(new Error('missing'), { code: 'ESRCH' });
      },
      on() {},
    },
  });

  assert.equal(lock.acquire(), true);
  const parsed = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  assert.equal(parsed.pid, 222);
  assert.equal(parsed.root, rootDir);
});

test('createSingleInstanceLock exits without takeover when another process is alive', () => {
  const rootDir = makeTempRoot();
  const dataDir = path.join(rootDir, 'data');
  const lockFile = path.join(dataDir, 'bot.lock');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(lockFile, JSON.stringify({ pid: 555, root: '/other' }), 'utf8');

  const exits = [];
  const lock = createSingleInstanceLock({
    dataDir,
    lockFile,
    rootDir,
    ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
    logger: createLogger(),
    processRef: {
      pid: 777,
      kill() {},
      on() {},
    },
    exit: (code) => {
      exits.push(code);
    },
  });

  assert.equal(lock.acquire(), false);
  assert.deepEqual(exits, [0]);

  const parsed = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  assert.equal(parsed.pid, 555);
});
