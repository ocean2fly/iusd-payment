import fs from 'fs'
import { randomUUID } from 'crypto'
import { parentPort } from 'worker_threads'
import { Pool, PoolClient } from 'pg'
import { getPgPoolConfig } from './pg-config'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is required when DB_ENGINE=postgres')
}

const pool = new Pool(getPgPoolConfig(connectionString))

const txClients = new Map<string, PoolClient>()

async function writeResult(resultPath: string, signal: SharedArrayBuffer, payload: any) {
  fs.writeFileSync(resultPath, JSON.stringify(payload), 'utf8')
  const flag = new Int32Array(signal)
  Atomics.store(flag, 0, 1)
  Atomics.notify(flag, 0, 1)
}

parentPort?.on('message', async (message: any) => {
  const { action, sql, params = [], txId, resultPath, signal } = message

  try {
    if (action === 'begin') {
      const client = await pool.connect()
      await client.query('BEGIN')
      const newTxId = randomUUID()
      txClients.set(newTxId, client)
      await writeResult(resultPath, signal, { result: { rows: [{ txId: newTxId }], rowCount: 1 } })
      return
    }

    if (action === 'commit') {
      const client = txClients.get(String(txId))
      if (!client) throw new Error(`Unknown transaction: ${txId}`)
      await client.query('COMMIT')
      client.release()
      txClients.delete(String(txId))
      await writeResult(resultPath, signal, { result: { rows: [], rowCount: 0 } })
      return
    }

    if (action === 'rollback') {
      const client = txClients.get(String(txId))
      if (!client) throw new Error(`Unknown transaction: ${txId}`)
      await client.query('ROLLBACK')
      client.release()
      txClients.delete(String(txId))
      await writeResult(resultPath, signal, { result: { rows: [], rowCount: 0 } })
      return
    }

    const executor = txId ? txClients.get(String(txId)) : pool
    if (!executor) throw new Error(`Unknown transaction: ${txId}`)

    const result = await executor.query(sql, params)
    await writeResult(resultPath, signal, {
      result: {
        rows: result.rows,
        rowCount: result.rowCount,
      },
    })
  } catch (error: any) {
    await writeResult(resultPath, signal, { error: error?.message ?? String(error) })
  }
})
