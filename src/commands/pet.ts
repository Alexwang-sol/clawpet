import type { OpenClawPluginApi } from 'openclaw/plugin-sdk'
import { getCompanion } from '../companion.js'
import { renderSprite, renderFace } from '../sprites.js'
import { RARITY_STARS, type StatName, DAMAGE_VARIANCE_PERCENT } from '../types.js'
import { getMachineId } from '../machine-id.js'
import { loadCompanion, saveCompanion } from '../storage.js'
import {
  calculateAttackBonus,
  calculateDefenseBonus,
  canAttack,
} from '../combat.js'
import { formatBar, calculateBaseDamage } from '../utils.js'

const STAT_FULL_NAMES: Record<StatName, string> = {
  STR: 'Strength',
  DEX: 'Dexterity',
  CON: 'Constitution',
  INT: 'Intelligence',
  WIS: 'Wisdom',
  CHA: 'Charisma',
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}m`
  } else if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`
  }
  return tokens.toString()
}

export function createPetCommand(api: OpenClawPluginApi): { text: string } {
  // Get user ID from machine ID
  const userId = getMachineId()

  console.log(`[clawpet] /pet command called`)
  console.log(`[clawpet] userId from getMachineId(): ${userId}`)

  // Load companion from save file
  const storedCompanion = loadCompanion(userId)

  // Check if companion exists
  if (!storedCompanion) {
    return {
      text: `You don't have a companion yet! Use /hatch to get one.`,
    }
  }

  // Regenerate bones and merge with soul
  const companion = getCompanion(userId, storedCompanion)

  if (!companion) {
    return {
      text: `Error loading your companion. Try /hatch again.`,
    }
  }

  // Save companion only if HP/MP or lastRegenTime changed
  const hasChanges =
    companion.currentHP !== storedCompanion.currentHP ||
    companion.currentMP !== storedCompanion.currentMP ||
    companion.lastRegenTime !== storedCompanion.lastRegenTime

  if (hasChanges) {
    saveCompanion(userId, {
      name: companion.name,
      personality: companion.personality,
      hatchedAt: companion.hatchedAt,
      totalTokensUsed: companion.totalTokensUsed,
      currentHP: companion.currentHP,
      currentMP: companion.currentMP,
      lastRegenTime: companion.lastRegenTime,
      lastCombatTime: storedCompanion.lastCombatTime,
    })
  }

  // Render sprite (use frame 0 for static display)
  const sprite = renderSprite(companion, 0)
  const face = renderFace(companion)
  const rarityStars = RARITY_STARS[companion.rarity]

  // Calculate age in days
  const ageMs = Date.now() - companion.hatchedAt
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24))
  const ageDisplay = ageDays === 0 ? 'just hatched!' : `${ageDays} day${ageDays === 1 ? '' : 's'} old`

  // Format stats
  const statsDisplay = Object.entries(companion.stats)
    .map(([name, value]) => {
      const fullName = STAT_FULL_NAMES[name as StatName]
      const bar = '█'.repeat(Math.floor(value / 10)) + '░'.repeat(10 - Math.floor(value / 10))
      return `${fullName}: ${bar} ${value}`
    })
    .join('\n')

  // Format HP/MP bars
  const hpBar = formatBar(companion.currentHP, companion.maxHP)
  const mpBar = formatBar(companion.currentMP, companion.maxMP)

  // Calculate combat stats
  const attackBonus = calculateAttackBonus(companion.stats.DEX, companion.level)
  const defenseBonus = calculateDefenseBonus(
    companion.stats.WIS,
    companion.stats.DEX,
    companion.level,
  )
  const baseDamage = calculateBaseDamage(companion.stats.STR, companion.level)
  const minDamage = Math.max(1, Math.floor(baseDamage * (1 - DAMAGE_VARIANCE_PERCENT)))
  const maxDamage = Math.floor(baseDamage * (1 + DAMAGE_VARIANCE_PERCENT))
  const damageRange = `${minDamage}-${maxDamage}`

  // Check combat cooldown
  const cooldownCheck = canAttack(storedCompanion)
  const cooldownText = !cooldownCheck.allowed
    ? `\n⏱️  Combat cooldown: ${Math.ceil(cooldownCheck.remainingMs / 1000)}s`
    : ''

  return {
    text: `\`\`\`
${sprite.join('\n')}
\`\`\`

${face} ${companion.name}
${rarityStars} ${companion.rarity.toUpperCase()} ${companion.species.toUpperCase()}${companion.shiny ? ' ✨ SHINY' : ''}

${companion.personality}

Age: ${ageDisplay}
Level: ${companion.level} (${formatTokens(companion.totalTokensUsed)} tokens, ${formatTokens(companion.tokensToNextLevel)} to next level)
Eye: ${companion.eye}  Hat: ${companion.hat}

💚 HP: ${hpBar} ${companion.currentHP}/${companion.maxHP}
💙 MP: ${mpBar} ${companion.currentMP}/${companion.maxMP}${cooldownText}

Combat Stats:
⚔️  Attack Bonus: +${attackBonus}
🛡️  Defense Bonus: +${defenseBonus}
💥 Damage Range: ${damageRange}

Stats:
${statsDisplay}`,
  }
}
