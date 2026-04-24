import { bootstrapPostgresSchema, closePgCompatDb, getPgCompatDb } from './postgres'

try {
  bootstrapPostgresSchema(getPgCompatDb())
  console.log('[db] Postgres schema bootstrap complete')
} finally {
  // Important for CI one-shot runs: terminate worker thread so Node can exit.
  closePgCompatDb()
}
