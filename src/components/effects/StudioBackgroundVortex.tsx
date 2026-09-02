import { useEffect, useState } from 'react'
import Vortex from './OriginkitVortex'

function canUseBackgroundEffect() {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  if (window.matchMedia('(max-width: 1023px)').matches) return false
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
  return Boolean(gl)
}

export default function StudioBackgroundVortex() {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    const sync = () => setEnabled(canUseBackgroundEffect())
    sync()
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const desktop = window.matchMedia('(min-width: 1024px)')
    motion.addEventListener('change', sync)
    desktop.addEventListener('change', sync)
    return () => {
      motion.removeEventListener('change', sync)
      desktop.removeEventListener('change', sync)
    }
  }, [])

  if (!enabled) return null

  return (
    <div className="studio-vortex-layer" aria-hidden="true">
      <Vortex
        background="transparent"
        topRadius={260}
        waistRadius={42}
        waistPosition={58}
        bottomRadius={820}
        twist={2}
        zoom={78}
        speed={6}
        direction="right"
        dots
        comets
        repel={false}
        lineOptions={{ count: 72, color: '#93c5fd', glow: 4 }}
        dotOptions={{ count: 1400, size: 14, color: '#dbeafe', glow: 5, flicker: 6 }}
        cometOptions={{ count: 4, speed: 4, color: '#60a5fa', glow: 4, tail: 12, delay: 10, collide: 3 }}
      />
    </div>
  )
}
