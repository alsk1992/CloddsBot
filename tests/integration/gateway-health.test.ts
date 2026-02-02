import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createServer as createGatewayServer } from '../../src/gateway/server';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

test('gateway health and info endpoints respond', async () => {
  const port = await getFreePort();
  const gateway = createGatewayServer({ port, cors: false, auth: {} });

  await gateway.start();
  try {
    const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.status, 'healthy');
    assert.equal(typeof health.timestamp, 'number');

    const infoRes = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(infoRes.status, 200);
    const info = await infoRes.json();
    assert.equal(info.name, 'clodds');
    assert.ok(info.endpoints);
    assert.equal(info.endpoints.health, '/health');
  } finally {
    await gateway.stop();
  }
});
