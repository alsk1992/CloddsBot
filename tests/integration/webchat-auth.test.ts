import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket, WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { createWebChatChannel } from '../../src/channels/webchat/index';

function createMessageQueue(ws: WebSocket) {
  const queue: any[] = [];
  const waiters: Array<{ predicate: (msg: any) => boolean; resolve: (msg: any) => void }> = [];

  ws.on('message', (data: WebSocket.RawData) => {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    const waiterIndex = waiters.findIndex((w) => w.predicate(msg));
    if (waiterIndex >= 0) {
      const waiter = waiters.splice(waiterIndex, 1)[0];
      waiter.resolve(msg);
      return;
    }

    queue.push(msg);
  });

  function waitFor(predicate: (msg: any) => boolean, timeoutMs = 1500): Promise<any> {
    const existingIndex = queue.findIndex(predicate);
    if (existingIndex >= 0) {
      return Promise.resolve(queue.splice(existingIndex, 1)[0]);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new Error('Timed out waiting for message'));
      }, timeoutMs);

      waiters.push({
        predicate,
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
      });
    });
  }

  return { waitFor };
}

test('webchat auth and message flow', async () => {
  const wss = new WebSocketServer({ port: 0, path: '/chat' });
  await new Promise<void>((resolve) => wss.on('listening', () => resolve()));
  const address = wss.address() as AddressInfo;
  const port = address.port;

  let received: any = null;
  const channel = createWebChatChannel(
    { enabled: true, authToken: 'secret' },
    {
      onMessage: async (message) => {
        received = message;
      },
    }
  );
  channel.start(wss);

  // After the WSS single-dispatcher refactor, start() no longer registers
  // a listener on wss directly — the gateway server dispatches via a mutable
  // callback. In tests we wire it up manually.
  const handler = channel.getConnectionHandler();
  if (handler) wss.on('connection', handler);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/chat`);
  const queue = createMessageQueue(ws);

  try {
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    await queue.waitFor((msg) => msg.type === 'connected');

    ws.send(JSON.stringify({ type: 'auth', token: 'secret', userId: 'web-user' }));
    await queue.waitFor((msg) => msg.type === 'authenticated' && msg.userId === 'web-user');

    ws.send(JSON.stringify({ type: 'message', text: 'hello' }));
    await queue.waitFor((msg) => msg.type === 'ack');

    const start = Date.now();
    while (!received) {
      if (Date.now() - start > 1500) {
        throw new Error('Timed out waiting for message callback');
      }
      await new Promise((r) => setTimeout(r, 10));
    }

    assert.equal(received.platform, 'webchat');
    assert.equal(received.userId, 'web-user');
    assert.equal(received.text, 'hello');
  } finally {
    ws.close();
    channel.stop();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  }
});
