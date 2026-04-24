export type DbEngine = 'postgres'

export function getDbEngine(): DbEngine {
  return 'postgres'
}

export function isPostgres(): boolean {
  return true
}
