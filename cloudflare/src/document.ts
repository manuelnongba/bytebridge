import * as Y from 'yjs';

export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;

/** Chunked binary updates avoid SQLite's row-size limit. Compaction retains Yjs IDs. */
export class DocumentStore {
  constructor(private storage: DurableObjectStorage) {
    storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS document_updates (revision INTEGER, part INTEGER, data BLOB NOT NULL, PRIMARY KEY (revision, part))',
    );
  }

  load(): Y.Doc {
    const doc = new Y.Doc();
    const rows = this.storage.sql.exec<{ revision: number; data: ArrayBuffer }>(
      'SELECT revision, data FROM document_updates ORDER BY revision, part',
    );
    let revision = -1;
    let chunks: Uint8Array[] = [];

    for (const row of rows) {
      if (row.revision !== revision && chunks.length) {
        Y.applyUpdate(doc, Buffer.concat(chunks));
        chunks = [];
      }

      revision = row.revision;
      chunks.push(new Uint8Array(row.data));
    }

    if (chunks.length) Y.applyUpdate(doc, Buffer.concat(chunks));

    return doc;
  }

  save(doc: Y.Doc, update: Uint8Array): void {
    const sql = this.storage.sql;
    const stats = sql
      .exec<{ revision: number; bytes: number; logBytes: number }>(
        'SELECT COALESCE(MAX(revision), 0) AS revision, COALESCE(SUM(length(data)), 0) AS bytes, COALESCE(SUM(CASE WHEN revision > 0 THEN length(data) ELSE 0 END), 0) AS logBytes FROM document_updates',
      )
      .one();
    const compact =
      stats.revision >= 128 ||
      stats.logBytes + update.byteLength >= 1024 * 1024 ||
      stats.bytes + update.byteLength > MAX_DOCUMENT_BYTES;
    const data = compact ? Y.encodeStateAsUpdate(doc) : update;

    if (data.byteLength > MAX_DOCUMENT_BYTES)
      throw new Error('Room storage limit reached.');

    this.storage.transactionSync(() => {
      if (compact) sql.exec('DELETE FROM document_updates');

      const revision = compact ? 0 : stats.revision + 1;

      for (
        let offset = 0, part = 0;
        offset < data.length;
        offset += CHUNK_BYTES, part++
      ) {
        sql.exec(
          'INSERT INTO document_updates VALUES (?, ?, ?)',
          revision,
          part,
          data.slice(offset, offset + CHUNK_BYTES).buffer,
        );
      }
    });
  }

  clear(): void {
    this.storage.sql.exec('DELETE FROM document_updates');
  }
}
