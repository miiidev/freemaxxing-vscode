import * as path from 'path';
import * as fs from 'fs';

/**
 * mocha-based test runner for @vscode/test-electron (spec §16).
 *
 * Loads every `*.test.js` file under out/test (recursively) and runs it with
 * the `tdd` interface inside the VS Code extension host.
 */
export async function run(): Promise<void> {
  const testsRoot = __dirname;

  let Mocha: any;
  try {
    // mocha is a devDependency of @vscode/test-electron
    ({ Mocha } = require('mocha'));
  } catch {
    throw new Error('mocha is required for integration tests; run `npm install` first.');
  }

  const moc = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 20_000,
  });

  const files = walk(testsRoot).filter((f) => /\.test\.js$/.test(f));
  if (files.length === 0) {
    throw new Error('No integration test files found. Run `npm run compile:test` first.');
  }
  for (const file of files) {
    moc.addFile(file);
  }

  await new Promise<void>((resolve, reject) => {
    moc.run((failures: number) => {
      if (failures > 0) {
        reject(new Error(`${failures} integration test(s) failed.`));
      } else {
        resolve();
      }
    });
  });
}

/** Recursively list files under a directory. */
function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}