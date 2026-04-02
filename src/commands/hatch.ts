import type { OpenClawPluginApi } from 'openclaw/plugin-sdk'
import { roll, type Roll } from '../companion.js'
import { renderSprite, renderFace } from '../sprites.js'
import { RARITY_STARS } from '../types.js'
import type { StoredCompanion } from '../types.js'
import { getMachineId } from '../machine-id.js'
import { loadCompanion, saveCompanion } from '../storage.js'

// Simple name generator based on species and traits
function generateName(roll: Roll): string {
  const { species, rarity } = roll.bones
  const prefixes = ['Buddy', 'Friend', 'Pal', 'Chum', 'Mate', 'Sidekick']
  const rarityPrefixes: Record<string, string[]> = {
    legendary: ['Lord', 'Lady', 'Sir', 'Master', 'Supreme'],
    epic: ['Captain', 'Major', 'Chief', 'Commander'],
    rare: ['Noble', 'Brave', 'Wise', 'Swift'],
    uncommon: ['Lucky', 'Happy', 'Clever', 'Quick'],
    common: prefixes,
  }

  const namePool = rarityPrefixes[rarity] || prefixes
  const prefix = namePool[roll.inspirationSeed % namePool.length]
  const suffix = species.charAt(0).toUpperCase() + species.slice(1)

  return `${prefix} ${suffix}`
}

// Simple personality generator based on stats
function generatePersonality(roll: Roll): string {
  const { stats, species, rarity } = roll.bones
  const highestStat = Object.entries(stats).reduce((a, b) => (a[1] > b[1] ? a : b))[0]
  const lowestStat = Object.entries(stats).reduce((a, b) => (a[1] < b[1] ? a : b))[0]

  const traitDescriptions: Record<string, string> = {
    DEBUGGING: 'analytical and detail-oriented',
    PATIENCE: 'calm and steady',
    CHAOS: 'unpredictable and spontaneous',
    WISDOM: 'thoughtful and insightful',
    SNARK: 'witty and sarcastic',
  }

  return `A ${rarity} ${species} who is ${traitDescriptions[highestStat]} but struggles with ${traitDescriptions[lowestStat]?.replace('and ', 'being ')}.`
}

export function createHatchCommand(api: OpenClawPluginApi): { text: string } {
  // Get user ID from machine ID - ensures uniqueness per machine
  const userId = getMachineId()

  // Check if companion already exists
  const existingCompanion = loadCompanion(userId)
  if (existingCompanion) {
    return {
      text: `You already have a companion! Use /pet to see them.`,
    }
  }

  // Generate companion
  const rolled = roll(userId)
  const name = generateName(rolled)
  const personality = generatePersonality(rolled)

  // Create stored companion
  const companion: StoredCompanion = {
    name,
    personality,
    hatchedAt: Date.now(),
    totalTokensUsed: 0, // Start at level 0
  }

  // Save to file
  saveCompanion(userId, companion)

  // Display the hatched companion with full details
  const sprite = renderSprite(rolled.bones, 0)
  const face = renderFace(rolled.bones)
  const rarityStars = RARITY_STARS[rolled.bones.rarity]

  // Format stats
  const statsDisplay = Object.entries(rolled.bones.stats)
    .map(([name, value]) => {
      const bar = '█'.repeat(Math.floor(value / 10)) + '░'.repeat(10 - Math.floor(value / 10))
      return `${name}: ${bar} ${value}`
    })
    .join('\n')

  return {
    text: `🥚 Your companion has hatched!

\`\`\`
${sprite.join('\n')}
\`\`\`

${face} ${name}
${rarityStars} ${rolled.bones.rarity.toUpperCase()} ${rolled.bones.species.toUpperCase()}${rolled.bones.shiny ? ' ✨ SHINY' : ''}

${personality}

Age: just hatched!
Eye: ${rolled.bones.eye}  Hat: ${rolled.bones.hat}

Stats:
${statsDisplay}`,
  }
}
