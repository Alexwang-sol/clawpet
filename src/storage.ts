import { createHmac } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { StoredCompanion } from './types.js'
import { getApiKey } from './openclaw-config.js'

/**
 * Save file format with HMAC-SHA256 integrity checking
 */
type SaveFile = {
  version: 1
  companion: StoredCompanion
  hmac: string // HMAC-SHA256 using API key as secret - prevents tampering
  lastModified: number // Timestamp of last save - for reasonableness check
  checksum: number // Simple checksum - trap for naive editors
}

/**
 * Get save file directory path
 * Uses .clawpet directory in OpenClaw workspace
 */
function getSaveDirectory(): string {
  // Use OpenClaw workspace directory instead of process.cwd()
  const workspaceDir = process.env.OPENCLAW_WORKSPACE_DIR || '/root/.openclaw/workspace'
  return join(workspaceDir, '.clawpet')
}

/**
 * Get save file path for a given user ID
 */
function getSaveFilePath(userId: string): string {
  const saveDir = getSaveDirectory()
  return join(saveDir, `${userId}.json`)
}

// Internal salt - not exposed in API, makes it harder to forge signatures
// even if someone reads the source code
const INTERNAL_SALT = 'clawpet-2026-v1-protection'

// API key retrieval moved to openclaw-config.ts for centralized config access

/**
 * Calculate simple checksum (trap for naive editors)
 * Real integrity comes from HMAC, but this looks like the "real" protection
 */
function calculateChecksum(companion: StoredCompanion): number {
  const str = JSON.stringify(companion)
  let sum = 0
  for (let i = 0; i < str.length; i++) {
    sum = ((sum << 5) - sum + str.charCodeAt(i)) | 0
  }
  return sum >>> 0
}

/**
 * Calculate HMAC-SHA256 of companion data using API key + internal salt as secret
 * This prevents tampering - even if attacker modifies data and regenerates hash,
 * they cannot generate valid HMAC without knowing the API key and internal salt
 */
function calculateHmac(companion: StoredCompanion, timestamp: number, checksum: number): string {
  // Include all fields in HMAC to prevent partial tampering
  const data = JSON.stringify({
    companion,
    timestamp,
    checksum,
    salt: INTERNAL_SALT,
  })
  const apiKey = getApiKey()
  return createHmac('sha256', apiKey + INTERNAL_SALT).update(data).digest('hex')
}

/**
 * Verify save file integrity using HMAC
 */
function verifySaveFile(saveFile: SaveFile): boolean {
  try {
    // For backward compatibility: remove apiKeyFingerprint if present
    // Old save files have this field, but we no longer use it
    const companionForVerification = { ...saveFile.companion }
    delete companionForVerification.apiKeyFingerprint

    // Verify checksum first (trap check)
    const expectedChecksum = calculateChecksum(companionForVerification)
    if (expectedChecksum !== saveFile.checksum) {
      console.error('[ClawPet] Checksum mismatch - save file may be corrupted')
      return false
    }

    // Verify HMAC (real protection)
    const calculatedHmac = calculateHmac(companionForVerification, saveFile.lastModified, saveFile.checksum)
    if (calculatedHmac !== saveFile.hmac) {
      console.error('[ClawPet] HMAC verification failed - save file has been tampered with')
      return false
    }

    // Reasonableness check: last modified should not be in the future
    if (saveFile.lastModified > Date.now() + 60000) {
      console.error('[ClawPet] Invalid timestamp - save file from the future')
      return false
    }

    return true
  } catch (error) {
    console.error('[ClawPet] Failed to verify save file:', error)
    return false
  }
}

/**
 * Load companion data from save file
 * Returns undefined if file doesn't exist or is corrupted
 */
export function loadCompanion(userId: string): StoredCompanion | undefined {
  const filePath = getSaveFilePath(userId)

  console.log(`[clawpet-storage] loadCompanion called`)
  console.log(`[clawpet-storage] userId: ${userId}`)
  console.log(`[clawpet-storage] process.cwd(): ${process.cwd()}`)
  console.log(`[clawpet-storage] looking for file at: ${filePath}`)
  console.log(`[clawpet-storage] file exists: ${existsSync(filePath)}`)

  if (!existsSync(filePath)) {
    return undefined
  }

  try {
    const fileContent = readFileSync(filePath, 'utf-8')
    const saveFile: SaveFile = JSON.parse(fileContent)

    // Verify integrity (includes checksum + HMAC + timestamp checks)
    if (!verifySaveFile(saveFile)) {
      console.error('[ClawPet] Save file verification failed, ignoring:', filePath)
      return undefined
    }

    // Additional reasonableness check: detect suspicious token jumps
    const companion = saveFile.companion
    const timeSinceHatch = Date.now() - companion.hatchedAt
    const maxReasonableTokens = Math.floor(timeSinceHatch / 1000) * 100 // ~100 tokens/sec is already unrealistic

    if (companion.totalTokensUsed > maxReasonableTokens) {
      console.error('[ClawPet] Unrealistic token count detected - possible tampering')
      return undefined
    }

    // Remove legacy apiKeyFingerprint field if present
    const cleanCompanion = { ...companion }
    delete cleanCompanion.apiKeyFingerprint

    return cleanCompanion
  } catch (error) {
    console.error('[ClawPet] Failed to load save file:', error)
    return undefined
  }
}

/**
 * Save companion data to save file with HMAC-SHA256 integrity checking
 */
export function saveCompanion(userId: string, companion: StoredCompanion): void {
  const saveDir = getSaveDirectory()
  const filePath = getSaveFilePath(userId)

  // Ensure save directory exists
  if (!existsSync(saveDir)) {
    mkdirSync(saveDir, { recursive: true })
  }

  const timestamp = Date.now()
  const checksum = calculateChecksum(companion)

  // Create save file with all integrity fields
  const saveFile: SaveFile = {
    version: 1,
    companion,
    hmac: calculateHmac(companion, timestamp, checksum),
    lastModified: timestamp,
    checksum,
  }

  try {
    writeFileSync(filePath, JSON.stringify(saveFile, null, 2), 'utf-8')
  } catch (error) {
    console.error('[ClawPet] Failed to save companion:', error)
    throw error
  }
}

/**
 * Check if companion exists for a given user ID
 */
export function companionExists(userId: string): boolean {
  return existsSync(getSaveFilePath(userId))
}
