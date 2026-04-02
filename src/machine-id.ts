import { createHash } from 'node:crypto'
import { getApiKey } from './openclaw-config.js'

let cachedMachineId: string | null = null

/**
 * Get unique identifier from API key
 * Returns consistent hash of the OpenClaw/Anthropic API key
 */
export function getMachineId(): string {
  if (cachedMachineId) {
    return cachedMachineId
  }

  try {
    // Get API key from OpenClaw config or environment
    const apiKey = getApiKey()

    // Create deterministic hash from API key
    cachedMachineId = createHash('sha256').update(apiKey).digest('hex').slice(0, 32)

    return cachedMachineId
  } catch (error) {
    // Fallback to random ID if API key not available
    // This ensures the plugin still works but pets won't be deterministic
    const fallbackId = createHash('sha256')
      .update(Date.now().toString() + Math.random().toString())
      .digest('hex')
      .slice(0, 32)

    console.error('[clawpet] Error getting API key, using non-deterministic fallback:', error)
    cachedMachineId = fallbackId
    return fallbackId
  }
}
