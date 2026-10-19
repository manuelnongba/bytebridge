import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env.js';

function limit(value: string | undefined, fallback: number) {
  const number = Number(value);

  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

/** Persistent counters and expiring leases survive restarts and hibernation. */
export class AILimiter extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, room TEXT NOT NULL, started INTEGER NOT NULL, until_time INTEGER NOT NULL)',
    );
    ctx.storage.sql.exec(
      'CREATE INDEX IF NOT EXISTS request_time ON requests(started)',
    );
  }

  async acquire(room: string): Promise<string | null> {
    const now = Date.now();
    const sql = this.ctx.storage.sql;

    return this.ctx.storage.transactionSync(() => {
      sql.exec('DELETE FROM requests WHERE started <= ?', now - 3600000);

      const total = sql
        .exec<{ count: number }>('SELECT COUNT(*) AS count FROM requests')
        .one().count;
      const recent = sql
        .exec<{ count: number }>(
          'SELECT COUNT(*) AS count FROM requests WHERE room = ?',
          room,
        )
        .one().count;
      const active = sql
        .exec<{ room: string }>(
          'SELECT room FROM requests WHERE until_time > ?',
          now,
        )
        .toArray();

      if (
        total >= limit(this.env.AI_REQUESTS_PER_HOUR, 100) ||
        recent >= limit(this.env.AI_ROOM_REQUESTS_PER_HOUR, 20) ||
        active.length >= 4 ||
        active.some((entry) => entry.room === room)
      )
        return null;

      const id = crypto.randomUUID();

      sql.exec(
        'INSERT INTO requests VALUES (?, ?, ?, ?)',
        id,
        room,
        now,
        now + 70000,
      );

      return id;
    });
  }

  async release(id: string): Promise<void> {
    this.ctx.storage.sql.exec(
      'UPDATE requests SET until_time = 0 WHERE id = ?',
      id,
    );
  }
}
