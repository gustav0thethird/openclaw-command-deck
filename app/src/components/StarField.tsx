'use client'
import { useEffect, useRef } from 'react'

export default function StarField() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const count = 180
    const stars: HTMLDivElement[] = []

    for (let i = 0; i < count; i++) {
      const star = document.createElement('div')
      star.className = 'star'
      const size = Math.random() < 0.8 ? 1 : Math.random() < 0.7 ? 2 : 3
      const dur = 2 + Math.random() * 4
      const delay = -(Math.random() * dur)
      const minOp = 0.1 + Math.random() * 0.2
      const maxOp = 0.6 + Math.random() * 0.4

      star.style.cssText = `
        width: ${size}px;
        height: ${size}px;
        top: ${Math.random() * 100}%;
        left: ${Math.random() * 100}%;
        --dur: ${dur}s;
        --delay: ${delay}s;
        --min-op: ${minOp};
        --max-op: ${maxOp};
      `
      container.appendChild(star)
      stars.push(star)
    }

    // Occasional shooting star
    const shootInterval = setInterval(() => {
      const shoot = document.createElement('div')
      shoot.style.cssText = `
        position: absolute;
        top: ${Math.random() * 60}%;
        left: ${Math.random() * 80}%;
        width: 60px;
        height: 1px;
        background: linear-gradient(90deg, rgba(255,255,255,0.8), transparent);
        transform: rotate(${-20 + Math.random() * -20}deg);
        animation: shoot 0.6s ease-out forwards;
      `
      container.appendChild(shoot)
      setTimeout(() => shoot.remove(), 700)
    }, 4000 + Math.random() * 6000)

    return () => {
      clearInterval(shootInterval)
      stars.forEach(s => s.remove())
    }
  }, [])

  return (
    <>
      <style>{`
        @keyframes shoot {
          0% { opacity: 1; transform: translateX(0) rotate(-30deg); }
          100% { opacity: 0; transform: translateX(80px) rotate(-30deg); }
        }
      `}</style>
      <div ref={containerRef} className="starfield" />
    </>
  )
}
