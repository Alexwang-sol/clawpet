import type { OpenClawPluginApi } from 'openclaw/plugin-sdk'
import { emptyPluginConfigSchema } from 'openclaw/plugin-sdk'
import { createHatchCommand } from './src/commands/hatch.js'
import { createPetCommand } from './src/commands/pet.js'
import { createAttackCommand } from './src/commands/attack.js'
import { getMachineId } from './src/machine-id.js'
import { loadCompanion, saveCompanion } from './src/storage.js'
import { executeCombat } from './src/combat.js'
import type { StoredCompanion } from './src/types.js'

const plugin = {
  id: 'clawpet',
  name: 'ClawPet',
  description: 'Virtual companion system - hatch and raise your own ASCII pet with unique traits and personality',

  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    // Register /hatch command
    api.registerCommand({
      name: 'hatch',
      description: 'Hatch a new virtual pet companion (once per machine)',
      acceptsArgs: false,
      requireAuth: false,
      handler: () => createHatchCommand(api),
    })

    // Register /pet command
    api.registerCommand({
      name: 'pet',
      description: 'View your virtual pet companion',
      acceptsArgs: false,
      requireAuth: false,
      handler: () => createPetCommand(api),
    })

    // Register /attack command
    api.registerCommand({
      name: 'attack',
      description: 'Attack another companion (or self for testing)',
      acceptsArgs: true,
      requireAuth: false,
      handler: createAttackCommand(api),
    })

    // Register clawpet_hatch tool (for AI to invoke)
    api.registerTool({
      name: 'clawpet_hatch',
      label: 'ClawPet Hatch',
      description: '孵化新宠物。当用户说 "/hatch"、"hatch"、"孵化" 或想创建宠物时调用。输出完整返回内容包括ASCII图。Hatch new pet when user says "/hatch" or wants to create a pet.',
      parameters: { type: 'object' as const, properties: {}, additionalProperties: false },
      async execute() {
        const result = createHatchCommand(api)
        return {
          content: [{ type: 'text' as const, text: result.text }],
          details: {},
        }
      },
    })

    // Register clawpet_pet tool (for AI to invoke)
    api.registerTool({
      name: 'clawpet_pet',
      label: 'ClawPet View',
      description: '查看宠物状态。当用户说 "/pet"、"pet"、"宠物" 或想查看宠物时调用。输出完整返回内容包括ASCII图。View pet status when user says "/pet" or wants to check their pet.',
      parameters: { type: 'object' as const, properties: {}, additionalProperties: false },
      async execute() {
        const result = createPetCommand(api)
        return {
          content: [{ type: 'text' as const, text: result.text }],
          details: {},
        }
      },
    })

    // Register clawpet_attack tool (for AI to invoke)
    api.registerTool({
      name: 'clawpet_attack',
      label: 'ClawPet Attack',
      description: 'Execute combat between companions. Use when user wants to battle, attack, or engage in combat. 宠物战斗系统。当用户想进行战斗、攻击或PK时调用。',
      parameters: {
        type: 'object' as const,
        properties: {
          attacker_id: {
            type: 'string' as const,
            description: 'Machine ID of the attacker (use "self" for current user)',
          },
          defender_id: {
            type: 'string' as const,
            description: 'Machine ID of the defender',
          },
        },
        required: ['defender_id'],
        additionalProperties: false,
      },
      async execute(toolCallId: string, input: { attacker_id?: string; defender_id: string }) {
        const attackerId = input.attacker_id || getMachineId()
        const defenderId = input.defender_id === 'self' ? attackerId : input.defender_id

        const combatResult = executeCombat(attackerId, defenderId)

        if (!combatResult.success) {
          return {
            content: [{ type: 'text' as const, text: `❌ ${combatResult.error}` }],
            details: {},
          }
        }

        const result = combatResult.result!
        const text = `⚔️ Combat Result:
Attacker: ${result.attacker.name} (Lv ${result.attacker.level})
Defender: ${result.defender.name} (Lv ${result.defender.level})

Attack Roll: ${result.attacker.attackRoll.roll} (d20: ${result.attacker.attackRoll.die}, bonus: +${result.attacker.attackRoll.bonus})
Defense Roll: ${result.defender.defenseRoll.roll} (d20: ${result.defender.defenseRoll.die}, bonus: +${result.defender.defenseRoll.bonus})

${result.criticalMiss ? '💥 CRITICAL MISS!' : result.critical ? '⚡ CRITICAL HIT!' : result.hit ? `✅ HIT for ${result.damage} damage!` : '❌ MISS!'}

${result.defender.name}'s HP: ${result.defender.hpAfter}/${result.defender.maxHP}${result.fainted ? ' - FAINTED!' : ''}`

        return {
          content: [{ type: 'text' as const, text }],
          details: {
            hit: result.hit,
            critical: result.critical,
            damage: result.damage,
            fainted: result.fainted,
          },
        }
      },
    })

    api.logger.info('🐾 ClawPet plugin registered successfully')

    // Track token usage for leveling using both llm_output and agent_end events
    api.on('llm_output', (event, ctx) => {
      // Debug: log entire event to see structure
      api.logger.info(`[clawpet] llm_output event fired, full event: ${JSON.stringify(event)}`)
      api.logger.info(`[clawpet] ctx: ${JSON.stringify(ctx)}`)

      const totalTokens = (event as any).lastAssistant?.usage?.totalTokens || 0
      if (totalTokens === 0) {
        api.logger.info(`[clawpet] No tokens found in event.lastAssistant.usage.totalTokens (value: ${(event as any).lastAssistant?.usage?.totalTokens})`)
        return
      }

      const userId = getMachineId()
      const companion = loadCompanion(userId)
      if (!companion) {
        api.logger.info(`[clawpet] No companion found for userId: ${userId}`)
        return
      }

      const updatedCompanion: StoredCompanion = {
        ...companion,
        totalTokensUsed: (companion.totalTokensUsed || 0) + totalTokens,
      }

      saveCompanion(userId, updatedCompanion)
      api.logger.info(`[clawpet] Updated tokens: ${updatedCompanion.totalTokensUsed}`)
    })

    // Fallback: Try agent_end event as alternative
    api.on('agent_end', (event, ctx) => {
      api.logger.info(`[clawpet] agent_end event fired for agentId: ${ctx.agentId}`)
    })
  },
}

export default plugin
