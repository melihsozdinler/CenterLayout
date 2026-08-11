import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from './store'
import {
  matrixScene,
  networkNeighbourhood,
  networkNodeAt,
  networkScene,
} from '../views/render/network-scene'
import { paintScene, PROLIVIS_STYLE, PROLIVIS_STYLE_DARK } from '../views/render/scene'
import type { NetworkNode } from '../views/network-layout'

/**
 * The protein–protein network and the adjacency matrix.
 *
 * Shares the pan/zoom/select behaviour of the center view and, more importantly, the
 * same scene abstraction — so what is exported as SVG is the same picture that is on
 * screen, not a re-derivation of it.
 */
export function NetworkView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const view = useApp((s) => s.view)
  const network = useApp((s) => s.network)
  const matrix = useApp((s) => s.matrix)
  const colourBy = useApp((s) => s.networkSettings.colourBy)
  const selected = useApp((s) => s.selectedNodeIndex)
  const selectNode = useApp((s) => s.selectNetworkNode)

  const [viewport, setViewport] = useState({ scale: 0.6, offsetX: 0, offsetY: 0 })
  const [hovered, setHovered] = useState<NetworkNode | null>(null)
  const [size, setSize] = useState({ width: 800, height: 600 })
  const dragRef = useRef<{
    x: number
    y: number
    offsetX: number
    offsetY: number
  } | null>(null)

  const dark =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
  const style = dark ? PROLIVIS_STYLE_DARK : PROLIVIS_STYLE

  const scene = useMemo(() => {
    if (view === 'matrix' && matrix) return matrixScene(matrix, { style })
    if (view === 'network' && network) {
      const highlight =
        selected === null ? undefined : networkNeighbourhood(network, selected)
      return networkScene(network, {
        style,
        colourBy,
        ...(highlight ? { highlight } : {}),
      })
    }
    return null
  }, [view, network, matrix, colourBy, selected, style])

  // Fit whenever a new scene arrives.
  useEffect(() => {
    if (!scene || size.width === 0) return
    const [minX, minY, maxX, maxY] = scene.bounds
    const fit = Math.min(size.width / (maxX - minX), size.height / (maxY - minY))
    setViewport({
      scale: Number.isFinite(fit) && fit > 0 ? fit * 0.92 : 0.5,
      // Matrix coordinates start at the origin rather than being centred on it.
      offsetX: -(((minX + maxX) / 2) * (fit * 0.92)),
      offsetY: -(((minY + maxY) / 2) * (fit * 0.92)),
    })
  }, [scene, size.width, size.height])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
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
    paintScene(ctx, scene, { ...size, ...viewport })
  }, [scene, size, viewport])

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return {
        x: (clientX - rect.left - size.width / 2 - viewport.offsetX) / viewport.scale,
        y: (clientY - rect.top - size.height / 2 - viewport.offsetY) / viewport.scale,
      }
    },
    [size, viewport],
  )

  const empty = (view === 'network' && !network) || (view === 'matrix' && !matrix)

  // A spring embedding stops conveying structure well before it stops running. Say so
  // rather than presenting a blob as a result.
  const tooLargeForForce =
    view === 'network' && network?.mode === 'force' && network.nodes.length > 1500

  return (
    <div className="canvas-wrap" ref={containerRef}>
      {empty && (
        <div className="canvas-empty">
          <p>Nothing to show at this trust threshold.</p>
          <p className="hint">Lower it in the panel on the left.</p>
        </div>
      )}

      <canvas
        hidden={empty}
        ref={canvasRef}
        className="canvas"
        onPointerMove={(e) => {
          const drag = dragRef.current
          if (drag) {
            setViewport((v) => ({
              ...v,
              offsetX: drag.offsetX + (e.clientX - drag.x),
              offsetY: drag.offsetY + (e.clientY - drag.y),
            }))
            return
          }
          if (view !== 'network' || !network) return
          const world = toWorld(e.clientX, e.clientY)
          setHovered(networkNodeAt(network, world.x, world.y))
        }}
        onPointerDown={(e) => {
          dragRef.current = {
            x: e.clientX,
            y: e.clientY,
            offsetX: viewport.offsetX,
            offsetY: viewport.offsetY,
          }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerUp={(e) => {
          const drag = dragRef.current
          dragRef.current = null
          e.currentTarget.releasePointerCapture(e.pointerId)
          if (view !== 'network' || !network || !drag) return
          if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) >= 4) return
          const world = toWorld(e.clientX, e.clientY)
          const node = networkNodeAt(network, world.x, world.y)
          selectNode(node?.index ?? null)
        }}
        onWheel={(e) => {
          const factor = Math.pow(2, -e.deltaY / 400)
          setViewport((v) => ({
            ...v,
            scale: Math.min(20, Math.max(0.01, v.scale * factor)),
          }))
        }}
      />

      {tooLargeForForce && (
        <div className="canvas-notice">
          <strong>
            {network!.nodes.length.toLocaleString()} proteins is too many for a force
            layout to say anything.
          </strong>
          <span>
            Raise the trust threshold, switch the arrangement to “Modules on a ring”, or
            use the Matrix view.
          </span>
        </div>
      )}

      {hovered && (
        <div className="tooltip" role="status">
          <strong>{hovered.label}</strong>
          <div className="tooltip-rows">
            <span>{hovered.degree} interaction partners</span>
            <span>BioGRID gene {hovered.id}</span>
          </div>
        </div>
      )}

      {!empty && (
        <div className="canvas-controls">
          <button onClick={() => setViewport((v) => ({ ...v, scale: v.scale * 1.3 }))}>
            +
          </button>
          <button onClick={() => setViewport((v) => ({ ...v, scale: v.scale / 1.3 }))}>
            −
          </button>
        </div>
      )}
    </div>
  )
}
