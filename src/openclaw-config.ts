import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/**
 * Get OpenClaw configuration directory
 */
function getOpenClawConfigPath(): string {
  return join(homedir(), '.openclaw', 'openclaw.json')
}

/**
 * Get API key from OpenClaw configuration with priority order:
 * 1. agents.defaults.model.primary's provider
 * 2. agents.list (id="main")'s provider
 * 3. First provider in models.providers
 */
export function getApiKey(): string {
  try {
    const configPath = getOpenClawConfigPath()
    if (!existsSync(configPath)) {
      throw new Error('OpenClaw config not found')
    }

    const configContent = readFileSync(configPath, 'utf-8')
    const config = JSON.parse(configContent)

    // Priority 1: agents.defaults.model.primary
    const primaryModel = config?.agents?.defaults?.model?.primary
    if (primaryModel && typeof primaryModel === 'string') {
      const providerName = primaryModel.split('/')[0]
      const apiKey = config?.models?.providers?.[providerName]?.apiKey
      if (apiKey) {
        return apiKey
      }
    }

    // Priority 2: agents.list with id="main"
    const agentsList = config?.agents?.list
    if (Array.isArray(agentsList)) {
      const mainAgent = agentsList.find((agent: any) => agent.id === 'main')
      if (mainAgent?.model) {
        const providerName = mainAgent.model.split('/')[0]
        const apiKey = config?.models?.providers?.[providerName]?.apiKey
        if (apiKey) {
          return apiKey
        }
      }
    }

    // Priority 3: First provider
    const providers = config?.models?.providers
    if (providers && typeof providers === 'object') {
      for (const [, providerConfig] of Object.entries(providers)) {
        const provider = providerConfig as any
        if (provider?.apiKey) {
          return provider.apiKey
        }
      }
    }

    throw new Error('No API key found in OpenClaw configuration')
  } catch (error) {
    console.error('[clawpet] Error reading OpenClaw config:', error)
    throw new Error('Failed to read OpenClaw configuration')
  }
}
