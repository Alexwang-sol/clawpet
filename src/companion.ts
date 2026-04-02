import {
  type Companion,
  type CompanionBones,
  EYES,
  HATS,
  RARITIES,
  RARITY_WEIGHTS,
  type Rarity,
  SPECIES,
  STAT_NAMES,
  type StatName,
  type StoredCompanion,
} from './types.js'
import {
  calculateMaxHP,
  calculateMaxMP,
  applyRegeneration,
} from './combat.js'

// Mulberry32 — tiny seeded PRNG, good enough for picking ducks
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// FNV-1a hash for Node.js (replaces Bun.hash)
function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!
}

function rollRarity(rng: () => number): Rarity {
  const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0)
  let roll = rng() * total
  for (const rarity of RARITIES) {
    roll -= RARITY_WEIGHTS[rarity]
    if (roll < 0) return rarity
  }
  return 'common'
}

const RARITY_FLOOR: Record<Rarity, number> = {
  common: 5,
  uncommon: 15,
  rare: 25,
  epic: 35,
  legendary: 50,
}

// One peak stat, one dump stat, rest scattered. Rarity bumps the floor.
function rollStats(
  rng: () => number,
  rarity: Rarity,
): Record<StatName, number> {
  const floor = RARITY_FLOOR[rarity]
  const peak = pick(rng, STAT_NAMES)
  let dump = pick(rng, STAT_NAMES)
  while (dump === peak) dump = pick(rng, STAT_NAMES)

  const stats = {} as Record<StatName, number>
  for (const name of STAT_NAMES) {
    if (name === peak) {
      stats[name] = Math.min(100, floor + 20 + Math.floor(rng() * 20))
    } else if (name === dump) {
      stats[name] = Math.max(1, floor - 5 + Math.floor(rng() * 10))
    } else {
      stats[name] = floor + Math.floor(rng() * 25)
    }
  }
  return stats
}

const SALT = 'friend-2026-401'

export type Roll = {
  bones: CompanionBones
  inspirationSeed: number
}

function rollFrom(rng: () => number): Roll {
  const rarity = rollRarity(rng)
  const bones: CompanionBones = {
    rarity,
    species: pick(rng, SPECIES),
    eye: pick(rng, EYES),
    hat: rarity === 'common' ? 'none' : pick(rng, HATS),
    shiny: rng() < 0.01,
    stats: rollStats(rng, rarity),
  }
  return { bones, inspirationSeed: Math.floor(rng() * 1e9) }
}

// Called from hot paths → cache the deterministic result
let rollCache: { key: string; value: Roll } | undefined
export function roll(userId: string): Roll {
  const key = userId + SALT
  if (rollCache?.key === key) return rollCache.value
  const value = rollFrom(mulberry32(hashString(key)))
  rollCache = { key, value }
  return value
}

export function rollWithSeed(seed: string): Roll {
  return rollFrom(mulberry32(hashString(seed)))
}

/**
 * Calculate required tokens (EXP) for a given level based on rarity
 * Using Pokemon experience formulas scaled up for realistic token usage
 * Base multiplier: 5000 (so level 2 common ~52k tokens ≈ 5-7 conversations)
 */
export function tokensForLevel(rarity: Rarity, level: number): number {
  const lv = level
  const BASE_MULTIPLIER = 5000

  switch (rarity) {
    case 'legendary': // 最快组 (Fastest) - complex piecewise function
      if (lv <= 50) {
        return Math.floor((-0.02 * lv ** 4 + 2 * lv ** 3) * BASE_MULTIPLIER)
      } else if (lv <= 68) {
        return Math.floor((-0.01 * lv ** 4 + 1.5 * lv ** 3) * BASE_MULTIPLIER)
      } else if (lv <= 98) {
        return Math.floor(0.002 * lv ** 3 * Math.floor((1911 - 10 * lv) / 3) * BASE_MULTIPLIER)
      } else {
        // 99-100
        return Math.floor((-0.01 * lv ** 4 + 1.6 * lv ** 3) * BASE_MULTIPLIER)
      }

    case 'epic': // 快组 (Fast)
      return Math.floor(0.8 * lv ** 3 * BASE_MULTIPLIER)

    case 'rare': // 较快组 (Medium Fast)
      return Math.floor(lv ** 3 * BASE_MULTIPLIER)

    case 'uncommon': // 较慢组 (Medium Slow)
      return Math.floor((1.2 * lv ** 3 - 15 * lv ** 2 + 100 * lv - 140) * BASE_MULTIPLIER)

    case 'common': // 慢组 (Slow)
      return Math.floor(1.3 * lv ** 3 * BASE_MULTIPLIER)
  }
}

/**
 * Calculate current level from total tokens (inverse of tokensForLevel)
 * Uses binary search since some formulas don't have simple inverse
 */
export function calculateLevel(rarity: Rarity, totalTokens: number): number {
  // Binary search for level (max level 100)
  let low = 1
  let high = 100

  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2)
    const requiredTokens = tokensForLevel(rarity, mid)

    if (requiredTokens <= totalTokens) {
      low = mid
    } else {
      high = mid - 1
    }
  }

  return low
}

/**
 * Calculate tokens remaining until next level
 */
export function tokensToNextLevel(rarity: Rarity, totalTokens: number): number {
  const currentLevel = calculateLevel(rarity, totalTokens)
  if (currentLevel >= 100) return 0 // Max level reached
  return tokensForLevel(rarity, currentLevel + 1) - totalTokens
}

/**
 * Calculate growth rate modifier from userId and rarity
 * Returns a small decimal (e.g., 0.02-0.08) that varies per pet
 * Higher rarity = faster growth
 */
function calculateGrowthRate(userId: string, rarity: Rarity): number {
  const rarityBase: Record<Rarity, number> = {
    common: 0.005, // 0.5% per level
    uncommon: 0.0075, // 0.75% per level
    rare: 0.01, // 1% per level
    epic: 0.015, // 1.5% per level
    legendary: 0.02, // 2% per level
  }

  // Add small variation based on userId (±20% variation)
  const rng = mulberry32(hashString(userId + 'growth'))
  const variation = 0.8 + rng() * 0.4 // 0.8 to 1.2

  return rarityBase[rarity] * variation
}

/**
 * Get stat multiplier for a given level
 */
export function getStatMultiplier(userId: string, rarity: Rarity, level: number): number {
  const growthRate = calculateGrowthRate(userId, rarity)
  // Level 1: 1.0×
  // Level 10 common: ~1.05×
  // Level 10 legendary: ~1.20×
  return 1 + level * growthRate
}

/**
 * Apply level boost to base stats
 */
export function applyLevelBoost(
  userId: string,
  rarity: Rarity,
  baseStats: Record<StatName, number>,
  level: number,
): Record<StatName, number> {
  const multiplier = getStatMultiplier(userId, rarity, level)
  const boostedStats = {} as Record<StatName, number>
  for (const [name, value] of Object.entries(baseStats)) {
    boostedStats[name as StatName] = Math.min(100, Math.floor(value * multiplier))
  }
  return boostedStats
}

// Regenerate bones from userId, merge with stored soul. Bones never persist
// so species renames and SPECIES-array edits can't break stored companions,
// and editing config.companion can't fake a rarity.
export function getCompanion(userId: string, stored: StoredCompanion | undefined): Companion | undefined {
  if (!stored) return undefined
  const { bones } = roll(userId)
  const totalTokens = stored.totalTokensUsed || 0
  const level = calculateLevel(bones.rarity, totalTokens)
  const boostedStats = applyLevelBoost(userId, bones.rarity, bones.stats, level)

  // Calculate max HP/MP
  const maxHP = calculateMaxHP(boostedStats.CON, level)
  const maxMP = calculateMaxMP(boostedStats.INT, level)

  // Apply regeneration to stored HP/MP
  const regenerated = applyRegeneration(stored, maxHP, maxMP)

  return {
    ...regenerated,
    ...bones,
    stats: boostedStats, // Override with leveled stats
    level,
    totalTokensUsed: totalTokens,
    tokensToNextLevel: tokensToNextLevel(bones.rarity, totalTokens),
    maxHP,
    maxMP,
    currentHP: regenerated.currentHP ?? maxHP,
    currentMP: regenerated.currentMP ?? maxMP,
  }
}
