import type { Companion, CombatResult, CombatRoll, StoredCompanion } from './types.js'
import { DAMAGE_VARIANCE_PERCENT } from './types.js'
import { getCompanion } from './companion.js'
import { loadCompanion, saveCompanion } from './storage.js'
import { calculateBaseDamage } from './utils.js'

// HP/MP Constants
const BASE_HP = 20
const CON_MULTIPLIER = 1.5
const LEVEL_HP_MULTIPLIER = 3

const BASE_MP = 10
const INT_MULTIPLIER = 1.0
const LEVEL_MP_MULTIPLIER = 2

// Combat Constants
const COMBAT_COOLDOWN_MS = 5000 // 5 seconds
const HP_REGEN_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const MP_REGEN_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Calculate maximum HP based on Constitution and level
 */
export function calculateMaxHP(con: number, level: number): number {
  return Math.floor(BASE_HP + con * CON_MULTIPLIER + level * LEVEL_HP_MULTIPLIER)
}

/**
 * Calculate maximum MP based on Intelligence and level
 */
export function calculateMaxMP(int: number, level: number): number {
  return Math.floor(BASE_MP + int * INT_MULTIPLIER + level * LEVEL_MP_MULTIPLIER)
}

/**
 * Roll a d20 (1-20)
 */
export function d20(): number {
  return Math.floor(Math.random() * 20) + 1
}

/**
 * Calculate attack bonus from Dexterity and level
 */
export function calculateAttackBonus(dex: number, level: number): number {
  return Math.floor(dex / 10) + Math.floor(level / 5)
}

/**
 * Calculate defense bonus from Wisdom, Dexterity, and level
 */
export function calculateDefenseBonus(
  wis: number,
  dex: number,
  level: number,
): number {
  return Math.floor(wis / 10) + Math.floor(dex / 20) + Math.floor(level / 5)
}

/**
 * Calculate base damage from Strength and level
 * Returns damage with variance applied
 */
export function calculateDamage(str: number, level: number): number {
  const baseDamage = calculateBaseDamage(str, level)
  const variance = Math.floor(baseDamage * DAMAGE_VARIANCE_PERCENT)
  const randomVariance = Math.floor(Math.random() * (variance * 2 + 1)) - variance
  return Math.max(1, baseDamage + randomVariance) // Minimum 1 damage
}

/**
 * Apply level difference modifier to attack/defense rolls
 */
export function applyLevelModifier(
  attacker: Companion,
  defender: Companion,
): { attackBonus: number; defenseBonus: number } {
  const levelDiff = attacker.level - defender.level

  if (levelDiff > 0) {
    // Attacker higher level: +1 attack per 5 levels
    return {
      attackBonus: Math.floor(levelDiff / 5),
      defenseBonus: 0,
    }
  } else if (levelDiff < 0) {
    // Defender higher level: +1 defense per 5 levels
    return {
      attackBonus: 0,
      defenseBonus: Math.floor(Math.abs(levelDiff) / 5),
    }
  }

  return { attackBonus: 0, defenseBonus: 0 }
}

/**
 * Apply time-based regeneration to HP/MP
 */
export function applyRegeneration(
  stored: StoredCompanion,
  maxHP: number,
  maxMP: number,
): StoredCompanion {
  const now = Date.now()
  const lastRegen = stored.lastRegenTime ?? now
  const timeDiff = now - lastRegen

  // Initialize HP/MP if undefined
  let currentHP = stored.currentHP ?? maxHP
  let currentMP = stored.currentMP ?? maxMP

  // Early return if no regeneration will occur and already at max
  if (timeDiff < HP_REGEN_INTERVAL_MS && currentHP >= maxHP && currentMP >= maxMP) {
    return stored
  }

  // Calculate regeneration
  const hpRegen = Math.floor(timeDiff / HP_REGEN_INTERVAL_MS)
  const mpRegen = Math.floor(timeDiff / MP_REGEN_INTERVAL_MS)

  // Apply regen (capped at max)
  currentHP = Math.min(maxHP, currentHP + hpRegen)
  currentMP = Math.min(maxMP, currentMP + mpRegen)

  return {
    ...stored,
    currentHP,
    currentMP,
    lastRegenTime: now,
  }
}

/**
 * Check if combat cooldown has passed
 */
export function canAttack(stored: StoredCompanion): {
  allowed: boolean
  remainingMs: number
} {
  if (!stored.lastCombatTime) {
    return { allowed: true, remainingMs: 0 }
  }

  const now = Date.now()
  const timeSinceLastCombat = now - stored.lastCombatTime
  const remaining = COMBAT_COOLDOWN_MS - timeSinceLastCombat

  return {
    allowed: remaining <= 0,
    remainingMs: Math.max(0, remaining),
  }
}

/**
 * Execute a combat roll with bonus
 */
function rollWithBonus(bonus: number): CombatRoll {
  const die = d20()
  return {
    roll: die + bonus,
    die,
    bonus,
  }
}

/**
 * Execute combat between two companions
 * Returns combat result and updates both companions' HP/MP
 */
export function resolveCombat(
  attacker: Companion,
  defender: Companion,
): CombatResult {
  // Calculate base bonuses
  const attackBonus = calculateAttackBonus(attacker.stats.DEX, attacker.level)
  const defenseBonus = calculateDefenseBonus(
    defender.stats.WIS,
    defender.stats.DEX,
    defender.level,
  )

  // Apply level modifiers
  const levelMod = applyLevelModifier(attacker, defender)

  // Roll attack and defense
  const attackRoll = rollWithBonus(attackBonus + levelMod.attackBonus)
  const defenseRoll = rollWithBonus(defenseBonus + levelMod.defenseBonus)

  // Determine hit/miss
  const criticalMiss = attackRoll.die === 1
  const critical = attackRoll.die === 20
  const hit = !criticalMiss && (critical || attackRoll.roll >= defenseRoll.roll)

  // Calculate damage
  let damage = 0
  if (hit) {
    damage = calculateDamage(attacker.stats.STR, attacker.level)
    if (critical) {
      damage = damage * 2 // Double damage on critical
    }
  }

  // Apply damage
  const hpBefore = defender.currentHP
  const hpAfter = Math.max(0, hpBefore - damage)
  const fainted = hpAfter === 0

  return {
    attacker: {
      name: attacker.name,
      level: attacker.level,
      attackRoll,
    },
    defender: {
      name: defender.name,
      level: defender.level,
      defenseRoll,
      hpBefore,
      hpAfter,
      maxHP: defender.maxHP,
    },
    hit,
    critical,
    criticalMiss,
    damage,
    fainted,
  }
}

/**
 * Execute combat between two users' companions
 * Loads companions, performs combat, saves results
 */
export function executeCombat(
  attackerId: string,
  defenderId: string,
): {
  success: boolean
  error?: string
  result?: CombatResult
  attacker?: Companion
  defender?: Companion
} {
  // Load attacker
  const attackerStored = loadCompanion(attackerId)
  if (!attackerStored) {
    return {
      success: false,
      error: `Attacker doesn't have a companion. Use /hatch first.`,
    }
  }

  const attacker = getCompanion(attackerId, attackerStored)
  if (!attacker) {
    return {
      success: false,
      error: `Failed to load attacker's companion.`,
    }
  }

  // Check if attacker is fainted
  if (attacker.currentHP <= 0) {
    return {
      success: false,
      error: `${attacker.name} has fainted! Wait for HP to regenerate.`,
    }
  }

  // Check combat cooldown
  const cooldownCheck = canAttack(attackerStored)
  if (!cooldownCheck.allowed) {
    const seconds = Math.ceil(cooldownCheck.remainingMs / 1000)
    return {
      success: false,
      error: `${attacker.name} is exhausted! Wait ${seconds} more second${seconds === 1 ? '' : 's'} before attacking again.`,
    }
  }

  // Load defender
  const defenderStored = loadCompanion(defenderId)
  if (!defenderStored) {
    return {
      success: false,
      error: `Defender doesn't have a companion.`,
    }
  }

  const defender = getCompanion(defenderId, defenderStored)
  if (!defender) {
    return {
      success: false,
      error: `Failed to load defender's companion.`,
    }
  }

  // Check if defender is fainted
  if (defender.currentHP <= 0) {
    return {
      success: false,
      error: `${defender.name} has already fainted!`,
    }
  }

  // Resolve combat
  const result = resolveCombat(attacker, defender)

  // Update attacker (just combat time)
  const attackerUpdated: StoredCompanion = {
    ...attackerStored,
    lastCombatTime: Date.now(),
    currentHP: attacker.currentHP,
    currentMP: attacker.currentMP,
    lastRegenTime: attackerStored.lastRegenTime ?? Date.now(),
  }

  // Update defender (HP and combat time)
  const defenderUpdated: StoredCompanion = {
    ...defenderStored,
    currentHP: result.defender.hpAfter,
    currentMP: defender.currentMP,
    lastRegenTime: defenderStored.lastRegenTime ?? Date.now(),
    lastCombatTime: Date.now(),
  }

  // Save both companions
  try {
    saveCompanion(attackerId, attackerUpdated)
    saveCompanion(defenderId, defenderUpdated)
  } catch (error) {
    return {
      success: false,
      error: `Failed to save combat results: ${error}`,
    }
  }

  // Return companions with updated HP for display
  return {
    success: true,
    result,
    attacker: {
      ...attacker,
      currentHP: attackerUpdated.currentHP!,
      currentMP: attackerUpdated.currentMP!,
    },
    defender: {
      ...defender,
      currentHP: result.defender.hpAfter,
      currentMP: defenderUpdated.currentMP!,
    },
  }
}
