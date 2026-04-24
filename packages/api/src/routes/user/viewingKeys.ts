/**
 * Viewing Keys Routes
 * 
 * Provides server-side backup/restore for viewing keys.
 * Keys are encrypted with server-side encryption before storage.
 */

import { FastifyInstance } from 'fastify'
import { getDb } from '../../db/index'
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto'
import { ec as EC } from 'elliptic'
import { requireAuth } from '../../middleware/auth'
import { SERVER_SECRET } from '../../shared/config'

const secp256k1 = new EC('secp256k1')

// Server-side encryption key (should be in env in production)
const SERVER_ENCRYPTION_KEY = SERVER_SECRET
  ? Buffer.from(SERVER_SECRET, 'hex')
  : createHash('sha256').update('ipay-vk-encryption-key-v1').digest()

if (!SERVER_SECRET) {
  console.warn('[ViewingKey] ⚠️ SERVER_SECRET not set, using derived key (not recommended for production)')
}

/**
 * Encrypt viewing key with server key (AES-256-GCM)
 */
function encryptViewingKey(privKeyHex: string): { encrypted: string; iv: string; authTag: string } {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', SERVER_ENCRYPTION_KEY, iv)
  
  const privKeyBytes = Buffer.from(privKeyHex, 'hex')
  const encrypted = Buffer.concat([cipher.update(privKeyBytes), cipher.final()])
  const authTag = cipher.getAuthTag()
  
  return {
    encrypted: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  }
}

/**
 * Decrypt viewing key with server key
 */
function decryptViewingKey(encryptedHex: string, ivHex: string, authTagHex: string): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    SERVER_ENCRYPTION_KEY,
    Buffer.from(ivHex, 'hex')
  )
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final()
  ])
  
  return decrypted.toString('hex')
}

/**
 * Generate a new viewing key pair (server-side)
 */
function generateViewingKeyPair(): { privKey: string; pubKey: string } {
  const keyPair = secp256k1.genKeyPair()
  const privKey = keyPair.getPrivate('hex').padStart(64, '0')
  const pubKey = keyPair.getPublic('hex') // Already includes 04 prefix for uncompressed
  return { privKey, pubKey }
}

/**
 * Convert compressed pubkey (02/03 prefix) to uncompressed (04 prefix)
 */
function decompressPubKey(compressedHex: string): string {
  // If already uncompressed (04 prefix, 130 chars), return as-is
  if (compressedHex.startsWith('04') && compressedHex.length === 130) {
    return compressedHex
  }
  
  // If compressed (02/03 prefix, 66 chars), decompress
  if ((compressedHex.startsWith('02') || compressedHex.startsWith('03')) && compressedHex.length === 66) {
    try {
      const keyPair = secp256k1.keyFromPublic(compressedHex, 'hex')
      return keyPair.getPublic(false, 'hex') // false = uncompressed
    } catch (err) {
      console.error('[ViewingKey] Failed to decompress pubkey:', err)
    }
  }
  
  return compressedHex
}

export async function viewingKeyRoutes(app: FastifyInstance) {
  
  // ═══════════════════════════════════════════════════════════════════════════
  // Protected routes (require auth)
  // ═══════════════════════════════════════════════════════════════════════════
  
  await app.register(async (protectedApp) => {
    // Apply auth middleware to all routes in this sub-plugin
    protectedApp.addHook('preHandler', requireAuth)
    
    /**
     * Register new viewing key (server generates)
     * POST /v1/viewing-key/register
     */
    protectedApp.post('/viewing-key/register', async (request, reply) => {
      const address = (request as any).authAddress
      if (!address) {
        return reply.status(401).send({ error: 'Unauthorized' })
      }
      
      const normalizedAddr = address.toLowerCase()
      
      try {
        const db = getDb()
        
        // Check if already registered
        const existing = db.prepare(
          'SELECT pubkey FROM viewing_keys WHERE address = ? AND encrypted_privkey IS NOT NULL'
        ).get(normalizedAddr) as any
        
        if (existing) {
          return reply.status(409).send({ 
            error: 'ALREADY_REGISTERED',
            pubKey: existing.pubkey
          })
        }
        
        // Generate new viewing key pair
        const { privKey, pubKey } = generateViewingKeyPair()
        
        // Encrypt private key
        const { encrypted, iv, authTag } = encryptViewingKey(privKey)
        
        // Store in database (write to all required columns for compatibility)
        db.prepare(`
          INSERT INTO viewing_keys (address, pubkey, viewing_pubkey, encrypted_privkey, iv, auth_tag, key_version, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, now()::text, now()::text)
          ON CONFLICT(address) DO UPDATE SET
            pubkey = excluded.pubkey,
            viewing_pubkey = excluded.viewing_pubkey,
            encrypted_privkey = excluded.encrypted_privkey,
            iv = excluded.iv,
            auth_tag = excluded.auth_tag,
            key_version = 1,
            updated_at = now()::text
        `).run(normalizedAddr, pubKey, pubKey, encrypted, iv, authTag)
        
        console.log(`[ViewingKey] Generated and registered viewing key for ${normalizedAddr}`)
        
        return {
          success: true,
          privKey,  // Return once for client to cache
          pubKey,
          message: 'Viewing key generated and registered'
        }
      } catch (err) {
        protectedApp.log.error(err, '[ViewingKey] Register failed')
        return reply.status(500).send({ error: 'REGISTER_FAILED' })
      }
    })

    /**
     * Get viewing key status
     * GET /v1/viewing-key/status
     */
    protectedApp.get('/viewing-key/status', async (request, reply) => {
      const address = (request as any).authAddress
      if (!address) {
        return reply.status(401).send({ error: 'Unauthorized' })
      }
      
      const normalizedAddr = address.toLowerCase()
      
      try {
        const db = getDb()
        const row = db.prepare(
          'SELECT pubkey, created_at FROM viewing_keys WHERE address = ? AND encrypted_privkey IS NOT NULL'
        ).get(normalizedAddr) as any
        
        return {
          registered: !!row,
          pubKey: row?.pubkey ? decompressPubKey(row.pubkey) : null,
          createdAt: row?.created_at || null,
        }
      } catch {
        return { registered: false, pubKey: null, createdAt: null }
      }
    })
    
    /**
     * Get viewing key (requires auth)
     * GET /v1/viewing-key
     */
    protectedApp.get('/viewing-key', async (request, reply) => {
      const address = (request as any).authAddress
      if (!address) {
        return reply.status(401).send({ error: 'Unauthorized' })
      }
      
      const normalizedAddr = address.toLowerCase()
      
      try {
        const db = getDb()
        const row = db.prepare(
          'SELECT pubkey, encrypted_privkey, iv, auth_tag, created_at FROM viewing_keys WHERE address = ?'
        ).get(normalizedAddr) as any
        
        if (!row || !row.encrypted_privkey) {
          return reply.status(404).send({ error: 'No viewing key found' })
        }
        
        // Decrypt private key
        const privKey = decryptViewingKey(row.encrypted_privkey, row.iv, row.auth_tag)
        
        console.log(`[ViewingKey] Retrieved viewing key for ${normalizedAddr}`)
        
        return {
          privKey,
          pubKey: decompressPubKey(row.pubkey), // Ensure uncompressed format
          createdAt: row.created_at,
        }
      } catch (err) {
        protectedApp.log.error(err, '[ViewingKey] Get failed')
        return reply.status(500).send({ error: 'GET_FAILED' })
      }
    })
  })
  
  // ═══════════════════════════════════════════════════════════════════════════
  // Public routes (no auth required)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Check if viewing key exists (no auth required)
   * GET /v1/viewing-key/exists/:address
   */
  app.get('/viewing-key/exists/:address', async (request, reply) => {
    const { address } = request.params as { address: string }
    const normalizedAddr = address.toLowerCase()
    
    try {
      const db = getDb()
      const row = db.prepare(
        'SELECT 1 FROM viewing_keys WHERE address = ? AND encrypted_privkey IS NOT NULL'
      ).get(normalizedAddr)
      
      return { exists: !!row }
    } catch {
      return { exists: false }
    }
  })
  
  // ═══════════════════════════════════════════════════════════════════════════
  // Legacy endpoints (backward compatibility)
  // ═══════════════════════════════════════════════════════════════════════════
  
  // GET /viewing-keys/:address - Get viewing key status (legacy)
  app.get('/viewing-keys/:address', async (request, reply) => {
    const { address } = request.params as { address: string }
    const normalAddr = address.toLowerCase()
    
    try {
      const db = getDb()
      const row = db.prepare(
        'SELECT pubkey, created_at FROM viewing_keys WHERE address = ?'
      ).get(normalAddr) as any
      
      if (!row) {
        return { registered: false, pubKey: null }
      }
      
      return {
        registered: true,
        pubKey: decompressPubKey(row.pubkey), // Ensure uncompressed format
        createdAt: row.created_at,
      }
    } catch (err) {
      app.log.error(err, '[ViewingKeys] Get status failed')
      return { registered: false, pubKey: null }
    }
  })

  }
