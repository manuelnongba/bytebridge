import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test(
  'two-process network harness validates locally without claiming remote execution',
  { timeout: 20000 },
  async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), 'bytebridge-network-harness-'),
    );
    const server = spawn(process.execPath, ['scripts/server.mjs'], {
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: '0',
        YPERSISTENCE: directory,
        TLS_CERT: '',
        TLS_KEY: '',
        TRUST_TLS_PROXY: '',
        ROOM_CREATION_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const children = [];

    try {
      const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Server start timeout')),
          8000,
        );

        server.stdout.on('data', (chunk) => {
          const match = String(chunk).match(/port (\d+)/);

          if (match) {
            clearTimeout(timer);
            resolve(Number(match[1]));
          }
        });
        server.stderr.on('data', (chunk) => {
          clearTimeout(timer);
          reject(new Error(String(chunk)));
        });
      });
      const origin = `http://127.0.0.1:${port}`;
      const room = await (
        await fetch(origin + '/rooms', { method: 'POST' })
      ).json();
      const invite = await (
        await fetch(`${origin}/rooms/${room.id}/invites`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${room.token}` },
        })
      ).json();
      const run = randomUUID();
      const results = await Promise.all(
        ['A', 'B'].map(
          (client) =>
            new Promise((resolve, reject) => {
              const child = spawn(
                process.execPath,
                ['scripts/network-client.mjs'],
                { stdio: ['pipe', 'pipe', 'pipe'] },
              );

              children.push(child);

              let output = '',
                errors = '';

              child.stdout.on('data', (chunk) => {
                output += chunk;
              });
              child.stderr.on('data', (chunk) => {
                errors += chunk;
              });
              child.on('error', reject);
              child.on('exit', (code) => {
                try {
                  assert.equal(code, 0, output || errors);
                  resolve(JSON.parse(output));
                } catch (error) {
                  reject(error);
                }
              });
              child.stdin.end(
                JSON.stringify({
                  server: origin,
                  room: room.id,
                  token: client === 'A' ? room.token : invite.token,
                  run,
                  client,
                  allowLocal: true,
                }),
              );
            }),
        ),
      );

      assert.equal(results[0].finalText, results[1].finalText);

      for (const result of results) {
        assert.equal(result.result, 'PASS');
        assert.equal(result.mode, 'local-harness-validation');
        assert.equal(result.publicIp, null);
      }
    } finally {
      for (const child of children)
        if (child.exitCode === null) child.kill('SIGTERM');

      if (server.exitCode === null)
        await new Promise((resolve) => {
          server.once('exit', resolve);
          server.kill('SIGTERM');
        });
    }
  },
);
