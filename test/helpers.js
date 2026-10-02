import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Готовит окружение MOCK-режима с временной базой. Вызывать до импорта src/*. */
export function mockEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'threads-agent-'));
  process.env.MOCK = '1';
  process.env.DATA_FILE = path.join(dir, 'db.json');
  process.env.SESSION_SECRET = 'test-secret';
  return dir;
}
