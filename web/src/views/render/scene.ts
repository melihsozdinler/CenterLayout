/**
 * A drawing-surface-independent scene.
 *
 * The same scene is painted to a canvas for interaction and serialized to SVG for
 * publication. That is not tidiness for its own sake: a figure exported from a
 * screenshot is a raster of whatever the browser happened to render, while a figure
 * built from the same scene as the screen is vector, editable, and provably the same
 * picture the user was looking at.
 */

export interface SceneStyle {
  readonly organism: string
  readonly system: string
  readonly systemGenetic: string
  readonly aggregate: string
  readonly publication: string
  readonly edge: string
  readonly edgeHighlight: string
  readonly text: string
  readonly textMuted: string
  readonly background: string
}

/** Palette inherited from ProLiVis 1.0, so published figures stay recognizable. */
export const PROLIVIS_STYLE: SceneStyle = {
  organism: '#d8453c',
  system: '#3b4fd8',
  systemGenetic: '#7a52c9',
  aggregate: '#8b93a5',
  publication: '#f2d64b',
  edge: 'rgba(216, 69, 60, 0.28)',
  edgeHighlight: 'rgba(216, 69, 60, 0.9)',
  text: '#1c2024',
  textMuted: '#666e78',
  background: '#ffffff',
}

export const PROLIVIS_STYLE_DARK: SceneStyle = {
  ...PROLIVIS_STYLE,
  edge: 'rgba(240, 120, 110, 0.3)',
  edgeHighlight: 'rgba(255, 150, 140, 0.95)',
  text: '#e8eaed',
  textMuted: '#9aa3ad',
  background: '#14171a',
}

export interface SceneCircle {
  readonly kind: 'circle'
  readonly id: string
  readonly x: number
  readonly y: number
  readonly radius: number
  readonly fill: string
  readonly stroke?: string
  readonly strokeWidth?: number
  readonly opacity?: number
}

export interface SceneLine {
  readonly kind: 'line'
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
  readonly stroke: string
  readonly width: number
}

export interface SceneText {
  readonly kind: 'text'
  readonly x: number
  readonly y: number
  readonly text: string
  readonly fill: string
  readonly fontSize: number
  readonly anchor: 'start' | 'middle' | 'end'
  /** Rotation about (x, y), in radians. Used for labels that follow a sector. */
  readonly rotate?: number
  readonly weight?: number
}

export type SceneItem = SceneCircle | SceneLine | SceneText

export interface Scene {
  /** World-space bounds: [minX, minY, maxX, maxY]. */
  readonly bounds: readonly [number, number, number, number]
  /** Drawn in order: lines first, then nodes, then labels. */
  readonly items: readonly SceneItem[]
  readonly background: string
}

/** Paint a scene onto a 2D canvas context, fitted to the given viewport. */
export function paintScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  viewport: { width: number; height: number; scale: number; offsetX: number; offsetY: number },
): void {
  const { width, height, scale, offsetX, offsetY } = viewport

  ctx.save()
  ctx.fillStyle = scene.background
  ctx.fillRect(0, 0, width, height)

  ctx.translate(width / 2 + offsetX, height / 2 + offsetY)
  ctx.scale(scale, scale)

  for (const item of scene.items) {
    if (item.kind === 'line') {
      ctx.beginPath()
      ctx.moveTo(item.x1, item.y1)
      ctx.lineTo(item.x2, item.y2)
      ctx.strokeStyle = item.stroke
      // Keep hairlines hairlines at any zoom, or edges become slabs when zoomed in.
      ctx.lineWidth = item.width / scale
      ctx.stroke()
    } else if (item.kind === 'circle') {
      ctx.beginPath()
      ctx.arc(item.x, item.y, item.radius, 0, Math.PI * 2)
      ctx.globalAlpha = item.opacity ?? 1
      ctx.fillStyle = item.fill
      ctx.fill()
      if (item.stroke) {
        ctx.strokeStyle = item.stroke
        ctx.lineWidth = (item.strokeWidth ?? 1) / scale
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    } else {
      ctx.save()
      ctx.translate(item.x, item.y)
      if (item.rotate) ctx.rotate(item.rotate)
      ctx.fillStyle = item.fill
      ctx.font = `${item.weight ?? 400} ${item.fontSize}px system-ui, sans-serif`
      ctx.textAlign = item.anchor === 'middle' ? 'center' : item.anchor
      ctx.textBaseline = 'middle'
      ctx.fillText(item.text, 0, 0)
      ctx.restore()
    }
  }

  ctx.restore()
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/**
 * Serialize a scene to standalone SVG.
 *
 * The output opens in Illustrator or Inkscape with every node and label a separate
 * editable object, which is what a journal figure actually needs.
 */
export function sceneToSvg(scene: Scene, title = 'ProLiVis figure'): string {
  const [minX, minY, maxX, maxY] = scene.bounds
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" ` +
      `width="${Math.round(width)}" height="${Math.round(height)}">`,
    `<title>${escapeXml(title)}</title>`,
    `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${scene.background}"/>`,
  ]

  for (const item of scene.items) {
    if (item.kind === 'line') {
      parts.push(
        `<line x1="${round(item.x1)}" y1="${round(item.y1)}" x2="${round(item.x2)}" ` +
          `y2="${round(item.y2)}" stroke="${item.stroke}" stroke-width="${item.width}"/>`,
      )
    } else if (item.kind === 'circle') {
      const stroke = item.stroke
        ? ` stroke="${item.stroke}" stroke-width="${item.strokeWidth ?? 1}"`
        : ''
      const opacity = item.opacity !== undefined ? ` opacity="${item.opacity}"` : ''
      parts.push(
        `<circle cx="${round(item.x)}" cy="${round(item.y)}" r="${round(item.radius)}" ` +
          `fill="${item.fill}"${stroke}${opacity}/>`,
      )
    } else {
      const transform = item.rotate
        ? ` transform="rotate(${round((item.rotate * 180) / Math.PI)} ${round(item.x)} ${round(item.y)})"`
        : ''
      const weight = item.weight ? ` font-weight="${item.weight}"` : ''
      parts.push(
        `<text x="${round(item.x)}" y="${round(item.y)}" fill="${item.fill}" ` +
          `font-size="${item.fontSize}" font-family="system-ui, sans-serif" ` +
          `text-anchor="${item.anchor}" dominant-baseline="central"${weight}${transform}>` +
          `${escapeXml(item.text)}</text>`,
      )
    }
  }

  parts.push('</svg>')
  return parts.join('\n')
}

/** Three decimals is well below a pixel and keeps exported files small. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
