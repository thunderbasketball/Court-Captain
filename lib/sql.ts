import type { Pool, PoolClient, QueryResultRow } from "pg";

export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

// Runs fn in one transaction. A thrown error rolls back; a normal return commits. Left open and idle for a minute, the
// database ends it: a host like Netlify can pause a copy of the app halfway through, and an open transaction would hold
// its locks (and block changes to those tables) until that copy wakes up.
export async function withTx<T>(pool: Pool, fn: (q: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin; set local idle_in_transaction_session_timeout = 60000");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {}); // the connection may be gone; the real error is e
    throw e;
  } finally {
    client.release();
  }
}
