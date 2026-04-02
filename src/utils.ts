/**
 * Format a progress bar with filled and empty blocks
 */
export function formatBar(current: number, max: number, width: number = 10): string {
  const filled = Math.floor((current / max) * width)
  const empty = width - filled
  return '█'.repeat(filled) + '░'.repeat(empty)
}

/**
 * Calculate base damage from Strength and level (before variance)
 */
export function calculateBaseDamage(str: number, level: number): number {
  return Math.floor(str / 5) + Math.floor(level / 10)
}
