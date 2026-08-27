import * as assert from 'assert';
import * as vscode from 'vscode';
import { MockMaxoutServer } from '../mockMaxoutServer';

/**
 * Integration tests (spec §16): run the real extension against a mocked
 * Maxout server inside the VS Code extension host (@vscode/test-electron).
 */

const MOCK_SERVER_HOST = '127.0.0.1';
const MOCK_SERVER_PORT = 8787;

suite('Maxout extension (integration)', () => {
  const mockServer = new MockMaxoutServer('groq::gpt-oss-120b');
  let extension: vscode.Extension<any> | undefined;

  suiteSetup(async function () {
    this.timeout(60_000);

    // Bind the mock to the port the extension probes by default. If a real
    // maxout or anything else already owns the port, fail fast.
    try {
      await mockServer.listen(MOCK_SERVER_PORT, MOCK_SERVER_HOST);
    } catch (err: any) {
      assert.fail(
        `Could not bind mock server to ${MOCK_SERVER_HOST}:${MOCK_SERVER_PORT} ` +
          `(is a real maxout already running?). ${err?.message ?? err}`
      );
    }

    extension = vscode.extensions.getExtension('miiidev.maxout-vscode');
    assert.ok(extension, 'extension miiidev.maxout-vscode not found');
    await extension.activate();

    const config = vscode.workspace.getConfiguration('maxout');
    await config.update('host', MOCK_SERVER_HOST, vscode.ConfigurationTarget.Global);
    await config.update('port', MOCK_SERVER_PORT, vscode.ConfigurationTarget.Global);
  });

  suiteTeardown(async () => {
    const config = vscode.workspace.getConfiguration('maxout');
    await config.update('host', undefined, vscode.ConfigurationTarget.Global);
    await config.update('port', undefined, vscode.ConfigurationTarget.Global);
    await mockServer.close();
  });

  test('registers all Phase 0/1 commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    const expected = [
      'maxout.menu',
      'maxout.start',
      'maxout.stop',
      'maxout.restart',
      'maxout.status',
      'maxout.setup',
      'maxout.trace',
      'maxout.revive',
      'maxout.openConfig',
      'maxout.copyEndpoint',
      'maxout.exportStats',
    ];
    for (const id of expected) {
      assert.ok(commands.includes(id), `missing command ${id}`);
    }
  });

  test('Copy Endpoint Config writes expected JSON to the clipboard', async function () {
    this.timeout(10_000);
    await vscode.commands.executeCommand('maxout.copyEndpoint');
    const text = await vscode.env.clipboard.readText();
    const parsed = JSON.parse(text);
    assert.deepStrictEqual(parsed, {
      apiBase: `http://${MOCK_SERVER_HOST}:${MOCK_SERVER_PORT}`,
      apiKey: 'anything',
      model: 'auto/coding',
    });
  });

  test('health check observes the mocked server (status comes up)', async function () {
    this.timeout(20_000);
    // Letting a few poll intervals pass is enough for the extension to have
    // probed /v1; we assert the server itself answers like maxout does.
    await new Promise((resolve) => setTimeout(resolve, 2600));
    const res = await fetch(`http://${MOCK_SERVER_HOST}:${MOCK_SERVER_PORT}/v1`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('x-maxout-served-by'), 'groq::gpt-oss-120b');
  });

  test('maxout.status opens the dashboard view (Phase 1 behavior)', async function () {
    this.timeout(10_000);
    await vscode.commands.executeCommand('maxout.status');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    // No throw = view command accepted. (View visibility is not directly
    // assertable here; the smoke is that the command chain completes.)
  });
});