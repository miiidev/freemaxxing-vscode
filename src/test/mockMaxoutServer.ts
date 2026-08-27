import * as http from 'http';
import { AddressInfo } from 'net';

/**
 * Tiny mocked Maxout server for integration tests (spec §16).
 *
 * Mimics the parts of `maxout serve` the extension talks to:
 *  - `GET /v1` — OpenAI-compatible endpoint; responds 200 with an
 *    `x-maxout-served-by` header (transparency header from the README).
 */
export class MockMaxoutServer {
  private server?: http.Server;
  private servedBy: string;

  constructor(servedBy = 'groq::gpt-oss-120b') {
    this.servedBy = servedBy;
  }

  listen(port = 8787, host = '127.0.0.1'): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        if (req.url === '/v1') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'x-maxout-served-by': this.servedBy,
          });
          res.end(JSON.stringify({ status: 'ok' }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      this.server.once('error', reject);
      this.server.listen(port, host, () => {
        this.server?.off('error', reject);
        resolve();
      });
    });
  }

  getPort(): number {
    const addr = this.server?.address() as AddressInfo | null;
    return addr ? addr.port : 0;
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}