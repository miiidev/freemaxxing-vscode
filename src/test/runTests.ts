import * as path from 'path';

/**
 * Entry point for `npm run test:integration`.
 *
 * Downloads the VS Code release binary (cached after first run), launches it
 * with this extension loaded, and executes the mocha suite compiled to
 * out/test (see tsconfig.test.json) against a mocked Maxout server.
 *
 * Run order:
 *   1. npm run compile            (bundle src/extension.ts → dist/)
 *   2. npm run compile:test       (tsc → out/test)
 *   3. node out/test/runTests.js  (this file)
 */
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
    // __dirname === out/test (compiled), so index.js resolves next to us.
    const extensionTestsPath = path.join(__dirname, 'index.js');

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        '--disable-extensions', // don't load other installed extensions
        '--skip-welcome',
        '--skip-release-notes',
      ],
    });
    console.log('Integration tests passed.');
  } catch (err) {
    console.error('Integration tests failed:', err);
    process.exit(1);
  }
}

void main();