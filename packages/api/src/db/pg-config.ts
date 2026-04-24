import type { PoolConfig } from 'pg'

export function getPgPoolConfig(connectionString: string): PoolConfig {
  const config: PoolConfig = {
    connectionString,
    max: Number(process.env.PG_POOL_MAX || 10),
  }

  let sslmode = ''
  try {
    const parsed = new URL(connectionString)
    sslmode = parsed.searchParams.get('sslmode')?.toLowerCase() ?? ''
    if (sslmode) {
      parsed.searchParams.delete('sslmode')
      config.connectionString = parsed.toString()
    }
  } catch {
    sslmode = ''
  }

  const explicitSslMode =
    process.env.PG_SSL_MODE?.toLowerCase() ||
    process.env.PGSSLMODE?.toLowerCase() ||
    sslmode

  if (explicitSslMode === 'disable') {
    config.ssl = false
  } else if (explicitSslMode === 'require' || explicitSslMode === 'prefer') {
    config.ssl = { rejectUnauthorized: true }
  } else if (explicitSslMode === 'no-verify' || explicitSslMode === 'allow') {
    config.ssl = { rejectUnauthorized: false }
  }

  return config
}
