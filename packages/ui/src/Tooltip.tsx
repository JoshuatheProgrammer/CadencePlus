/**
 * App-wide styled tooltips. Any element with a `title` gets a themed tooltip
 * after a short hover delay; the native OS tooltip is suppressed by moving the
 * text to `data-tip` while hovered.
 */
import { useEffect, useState } from 'react'

const DELAY = 450

export function TooltipHost() {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  useEffect(() => {
    let timer = 0
    let current: HTMLElement | null = null
    const restore = () => {
      if (current?.dataset.tip !== undefined && !current.hasAttribute('title')) current.setAttribute('title', current.dataset.tip)
      if (current) delete current.dataset.tip
      current = null
    }
    const hide = () => {
      clearTimeout(timer)
      setTip(null)
      restore()
    }
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[title]') as HTMLElement | null
      if (el === current) return
      hide()
      if (!el) return
      const text = el.getAttribute('title')
      if (!text) return
      current = el
      el.dataset.tip = text
      el.removeAttribute('title')
      const x = e.clientX
      const y = e.clientY
      timer = window.setTimeout(() => setTip({ x, y, text }), DELAY)
    }
    const move = (e: MouseEvent) => {
      if (!current) return
      setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t))
    }
    window.addEventListener('mouseover', over, true)
    window.addEventListener('mousemove', move, true)
    window.addEventListener('mousedown', hide, true)
    window.addEventListener('wheel', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      hide()
      window.removeEventListener('mouseover', over, true)
      window.removeEventListener('mousemove', move, true)
      window.removeEventListener('mousedown', hide, true)
      window.removeEventListener('wheel', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])
  if (!tip) return null
  // Keep on screen: flip left/up near edges
  const left = tip.x + 14 + 360 > window.innerWidth ? Math.max(4, tip.x - 370) : tip.x + 14
  const top = tip.y + 20 + 60 > window.innerHeight ? tip.y - 40 : tip.y + 20
  return (
    <div className="tooltip" style={{ left, top }}>
      {tip.text}
    </div>
  )
}
