import type { OpenClawPluginApi } from 'openclaw/plugin-sdk'
import { getMachineId } from '../machine-id.js'
import { executeCombat } from '../combat.js'
import { renderSprite } from '../sprites.js'
import { formatBar } from '../utils.js'

// Simple type for command context
type CommandContext = {
  args?: string
}

function formatCombatLog(
  result: any,
  attackerSprite: string[],
  defenderSprite: string[],
): string {
  const { attacker, defender, hit, critical, criticalMiss, damage, fainted } = result

  // Build combat narrative
  let narrative = ''

  if (criticalMiss) {
    narrative = `💥 CRITICAL MISS! ${attacker.name}'s attack went completely awry!`
  } else if (critical) {
    narrative = `⚡ CRITICAL HIT! ${attacker.name} struck with devastating force!`
  } else if (hit) {
    narrative = `${attacker.name} hit ${defender.name} for ${damage} damage!`
  } else {
    narrative = `${defender.name} dodged ${attacker.name}'s attack!`
  }

  // Format sprites side by side
  const maxHeight = Math.max(attackerSprite.length, defenderSprite.length)
  const spriteWidth = attackerSprite[0]?.length || 0
  const padding = '    '

  let spritesDisplay = ''
  for (let i = 0; i < maxHeight; i++) {
    const leftSprite = attackerSprite[i] || ' '.repeat(spriteWidth)
    const rightSprite = defenderSprite[i] || ' '.repeat(spriteWidth)
    spritesDisplay += `${leftSprite}${padding}VS${padding}${rightSprite}\n`
  }

  // Format HP bars
  const defenderHPBar = formatBar(defender.hpAfter, defender.maxHP)
  const defenderHPText = `${defender.hpAfter}/${defender.maxHP}`

  // Build roll details
  const attackRollText = `${attacker.name} rolls ${attacker.attackRoll.die}${attacker.attackRoll.bonus > 0 ? `+${attacker.attackRoll.bonus}` : ''} = ${attacker.attackRoll.roll}`
  const defenseRollText = `${defender.name} rolls ${defender.defenseRoll.die}${defender.defenseRoll.bonus > 0 ? `+${defender.defenseRoll.bonus}` : ''} = ${defender.defenseRoll.roll}`

  return `\`\`\`
${spritesDisplay}
\`\`\`

**${narrative}**

📊 Combat Rolls:
• Attack: ${attackRollText}
• Defense: ${defenseRollText}

${fainted ? '💀' : '💚'} ${defender.name}'s HP: ${defenderHPBar} ${defenderHPText}${fainted ? ' - FAINTED!' : ''}`
}

export function createAttackCommand(api: OpenClawPluginApi) {
  return function (ctx: CommandContext): { text: string } {
    const attackerId = getMachineId()

    // Parse target - can be machine ID or "self" for testing
    // args is a space-separated string, take first word
    const argsArray = ctx.args?.trim().split(/\s+/) || []
    let defenderId: string
    if (argsArray.length === 0 || argsArray[0] === 'self') {
      defenderId = attackerId // Attack self for testing
    } else {
      defenderId = argsArray[0]
    }

    console.log(`[clawpet-attack] Attack: ${attackerId} -> ${defenderId}`)

    // Execute combat
    const combatResult = executeCombat(attackerId, defenderId)

    if (!combatResult.success) {
      return {
        text: `❌ ${combatResult.error}`,
      }
    }

    // Render sprites for both companions
    const attackerSprite = renderSprite(combatResult.attacker!, 0)
    const defenderSprite = renderSprite(combatResult.defender!, 0)

    // Format and return combat log
    const combatLog = formatCombatLog(
      combatResult.result!,
      attackerSprite,
      defenderSprite,
    )

    return {
      text: combatLog,
    }
  }
}
