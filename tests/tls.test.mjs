import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

test(
  'HTTPS API and WSS accept a trusted certificate and room credential',
  { timeout: 20000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'bytebridge-tls-'));
    const certFile = path.join(directory, 'cert.pem'),
      keyFile = path.join(directory, 'key.pem');

    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyFile,
        '-out',
        certFile,
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=IP:127.0.0.1,DNS:localhost',
      ],
      { stdio: 'ignore' },
    );

    const ca = await readFile(certFile);
    const child = spawn(process.execPath, ['scripts/server.mjs'], {
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: '0',
        TLS_CERT: certFile,
        TLS_KEY: keyFile,
        ROOM_CREATION_KEY: 'tls-test-key',
        YPERSISTENCE: path.join(directory, 'data'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let ws;

    try {
      const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('TLS server startup timeout')),
          8000,
        );

        child.stdout.on('data', (data) => {
          const match = String(data).match(/port (\d+)/);

          if (match) {
            clearTimeout(timer);
            resolve(Number(match[1]));
          }
        });
        child.stderr.on('data', (data) => {
          clearTimeout(timer);
          reject(new Error(String(data)));
        });
      });
      const room = await new Promise((resolve, reject) => {
        const req = request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/rooms',
            method: 'POST',
            ca,
            headers: { 'X-Creation-Key': 'tls-test-key' },
          },
          (res) => {
            let body = '';

            res.on('data', (chunk) => {
              body += chunk;
            });
            res.on('end', () => {
              try {
                assert.equal(res.statusCode, 201);
                resolve(JSON.parse(body));
              } catch (error) {
                reject(error);
              }
            });
          },
        );

        req.on('error', reject);
        req.end();
      });

      await new Promise((resolve, reject) => {
        ws = new WebSocket(
          `wss://127.0.0.1:${port}/${room.id}?token=${room.token}`,
          { ca },
        );
        ws.once('message', () => resolve());
        ws.once('error', reject);
      });
    } finally {
      ws?.terminate();

      if (child.exitCode === null)
        await new Promise((resolve) => {
          child.once('exit', resolve);
          child.kill('SIGTERM');
        });
    }
  },
);
