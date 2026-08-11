import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from './store'
import { centerScene, nodeAt, neighbourhoodOf } from '../views/render/center-scene'
import { paintScene, PROLIVIS_STYLE, PROLIVIS_STYLE_DARK } from '../views/render/scene'
import type { LayoutNode } from '../views/center-layout'

/**
 * The center-layout canvas: pan, zoom, hover and selection.
 *
 * Canvas rather than SVG in the DOM. A whole-organism view is tens of thousands of
 * elements, and the browser will not keep that many DOM nodes interactive — but the
 * *same* scene serializes to SVG on export, so the figure a user saves is vector even
 * though the one they interact with is not.
 */
export function CenterView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const layout = useApp((s) => s.layout)
  const selectedNodeId = useApp((s) => s.selectedNodeId)
  const selectNode = useApp((s) => s.selectNode)
  const showPublicationLabels = useApp((s) => s.layoutSettings.showPublicationLabels)

  const [view, setView] = useState({ scale: 0.55, offsetX: 0, offsetY: 0 })
  const [hovered, setHovered] = useState<LayoutNode | null>(null)
  const [size, setSize] = useState({ width: 800, height: 600 })
  const dragRef = useRef<{
    x: number
    y: number
    offsetX: number
    offsetY: number
  } | null>(null)

  const dark =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches

  const scene = useMemo(() => {
    if (!layout) return null
    const highlight = selectedNodeId ? neighbourhoodOf(layout, selectedNodeId) : undefined
    return centerScene(layout, {
      style: dark ? PROLIVIS_STYLE_DARK : PROLIVIS_STYLE,
      labelPublicationsBelow: showPublicationLabels ? 60 : 0,
      ...(highlight ? { highlight } : {}),
    })
  }, [layout, selectedNodeId, showPublicationLabels, dark])

  // Fit the layout to the viewport whenever a new one arrives.
  useEffect(() => {
    if (!layout || size.width === 0) return
    const fit = Math.min(size.width, size.height) / (2 * layout.extent + 240)
    setView({
      scale: Number.isFinite(fit) && fit > 0 ? fit : 0.5,
      offsetX: 0,
      offsetY: 0,
    })
  }, [layout, size.width, size.height])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        })
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !scene) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = size.width * dpr
    canvas.height = size.height * dpr
    canvas.style.width = `${size.width}px`
    canvas.style.height = `${size.height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    paintScene(ctx, scene, { ...size, ...view })
  }, [scene, size, view])

  /** Screen coordinates to world coordinates. */
  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return {
        x: (clientX - rect.left - size.width / 2 - view.offsetX) / view.scale,
        y: (clientY - rect.top - size.height / 2 - view.offsetY) / view.scale,
      }
    },
    [size, view],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current
      if (drag) {
        setView((v) => ({
          ...v,
          offsetX: drag.offsetX + (event.clientX - drag.x),
          offsetY: drag.offsetY + (event.clientY - drag.y),
        }))
        return
      }
      if (!layout) return
      const world = toWorld(event.clientX, event.clientY)
      setHovered(nodeAt(layout, world.x, world.y))
    },
    [layout, toWorld],
  )

  const onWheel = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
    // Zoom about the cursor, so the thing under the pointer stays under it.
    const factor = Math.pow(2, -event.deltaY / 400)
    setView((v) => ({ ...v, scale: Math.min(8, Math.max(0.02, v.scale * factor)) }))
  }, [])

  return (
    <div className="canvas-wrap" ref={containerRef}>
      {!layout && (
        <div className="canvas-empty">
          <p>No dataset loaded.</p>
          <p className="hint">
            Drop a <code>BIOGRID-*.tab3.zip</code> file here, or use the panel on the
            left.
          </p>
        </div>
      )}

      <canvas
        hidden={!layout}
        ref={canvasRef}
        className="canvas"
        onPointerMove={onPointerMove}
        onPointerDown={(e) => {
          dragRef.current = {
            x: e.clientX,
            y: e.clientY,
            offsetX: view.offsetX,
            offsetY: view.offsetY,
          }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerUp={(e) => {
          const drag = dragRef.current
          dragRef.current = null
          e.currentTarget.releasePointerCapture(e.pointerId)
          if (!layout) return
          // A click, not a drag: select whatever is under the cursor.
          if (drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) {
            const world = toWorld(e.clientX, e.clientY)
            const node = nodeAt(layout, world.x, world.y)
            selectNode(node?.id ?? null)
          }
        }}
        onWheel={onWheel}
      />

      {hovered && <NodeTooltip node={hovered} />}

      {layout && (
        <>
          <div className="canvas-legend">
            <Swatch color={PROLIVIS_STYLE.organism} label="Organism" />
            <Swatch color={PROLIVIS_STYLE.system} label="Method" />
            <Swatch color={PROLIVIS_STYLE.systemGenetic} label="Genetic method" />
            <Swatch color={PROLIVIS_STYLE.publication} label="Publication" />
            <span className="legend-note">Node area ∝ interactions contributed</span>
          </div>

          <div className="canvas-controls">
            <button onClick={() => setView((v) => ({ ...v, scale: v.scale * 1.3 }))}>
              +
            </button>
            <button onClick={() => setView((v) => ({ ...v, scale: v.scale / 1.3 }))}>
              −
            </button>
            <button
              onClick={() => {
                const fit = Math.min(size.width, size.height) / (2 * layout.extent + 240)
                setView({ scale: fit, offsetX: 0, offsetY: 0 })
              }}
            >
              Fit
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="swatch">
      <i style={{ background: color }} />
      {label}
    </span>
  )
}

function NodeTooltip({ node }: { node: LayoutNode }) {
  return (
    <div className="tooltip" role="status">
      <strong>{node.label}</strong>
      <div className="tooltip-rows">
        {node.kind === 'publication' && node.year !== null && node.year !== undefined && (
          <span>Year {node.year}</span>
        )}
        <span>{node.interactionCount.toLocaleString()} interactions</span>
        {node.publicationCount !== undefined && (
          <span>{node.publicationCount.toLocaleString()} publications</span>
        )}
        {node.systems && node.systems.length > 0 && (
          <span>Methods: {node.systems.join(', ')}</span>
        )}
        {node.aggregated && <span>Folded: {node.aggregated.join(', ')}</span>}
      </div>
    </div>
  )
}
