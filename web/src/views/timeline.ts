
/** ASCII unit separator: it cannot occur in a method name, so keys are exact. */
const SEP = String.fromCharCode(0x1f)
/**
 * The literature timeline, and the chord view of how methods co-occur.
 *
 * The timeline asks a question no other view here can: *when* did we come to believe
 * this? An interaction reported once in 1998 and never revisited looks identical to a
 * well-replicated one in every static view of BioGRID, and is not the same claim.
 */

export interface TimelinePoint {
  readonly year: number
  /** Interactions first reported in this year. */
  readonly newInteractions: number
  /** Interactions reported at all in this year. */
  readonly reportedInteractions: number
  /** Publications in this year. */
  readonly publications: number
  /** Cumulative distinct interactions up to and including this year. */
  readonly cumulativeInteractions: number
  /** Share of this year's records from low-throughput work. */
  readonly lowThroughputShare: number | null
}

export interface MethodTrend {
  readonly system: string
  /** Interactions reported per year, aligned to `years`. */
  readonly byYear: readonly number[]
  readonly total: number
}

export interface TimelineView {
  readonly years: readonly number[]
  readonly points: readonly TimelinePoint[]
  /** Per-method trends, most used first. */
  readonly methods: readonly MethodTrend[]
  /**
   * Interactions whose only support is older than `staleBefore` — reported once,
   * long ago, and never revisited.
   */
  readonly staleSingletons: readonly {
    readonly pairKey: string
    readonly label: string
    readonly year: number
  }[]
}

export interface TimelineRecord {
  readonly pairKey: string
  readonly label: string
  readonly year: number | null
  readonly publicationKey: string
  readonly system: string
  readonly lowThroughput: boolean
  readonly highThroughput: boolean
}

export interface TimelineOptions {
  /** A sole report before this year counts as stale. Defaults to 25 years back. */
  readonly staleBefore?: number
  readonly referenceYear?: number
  readonly maxMethods?: number
  readonly maxStale?: number
}

export function buildTimeline(
  records: readonly TimelineRecord[],
  options: TimelineOptions = {},
): TimelineView {
  const referenceYear = options.referenceYear ?? new Date().getUTCFullYear()
  const staleBefore = options.staleBefore ?? referenceYear - 25
  const maxMethods = options.maxMethods ?? 10
  const maxStale = options.maxStale ?? 100

  const dated = records.filter(
    (r): r is TimelineRecord & { year: number } => r.year !== null,
  )
  if (dated.length === 0) {
    return { years: [], points: [], methods: [], staleSingletons: [] }
  }

  const minYear = Math.min(...dated.map((r) => r.year))
  const maxYear = Math.max(...dated.map((r) => r.year))
  // A continuous axis, including years with nothing in them: gaps in the literature
  // are information, and a categorical axis would hide them.
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i)
  const yearIndex = new Map(years.map((y, i) => [y, i]))

  const firstSeen = new Map<string, number>()
  const yearsOf = new Map<string, Set<number>>()
  const labelOf = new Map<string, string>()

  for (const record of dated) {
    const existing = firstSeen.get(record.pairKey)
    if (existing === undefined || record.year < existing) {
      firstSeen.set(record.pairKey, record.year)
    }
    const set = yearsOf.get(record.pairKey)
    if (set) set.add(record.year)
    else yearsOf.set(record.pairKey, new Set([record.year]))
    labelOf.set(record.pairKey, record.label)
  }

  const newByYear = new Array<number>(years.length).fill(0)
  for (const year of firstSeen.values()) {
    const index = yearIndex.get(year)
    if (index !== undefined) newByYear[index] = newByYear[index]! + 1
  }

  const reportedPairs = years.map(() => new Set<string>())
  const publicationsByYear = years.map(() => new Set<string>())
  const lowByYear = new Array<number>(years.length).fill(0)
  const highByYear = new Array<number>(years.length).fill(0)

  for (const record of dated) {
    const index = yearIndex.get(record.year)
    if (index === undefined) continue
    reportedPairs[index]!.add(record.pairKey)
    publicationsByYear[index]!.add(record.publicationKey)
    if (record.lowThroughput) lowByYear[index] = lowByYear[index]! + 1
    if (record.highThroughput) highByYear[index] = highByYear[index]! + 1
  }

  let cumulative = 0
  const points: TimelinePoint[] = years.map((year, index) => {
    cumulative += newByYear[index]!
    const throughputTotal = lowByYear[index]! + highByYear[index]!
    return {
      year,
      newInteractions: newByYear[index]!,
      reportedInteractions: reportedPairs[index]!.size,
      publications: publicationsByYear[index]!.size,
      cumulativeInteractions: cumulative,
      lowThroughputShare:
        throughputTotal === 0 ? null : lowByYear[index]! / throughputTotal,
    }
  })

  // Per-method trends.
  const byMethod = new Map<string, number[]>()
  for (const record of dated) {
    const index = yearIndex.get(record.year)
    if (index === undefined) continue
    let series = byMethod.get(record.system)
    if (!series) {
      series = new Array<number>(years.length).fill(0)
      byMethod.set(record.system, series)
    }
    series[index] = series[index]! + 1
  }

  const methods: MethodTrend[] = [...byMethod.entries()]
    .map(([system, byYear]) => ({
      system,
      byYear,
      total: byYear.reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => b.total - a.total || (a.system < b.system ? -1 : 1))
    .slice(0, maxMethods)

  // Interactions reported in exactly one year, and that year long ago.
  const staleSingletons = [...yearsOf.entries()]
    .filter(([, set]) => set.size === 1)
    .map(([pairKey, set]) => ({
      pairKey,
      label: labelOf.get(pairKey) ?? pairKey,
      year: [...set][0]!,
    }))
    .filter((entry) => entry.year < staleBefore)
    .sort((a, b) => a.year - b.year || (a.pairKey < b.pairKey ? -1 : 1))
    .slice(0, maxStale)

  return { years, points, methods, staleSingletons }
}

// --- chord ------------------------------------------------------------------

export interface ChordView {
  /** Groups around the circle, in display order. */
  readonly groups: readonly {
    readonly name: string
    readonly total: number
    readonly startAngle: number
    readonly endAngle: number
  }[]
  /** Ribbons between groups. */
  readonly chords: readonly {
    readonly source: string
    readonly target: string
    readonly value: number
  }[]
}

/**
 * How often two experimental methods support the same interaction.
 *
 * Directly relevant to the trust model: methods that rarely co-occur are the ones
 * whose agreement is most informative, because the two assays are being applied by
 * different communities for different reasons.
 */
export function buildMethodChord(
  pairs: readonly { readonly systems: readonly string[] }[],
  options: { maxGroups?: number } = {},
): ChordView {
  const maxGroups = options.maxGroups ?? 15

  const totals = new Map<string, number>()
  const coOccurrence = new Map<string, number>()

  for (const pair of pairs) {
    const systems = [...new Set(pair.systems)].sort((a, b) => (a < b ? -1 : 1))
    for (const system of systems) totals.set(system, (totals.get(system) ?? 0) + 1)

    for (let i = 0; i < systems.length; i += 1) {
      for (let j = i + 1; j < systems.length; j += 1) {
        const key = `${systems[i]}${SEP}${systems[j]}`
        coOccurrence.set(key, (coOccurrence.get(key) ?? 0) + 1)
      }
    }
  }

  const kept = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, maxGroups)
  const keptNames = new Set(kept.map(([name]) => name))

  const grandTotal = kept.reduce((sum, [, total]) => sum + total, 0)
  const padding = 0.02
  const usable = Math.PI * 2 - padding * kept.length

  let cursor = 0
  const groups = kept.map(([name, total]) => {
    const width = grandTotal === 0 ? usable / kept.length : (total / grandTotal) * usable
    const group = { name, total, startAngle: cursor, endAngle: cursor + width }
    cursor += width + padding
    return group
  })

  const chords = [...coOccurrence.entries()]
    .map(([key, value]) => {
      const [source, target] = key.split(SEP) as [string, string]
      return { source, target, value }
    })
    .filter((c) => keptNames.has(c.source) && keptNames.has(c.target))
    .sort((a, b) => b.value - a.value)

  return { groups, chords }
}
