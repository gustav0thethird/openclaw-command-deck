'use client'
import React, { useState, useEffect, useRef, useCallback } from 'react'

// Works on HTTP (non-secure) contexts unlike uid()
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 9) }

// ─── Types ────────────────────────────────────────────────────
export interface Task {
  id: string; title: string; description: string
  status: 'backlog' | 'active' | 'done' | 'failed' | 'blocked' | 'reviewing'
  priority: 'low' | 'medium' | 'high' | 'critical'
  mode: string; agent_id: string; result?: string; error?: string
  due_date?: string; tags?: string; created_at: number; updated_at: number
  session_id?: string; model?: string; attempt?: number; step_count?: number; current_tool?: string; epic_id?: string
  confidence?: number | null; blocked_reason?: string | null; success_criteria?: string | null; critique?: string | null
}
export interface Agent {
  id: string; name: string; openclaw_id: string; room: string
  model_primary: string; model_fallbacks: string; status: string
  soul: string; github_url?: string; created_at?: number; type?: string
}
export interface Schedule {
  id: string; name: string; task_title: string; task_description: string
  agent_id: string | null; interval_minutes: number; enabled: number; last_run: number | null; created_at: number
}
export interface ActivityEntry {
  id: string; type: string; actor: string; summary: string
  task_id?: string; agent_id?: string; details?: string; created_at: number
}

// ─── Config ───────────────────────────────────────────────────
const DEPT_COLORS: Record<string, string> = {
  COMMAND: '#00cfff', INFRA: '#3b82f6', RESEARCH: '#8b5cf6',
  FACTORY: '#f59e0b', MEDIA: '#ec4899', COMMS: '#06b6d4',
  STRATEGY: '#ef4444', ARCHIVE: '#6366f1', TREASURY: '#10b981',
}

const ROOMS = [
  { id: 'radar',    name: 'Radar Bay',    dept: 'INFRA',    icon: '📡', roomField: 'research',    color: '#3b82f6', image: '/rooms/radar.jpg' },
  { id: 'media',    name: 'Media Bay',    dept: 'MEDIA',    icon: '📺', roomField: 'media',       color: '#ec4899', image: '/rooms/media.jpg' },
  { id: 'comm',     name: 'Comm Hub',     dept: 'COMMS',    icon: '📻', roomField: 'comms',       color: '#06b6d4', image: '/rooms/comm.jpg' },
  { id: 'factory',  name: 'Factory',      dept: 'FACTORY',  icon: '⚙️',  roomField: 'engineering', color: '#f59e0b', image: '/rooms/factory.jpg' },
  { id: 'factory2', name: 'Factory Deck', dept: 'FACTORY',  icon: '🏭', roomField: 'factory',     color: '#f59e0b', image: '/rooms/factory2.jpg' },
  { id: 'war',      name: 'War Room',     dept: 'STRATEGY', icon: '⚔️',  roomField: 'operations',  color: '#ef4444', image: '/rooms/war.jpg' },
  { id: 'treasury', name: 'The Treasury', dept: 'TREASURY', icon: '💰', roomField: 'treasury',    color: '#10b981', image: '/rooms/treasury.jpg' },
  { id: 'armory',   name: 'Armory',       dept: 'ARCHIVE',  icon: '🗄️',  roomField: 'archive',     color: '#6366f1', image: '/rooms/armory.jpg' },
  { id: 'command',  name: 'Control Room', dept: 'COMMAND',  icon: '🎛️',  roomField: 'command',     color: '#00cfff', image: '/rooms/command.jpg' },
]

type Room = typeof ROOMS[number]
type CenterTab = 'station' | 'agents' | 'tasks' | 'epics' | 'comms' | 'files' | 'skills' | 'settings'

interface Epic {
  id: string; title: string; description: string; status: string; priority: string
  agent_id: string | null; created_at: number; task_total: number; task_done: number; task_active: number
}

interface SentinelAlert {
  id: string; type: string; severity: 'info' | 'warning' | 'critical'; summary: string; details?: string; created_at: number
}
type RightPanel = 'room' | 'agent' | 'task' | null

interface AriaChatMsg {
  id: string
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'approval'
  content: string
  tool?: string
  approvalId?: string
  approvalTool?: string
  approvalPreview?: string
  approved?: boolean | null
}
interface WorkspaceFile { name: string; path: string; size: number; modified: number }

const statusColor = (s: string) => s === 'busy' ? '#22c55e' : s === 'idle' ? '#eab308' : '#ef4444'
const taskStatusColor = (s: string) => ({ backlog: '#4a6a8a', active: '#22c55e', done: '#00cfff', failed: '#ef4444', blocked: '#f59e0b', reviewing: '#8b5cf6' }[s] ?? '#4a6a8a')
const agentTypeColor = (t: string) => ({ general: '#4a6a8a', research: '#8b5cf6', build: '#f59e0b', ui: '#ec4899', critic: '#22c55e' }[t] ?? '#4a6a8a')
const confidenceBadge = (c: number) => ({ color: c >= 0.8 ? '#22c55e' : c >= 0.6 ? '#f59e0b' : '#ef4444', label: `${Math.round(c * 100)}%` })
const priorityColor = (p: string) => ({ low: '#4a6a8a', medium: '#eab308', high: '#f97316', critical: '#ef4444' }[p] ?? '#4a6a8a')

function agentColor(a: Agent) {
  const room = ROOMS.find(r => r.roomField === a.room || r.id === a.room)
  return room?.color ?? '#00cfff'
}
function agentDept(a: Agent) {
  const room = ROOMS.find(r => r.roomField === a.room || r.id === a.room)
  return room?.dept ?? 'INFRA'
}

// ─── Main ─────────────────────────────────────────────────────
interface Props {
  initialTasks: Task[]
  initialAgents: Agent[]
  initialActivity: ActivityEntry[]
}

function useWindowWidth() {
  const [w, setW] = useState(1200)
  useEffect(() => {
    setW(window.innerWidth)
    const h = () => setW(window.innerWidth)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  return w
}

// ─── Markdown renderer ────────────────────────────────────────
function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g)
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**'))
      return <strong key={i} style={{ color: '#e2e8f0', fontWeight: 700 }}>{p.slice(2, -2)}</strong>
    if (p.startsWith('`') && p.endsWith('`') && p.length > 2)
      return <code key={i} style={{ background: 'rgba(0,207,255,0.12)', padding: '1px 5px', borderRadius: 3, fontFamily: 'Share Tech Mono,monospace', fontSize: 10, color: '#94a3b8' }}>{p.slice(1, -1)}</code>
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2)
      return <em key={i} style={{ color: '#cbd5e1' }}>{p.slice(1, -1)}</em>
    return <React.Fragment key={i}>{p}</React.Fragment>
  })
}

function renderMarkdown(text: string): React.ReactNode {
  // Split on fenced code blocks first
  const segments = text.split(/(```[\w-]*\n[\s\S]*?```|```[\s\S]*?```)/g)
  const nodes: React.ReactNode[] = []

  segments.forEach((seg, si) => {
    if (seg.startsWith('```')) {
      const firstNl = seg.indexOf('\n')
      const lang = firstNl > 3 ? seg.slice(3, firstNl).trim() : ''
      const code = seg.slice(firstNl > 3 ? firstNl + 1 : 3, -3).trimEnd()
      nodes.push(
        <div key={`cb-${si}`} style={{ margin: '6px 0', borderRadius: 5, overflow: 'hidden', border: '1px solid rgba(0,207,255,0.15)' }}>
          {lang && <div style={{ padding: '2px 10px', background: 'rgba(0,207,255,0.08)', fontFamily: 'Orbitron,sans-serif', fontSize: 8, color: '#4a6a8a', letterSpacing: 1 }}>{lang}</div>}
          <pre style={{ margin: 0, padding: '8px 10px', background: 'rgba(0,0,0,0.5)', fontSize: 10, color: '#94a3b8', fontFamily: 'Share Tech Mono,monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5, overflowX: 'auto' }}>{code}</pre>
        </div>
      )
      return
    }

    // Process line by line
    const lines = seg.split('\n')
    let li = 0
    while (li < lines.length) {
      const line = lines[li]
      const key = `l-${si}-${li}`

      if (line.startsWith('### ')) {
        nodes.push(<div key={key} style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 12, margin: '8px 0 3px', lineHeight: 1.4 }}>{renderInline(line.slice(4))}</div>)
      } else if (line.startsWith('## ')) {
        nodes.push(<div key={key} style={{ fontWeight: 700, color: '#00cfff', fontSize: 12, margin: '10px 0 4px', lineHeight: 1.4 }}>{renderInline(line.slice(3))}</div>)
      } else if (line.startsWith('# ')) {
        nodes.push(<div key={key} style={{ fontWeight: 700, color: '#00cfff', fontSize: 13, margin: '10px 0 5px', lineHeight: 1.4 }}>{renderInline(line.slice(2))}</div>)
      } else if (/^[-*] /.test(line)) {
        nodes.push(<div key={key} style={{ display: 'flex', gap: 6, marginBottom: 2, paddingLeft: 4 }}><span style={{ color: '#00cfff', flexShrink: 0, marginTop: 1 }}>•</span><span style={{ lineHeight: 1.5 }}>{renderInline(line.slice(2))}</span></div>)
      } else if (/^\d+\. /.test(line)) {
        const m = line.match(/^(\d+)\. (.*)$/)
        nodes.push(<div key={key} style={{ display: 'flex', gap: 6, marginBottom: 2, paddingLeft: 4 }}><span style={{ color: '#00cfff', flexShrink: 0, minWidth: 14 }}>{m?.[1]}.</span><span style={{ lineHeight: 1.5 }}>{renderInline(m?.[2] ?? '')}</span></div>)
      } else if (line === '' || line === '\r') {
        nodes.push(<div key={key} style={{ height: 5 }} />)
      } else {
        nodes.push(<div key={key} style={{ lineHeight: 1.6, marginBottom: 1 }}>{renderInline(line)}</div>)
      }
      li++
    }
  })

  return <>{nodes}</>
}

export default function StationControl({ initialTasks, initialAgents, initialActivity }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const centerCommsRef = useRef<HTMLDivElement>(null)
  const rightCommsRef = useRef<HTMLDivElement>(null)
  const windowWidth = useWindowWidth()
  const isMobile = windowWidth < 768

  const [activeTab, setActiveTab] = useState<CenterTab>('station')
  const [rightPanel, setRightPanel] = useState<RightPanel>(null)
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)

  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [agents, setAgents] = useState<Agent[]>(initialAgents)
  const [activity, setActivity] = useState<ActivityEntry[]>(initialActivity)
  const [taskSteps, setTaskSteps] = useState<Record<string, Array<{step:number;type:string;content:string}>>>({})

  const [gwConnected, setGwConnected] = useState(false)
  const [time, setTime] = useState(new Date())
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)

  // ARIA chat — lives in right panel as a tab
  const [rightTab, setRightTab] = useState<'comms' | 'aria'>('comms')
  // Track file saves per task (for auto-refresh)
  const [fileSavedVersions, setFileSavedVersions] = useState<Record<string, number>>({})

  const [ariaMessages, setAriaMessages] = useState<AriaChatMsg[]>([])
  const [ariaInput, setAriaInput] = useState('')
  const [ariaStreaming, setAriaStreaming] = useState(false)
  const ariaEndRef = useRef<HTMLDivElement>(null)

  // Epics
  const [epics, setEpics] = useState<Epic[]>([])
  const [loadingEpics, setLoadingEpics] = useState(false)

  // Sentinel
  const [sentinelAlerts, setSentinelAlerts] = useState<SentinelAlert[]>([])

  // Modals
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [showCreateAgent, setShowCreateAgent] = useState(false)
  const [showCreateEpic, setShowCreateEpic] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  // ── Canvas starfield ─────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight }
    resize()
    window.addEventListener('resize', resize)
    const stars = Array.from({ length: 180 }, () => ({
      x: Math.random() * canvas.width, y: Math.random() * canvas.height,
      r: Math.random() * 1.2 + 0.2, o: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.003 + 0.001,
    }))
    let raf: number
    const draw = () => {
      ctx.fillStyle = '#050a1a'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      stars.forEach(s => {
        s.o += s.speed
        const alpha = (Math.sin(s.o) + 1) / 2
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(150,200,255,${alpha * 0.8})`; ctx.fill()
      })
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])

  // ── Clock ────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // ── SSE ──────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource('/api/events')
    es.addEventListener('gateway', e => setGwConnected(JSON.parse(e.data).connected))

    es.addEventListener('task_update', e => {
      const d = JSON.parse(e.data) as Task & { _action?: string }
      setTasks(prev => {
        const exists = prev.find(t => t.id === d.id)
        if (!exists) return [d, ...prev]   // new task from agent
        return prev.map(t => t.id === d.id ? { ...t, ...d } : t)
      })
      // Keep task detail panel in sync
      setSelectedTask(prev => prev?.id === d.id ? { ...prev, ...d } : prev)
    })

    es.addEventListener('task_delete', e => {
      const { id } = JSON.parse(e.data)
      setTasks(prev => prev.filter(t => t.id !== id))
      setSelectedTask(prev => prev?.id === id ? null : prev)
    })

    es.addEventListener('agent_update', e => {
      const d = JSON.parse(e.data)
      if (d.action === 'deleted') {
        setAgents(prev => prev.filter(a => a.id !== d.id))
        setSelectedAgent(prev => prev?.id === d.id ? null : prev)
      } else if (d.action === 'created') {
        setAgents(prev => [...prev, d])
      } else if (d.id) {
        setAgents(prev => prev.map(a => a.id === d.id ? { ...a, ...d } : a))
        setSelectedAgent(prev => prev?.id === d.id ? { ...prev, ...d } : prev)
      }
    })

    es.addEventListener('task_step', e => {
      const { taskId, step, type, content } = JSON.parse(e.data)
      setTaskSteps(prev => {
        const existing = prev[taskId] ?? []
        return { ...prev, [taskId]: [...existing.filter(s => s.step !== step), { step, type, content }].sort((a,b)=>a.step-b.step) }
      })
    })

    es.addEventListener('activity_update', e => {
      const entry = JSON.parse(e.data) as ActivityEntry
      setActivity(prev => [entry, ...prev].slice(0, 200))
    })

    es.addEventListener('file_saved', e => {
      const { taskId } = JSON.parse(e.data) as { taskId: string }
      setFileSavedVersions(prev => ({ ...prev, [taskId]: (prev[taskId] ?? 0) + 1 }))
    })

    es.addEventListener('epic_update', e => {
      const epic = JSON.parse(e.data) as Epic
      setEpics(prev => {
        const idx = prev.findIndex(ep => ep.id === epic.id)
        if (idx >= 0) { const n = [...prev]; n[idx] = { ...n[idx], ...epic }; return n }
        return [epic, ...prev]
      })
    })

    es.addEventListener('epic_deleted', e => {
      const { id } = JSON.parse(e.data)
      setEpics(prev => prev.filter(ep => ep.id !== id))
    })

    es.addEventListener('sentinel_alert', e => {
      const alert = JSON.parse(e.data) as SentinelAlert
      setSentinelAlerts(prev => [alert, ...prev].slice(0, 20))
    })

    es.addEventListener('sentinel_alert_resolved', e => {
      const { id } = JSON.parse(e.data)
      setSentinelAlerts(prev => prev.filter(a => a.id !== id))
    })

    es.addEventListener('agent_update', e => {
      const agent = JSON.parse(e.data) as Agent
      setAgents(prev => {
        const idx = prev.findIndex(a => a.id === agent.id)
        if (idx >= 0) { const n = [...prev]; n[idx] = { ...n[idx], ...agent }; return n }
        return [...prev, agent]
      })
    })

    return () => es.close()
  }, [])

  // Load epics when tab becomes active
  useEffect(() => {
    if (activeTab === 'epics' && epics.length === 0) {
      setLoadingEpics(true)
      fetch('/api/epics').then(r => r.json()).then(data => { setEpics(data); setLoadingEpics(false) }).catch(() => setLoadingEpics(false))
    }
  }, [activeTab])

  useEffect(() => {
    if (centerCommsRef.current) centerCommsRef.current.scrollTop = centerCommsRef.current.scrollHeight
    if (rightCommsRef.current) rightCommsRef.current.scrollTop = rightCommsRef.current.scrollHeight
  }, [activity.length])

  const orchestrator = agents.find(a => a.room === 'command') ?? agents[0]

  async function sendChat() {
    if (!chatInput.trim() || sending || !orchestrator) return
    const text = chatInput.trim()
    setChatInput('')
    setSending(true)
    try {
      const r = await fetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: text, description: text, agent_id: orchestrator.id, priority: 'medium' }),
      })
      if (r.ok) {
        const task = await r.json()
        setTasks(prev => [task, ...prev])
        await fetch('/api/dispatch', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: task.id }),
        })
      }
    } finally { setSending(false) }
  }

  async function sendAriaMessage(text?: string) {
    const msg = (text ?? ariaInput).trim()
    if (!msg || ariaStreaming) return
    setAriaInput('')
    setAriaStreaming(true)
    const userMsg: AriaChatMsg = { id: uid(), role: 'user', content: msg }
    setAriaMessages(prev => [...prev, userMsg])
    setTimeout(() => ariaEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)

    let assistantId = uid()
    let assistantContent = ''
    setAriaMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }])

    try {
      const resp = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg }) })
      if (!resp.body) throw new Error('no body')
      const reader = resp.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const part of parts) {
          if (!part.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(part.slice(6)) as { type: string; content?: string; name?: string; args?: unknown; ok?: boolean; id?: string; tool?: string; preview?: string; message?: string }
            if (evt.type === 'text') {
              assistantContent += evt.content ?? ''
              setAriaMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: assistantContent } : m))
              ariaEndRef.current?.scrollIntoView({ behavior: 'smooth' })
            } else if (evt.type === 'tool_call') {
              setAriaMessages(prev => [...prev, { id: uid(), role: 'tool_call', content: `${evt.name}(${JSON.stringify(evt.args ?? {}).slice(0, 80)})`, tool: evt.name }])
              assistantId = uid(); assistantContent = ''
              setAriaMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }])
            } else if (evt.type === 'tool_result') {
              setAriaMessages(prev => prev.map(m => m.role === 'tool_call' && m.tool === evt.name ? { ...m, content: `${m.content}\n→ ${(evt.content ?? '').slice(0, 200)}` } : m))
            } else if (evt.type === 'approval_required') {
              setRightTab('aria')
              setAriaMessages(prev => [...prev.filter(m => m.id !== assistantId), { id: uid(), role: 'approval', content: '', approvalId: evt.id, approvalTool: evt.tool, approvalPreview: evt.preview, approved: null }])
            } else if (evt.type === 'done') {
              if (!assistantContent) setAriaMessages(prev => prev.filter(m => m.id !== assistantId))
            } else if (evt.type === 'error') {
              setAriaMessages(prev => [...prev.filter(m => m.id !== assistantId), { id: uid(), role: 'assistant', content: `Error: ${evt.message}` }])
            }
          } catch {}
        }
      }
    } catch (e) {
      setAriaMessages(prev => [...prev, { id: uid(), role: 'assistant', content: `Connection error: ${String(e)}` }])
    } finally {
      setAriaStreaming(false)
      setTimeout(() => ariaEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }
  }

  async function approveAriaAction(approvalId: string, approved: boolean) {
    setAriaMessages(prev => prev.map(m => m.approvalId === approvalId ? { ...m, approved } : m))
    const resp = await fetch('/api/chat/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: approvalId, approved }) })
    const { result } = await resp.json() as { result: string }
    if (approved) {
      setAriaMessages(prev => [...prev, { id: uid(), role: 'tool_result', content: result, tool: 'approved' }])
      sendAriaMessage('The action was approved and executed. Continue.')
    } else {
      setAriaMessages(prev => [...prev, { id: uid(), role: 'assistant', content: 'Action cancelled.' }])
    }
  }

  function selectRoom(room: Room | null) {
    setSelectedRoom(room); setSelectedAgent(null); setSelectedTask(null)
    setRightPanel(room ? 'room' : null)
  }
  function selectAgent(agent: Agent | null) {
    setSelectedAgent(agent); setSelectedRoom(null); setSelectedTask(null)
    setRightPanel(agent ? 'agent' : null)
  }
  function selectTask(task: Task | null) {
    setSelectedTask(task); setSelectedRoom(null); setSelectedAgent(null)
    setRightPanel(task ? 'task' : null)
  }

  const activeAgents = agents.filter(a => a.status === 'busy').length
  const activeTasks = tasks.filter(t => t.status === 'active').length

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: '#050a1a' }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1;box-shadow:0 0 6px currentColor} 50%{opacity:0.5;box-shadow:0 0 12px currentColor} }
        @keyframes scanline { 0%{transform:translateY(-100%)} 100%{transform:translateY(100vh)} }
        @keyframes slide-in { from{transform:translateX(20px);opacity:0} to{transform:translateX(0);opacity:1} }
        @keyframes slide-up { from{transform:translateY(100%);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes fade-in { from{opacity:0} to{opacity:1} }
        @keyframes glow { 0%,100%{text-shadow:0 0 8px #00cfff} 50%{text-shadow:0 0 20px #00cfff,0 0 40px #00cfff80} }
        .room-card:hover{transform:scale(1.03);filter:brightness(1.15);}
        .room-card{transition:all 0.2s;cursor:pointer;}
        .agent-row:hover{background:rgba(0,207,255,0.06)!important;}
        .agent-row{transition:background 0.15s;cursor:pointer;}
        .tab-btn{transition:all 0.2s;cursor:pointer;border:none;background:transparent;}
        .task-row:hover{background:rgba(0,207,255,0.05)!important;}
        .task-row{transition:background 0.15s;cursor:pointer;}
        .file-row:hover{background:rgba(0,207,255,0.06)!important;}
        .btn-action{cursor:pointer;transition:all 0.15s;border:none;}
        .btn-action:hover{filter:brightness(1.3);}
        .mob-tab{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;border:none;background:transparent;padding:6px 0;transition:all 0.15s;}
        .mob-sheet{background:#080e1f;border-top:2px solid rgba(0,207,255,0.3);animation:slide-up 0.25s ease-out;overflow-y:auto;}
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#0a1628} ::-webkit-scrollbar-thumb{background:#1a4a6a;border-radius:2px}
        input,textarea,select{outline:none;}
        .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:100;display:flex;align-items:center;justify-content:center;animation:fade-in 0.15s;}
      `}</style>

      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0 }} />
      <div style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{ width: '100%', height: '3px', background: 'linear-gradient(transparent,rgba(0,207,255,0.05),transparent)', animation: 'scanline 10s linear infinite' }} />
      </div>

      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', height: '100vh' }}>

        {/* ── Top Bar ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `0 ${isMobile ? 14 : 20}px`, height: isMobile ? '46px' : '48px', borderBottom: '1px solid rgba(0,207,255,0.12)', background: 'rgba(5,10,26,0.95)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 16 }}>
            <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: isMobile ? 14 : 18, fontWeight: 900, color: '#00cfff', animation: 'glow 4s ease-in-out infinite', letterSpacing: '0.12em' }}>◈ OPENCLAW</div>
            <div style={{ background: 'rgba(34,197,94,0.12)', border: `1px solid ${gwConnected ? '#22c55e' : '#ef4444'}`, borderRadius: 20, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: gwConnected ? '#22c55e' : '#ef4444', animation: 'pulse 2s infinite' }} />
              <span style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 8, letterSpacing: 2, color: gwConnected ? '#22c55e' : '#ef4444' }}>{gwConnected ? 'ONLINE' : 'OFFLINE'}</span>
            </div>
          </div>

          {/* Desktop tabs only */}
          {!isMobile && (
            <div style={{ display: 'flex', gap: 4 }}>
              {(['station', 'agents', 'tasks', 'epics', 'comms', 'files', 'skills', 'settings'] as CenterTab[]).map(tab => (
                <button key={tab} className="tab-btn" onClick={() => { setActiveTab(tab); if (tab === 'comms') setTimeout(() => { if (centerCommsRef.current) centerCommsRef.current.scrollTop = centerCommsRef.current.scrollHeight }, 20) }}
                  style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 11, letterSpacing: 2, padding: '6px 14px', color: activeTab === tab ? '#00cfff' : '#4a6a8a', borderBottom: `2px solid ${activeTab === tab ? '#00cfff' : 'transparent'}`, textShadow: activeTab === tab ? '0 0 10px rgba(0,207,255,0.9)' : 'none' }}>
                  {tab.toUpperCase()}
                  {tab === 'tasks' && activeTasks > 0 && <span style={{ marginLeft: 5, fontSize: 9, background: '#22c55e', color: '#000', borderRadius: 10, padding: '0 5px' }}>{activeTasks}</span>}
                  {tab === 'epics' && epics.filter(e => e.status === 'active').length > 0 && <span style={{ marginLeft: 5, fontSize: 9, background: '#8b5cf6', color: '#fff', borderRadius: 10, padding: '0 5px' }}>{epics.filter(e => e.status === 'active').length}</span>}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12 }}>
            {!isMobile && <span style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 11, color: '#4a6a8a' }}>CREW <span style={{ color: '#22c55e' }}>{activeAgents}</span>/{agents.length}</span>}
            <span style={{ fontFamily: 'Orbitron,sans-serif', fontSize: isMobile ? 10 : 11, color: '#00cfff', opacity: 0.7, letterSpacing: 2 }}>
              {time.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <button onClick={() => setShowSettings(true)} className="btn-action"
              style={{ padding: '4px 7px', background: 'rgba(0,207,255,0.08)', border: '1px solid rgba(0,207,255,0.2)', borderRadius: 4, color: '#4a6a8a', fontSize: 13, cursor: 'pointer' }} title="Settings">⚙</button>
          </div>
        </div>

        {/* ── Body ── */}
        {isMobile ? (
          /* ── Mobile: single column + bottom nav ── */
          <>
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {activeTab === 'station' && <StationTab rooms={ROOMS} agents={agents} tasks={tasks} selectedRoom={selectedRoom} onSelectRoom={r => { selectRoom(r); if (r) setActiveTab('station') }} />}
              {activeTab === 'agents' && <AgentsTab agents={agents} tasks={tasks} onSelectAgent={selectAgent} />}
              {activeTab === 'tasks' && <TasksTab tasks={tasks} agents={agents} onSelectTask={selectTask} selectedTaskId={selectedTask?.id} onNewTask={() => setShowCreateTask(true)} onDispatch={async (id) => {
                await fetch('/api/dispatch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: id }) })
              }} onDelete={async (id) => {
                await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
              }} onStatusChange={async (id, status) => {
                await fetch(`/api/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
              }} />}
              {activeTab === 'comms' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  <div ref={centerCommsRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[...activity].reverse().slice(0, 60).map((e, i) => {
                      const ag = agents.find(a => a.id === e.agent_id); const col = ag ? agentColor(ag) : '#00cfff'
                      const isErr = e.type.includes('fail') || e.type.includes('error'); const isOk = e.type.includes('complet') || e.type.includes('creat') || e.type.includes('dispatch')
                      return (
                        <div key={e.id ?? i} style={{ paddingBottom: 8, borderBottom: '1px solid rgba(0,207,255,0.06)' }}>
                          <div style={{ display: 'flex', gap: 6, marginBottom: 3 }}>
                            {ag && <span style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 10, color: col }}>{ag.name}</span>}
                            <span style={{ fontSize: 10, color: '#2a4a6a', fontFamily: 'Share Tech Mono,monospace' }}>{new Date(e.created_at).toLocaleTimeString()}</span>
                          </div>
                          <div style={{ fontSize: 12, color: isErr ? '#ef4444' : isOk ? '#22c55e' : '#94a3b8', lineHeight: 1.5 }}>{e.summary}</div>
                        </div>
                      )
                    })}
                    {activity.length === 0 && <div style={{ color: '#2a4a6a', fontSize: 12, fontFamily: 'Share Tech Mono,monospace' }}>No transmissions</div>}
                  </div>
                  <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(0,207,255,0.12)', display: 'flex', gap: 8, flexShrink: 0 }}>
                    <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChat()}
                      placeholder={orchestrator ? `→ ${orchestrator.name}…` : 'No orchestrator'} disabled={!orchestrator || sending}
                      style={{ flex: 1, padding: '10px 12px', background: 'rgba(0,207,255,0.06)', border: '1px solid rgba(0,207,255,0.2)', borderRadius: 6, color: '#e2e8f0', fontFamily: 'Share Tech Mono,monospace', fontSize: 14 }} />
                    <button onClick={sendChat} disabled={!chatInput.trim() || sending || !orchestrator}
                      style={{ padding: '10px 14px', background: chatInput.trim() ? 'rgba(0,207,255,0.2)' : 'rgba(0,207,255,0.05)', border: '1px solid rgba(0,207,255,0.4)', borderRadius: 6, color: '#00cfff', fontFamily: 'Orbitron,sans-serif', fontSize: 10, cursor: 'pointer' }}>SEND</button>
                  </div>
                </div>
              )}
              {activeTab === 'epics' && <EpicsTab epics={epics} tasks={tasks} agents={agents} loading={loadingEpics} onCreateEpic={() => setShowCreateEpic(true)} onDecompose={async (id) => { await fetch(`/api/epics/${id}`, { method: 'POST' }) }} onDelete={async (id) => { await fetch(`/api/epics/${id}`, { method: 'DELETE' }) }} />}
              {activeTab === 'files' && <FilesTab tasks={tasks} agents={agents} refreshKey={Object.values(fileSavedVersions).reduce((a, b) => a + b, 0)} />}
              {activeTab === 'skills' && <SkillsTab />}
              {activeTab === 'settings' && <SettingsTab agents={agents} />}
            </div>

            {/* Mobile overlay for room/agent/task detail */}
            {(selectedRoom || selectedAgent || selectedTask) && (
              <div style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'flex', flexDirection: 'column', animation: 'fade-in 0.15s' }}>
                <div style={{ flex: 1, background: 'rgba(0,0,0,0.6)' }} onClick={() => { selectRoom(null); selectAgent(null); selectTask(null) }} />
                <div className="mob-sheet" style={{ maxHeight: '80vh', padding: 0 }}>
                  {selectedRoom && <RoomPanel room={selectedRoom} agents={agents} tasks={tasks} activity={activity} onClose={() => selectRoom(null)} />}
                  {selectedAgent && <AgentPanel agent={selectedAgent} agents={agents} onClose={() => selectAgent(null)}
                    onSaved={u => { setAgents(p => p.map(a => a.id === u.id ? u : a)); setSelectedAgent(u) }}
                    onDeleted={() => { setAgents(p => p.filter(a => a.id !== selectedAgent?.id)); selectAgent(null) }} />}
                  {selectedTask && <TaskDetailPanel task={selectedTask} agents={agents} steps={taskSteps[selectedTask.id] ?? []} fileVersion={fileSavedVersions[selectedTask.id] ?? 0} onClose={() => selectTask(null)}
                    onDispatch={async () => fetch('/api/dispatch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: selectedTask.id }) })}
                    onDelete={async () => { await fetch(`/api/tasks/${selectedTask.id}`, { method: 'DELETE' }); selectTask(null) }} />}
                </div>
              </div>
            )}

            {/* Bottom nav */}
            <div style={{ height: 60, borderTop: '1px solid rgba(0,207,255,0.15)', background: 'rgba(5,10,26,0.98)', display: 'flex', flexShrink: 0 }}>
              {([
                { key: 'station', icon: '🗺️', label: 'STATION' },
                { key: 'agents', icon: '👥', label: 'CREW' },
                { key: 'tasks', icon: '✅', label: 'TASKS', badge: activeTasks },
                { key: 'epics', icon: '🎯', label: 'EPICS', badge: epics.filter(e => e.status === 'active').length },
                { key: 'comms', icon: '💬', label: 'COMMS' },
                { key: 'files', icon: '📁', label: 'FILES' },
                { key: 'skills', icon: '🔧', label: 'SKILLS' },
                { key: 'settings', icon: '⚙️', label: 'CONFIG' },
              ] as { key: CenterTab; icon: string; label: string; badge?: number }[]).map(t => (
                <button key={t.key} className="mob-tab" onClick={() => setActiveTab(t.key)}
                  style={{ color: activeTab === t.key ? '#00cfff' : '#2a4a6a', position: 'relative' }}>
                  <span style={{ fontSize: 20, filter: activeTab === t.key ? 'drop-shadow(0 0 8px #00cfff)' : 'none' }}>{t.icon}</span>
                  <span style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 7, letterSpacing: 1, textShadow: activeTab === t.key ? '0 0 8px #00cfff' : 'none' }}>{t.label}</span>
                  {!!t.badge && t.badge > 0 && <span style={{ position: 'absolute', top: 4, right: '20%', fontSize: 8, background: '#22c55e', color: '#000', borderRadius: 8, padding: '0 4px', fontFamily: 'Orbitron,sans-serif', minWidth: 14, textAlign: 'center' }}>{t.badge}</span>}
                </button>
              ))}
            </div>
          </>
        ) : (
          /* ── Desktop: 3-column ── */
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

            {/* Left — Agent Roster */}
            <div style={{ width: 210, borderRight: '1px solid rgba(0,207,255,0.12)', background: 'rgba(5,10,26,0.9)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
              <div style={{ padding: '10px 14px 8px', fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 3, color: '#4a6a8a', borderBottom: '1px solid rgba(0,207,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>CREW — {activeAgents}/{agents.length}</span>
                <button className="btn-action" onClick={() => setShowCreateAgent(true)}
                  style={{ fontSize: 14, color: '#00cfff', background: 'rgba(0,207,255,0.1)', border: '1px solid rgba(0,207,255,0.3)', borderRadius: 3, width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>+</button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
                {agents.map(a => {
                  const col = agentColor(a); const dept = agentDept(a); const isActive = a.status === 'busy'; const isSelected = selectedAgent?.id === a.id
                  return (
                    <div key={a.id} className="agent-row" onClick={() => selectAgent(isSelected ? null : a)}
                      style={{ padding: '8px 14px', borderBottom: '1px solid rgba(0,207,255,0.05)', borderLeft: `2px solid ${isSelected ? col : col + '40'}`, background: isSelected ? `${col}08` : 'transparent' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor(a.status), flexShrink: 0, animation: isActive ? 'pulse 1.8s infinite' : 'none', boxShadow: isActive ? `0 0 6px ${statusColor(a.status)}` : 'none' }} />
                        <span style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 11, color: col, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                      </div>
                      <div style={{ fontSize: 9, color: '#4a6a8a', paddingLeft: 14, fontFamily: 'Share Tech Mono,monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.model_primary.split('/').pop()?.slice(0, 18)}</div>
                      <div style={{ paddingLeft: 14, marginTop: 3 }}>
                        <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 2, background: `${col}20`, border: `1px solid ${col}40`, color: col, fontFamily: 'Share Tech Mono,monospace', letterSpacing: 1 }}>{dept}</span>
                      </div>
                    </div>
                  )
                })}
                {agents.length === 0 && <div style={{ padding: '20px 14px', color: '#2a4a6a', fontSize: 11, fontFamily: 'Share Tech Mono,monospace' }}>No agents</div>}
              </div>
            </div>

            {/* Centre */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {activeTab === 'station' && <StationTab rooms={ROOMS} agents={agents} tasks={tasks} selectedRoom={selectedRoom} onSelectRoom={selectRoom} />}
              {activeTab === 'agents' && <AgentsTab agents={agents} tasks={tasks} onSelectAgent={selectAgent} />}
              {activeTab === 'tasks' && <TasksTab tasks={tasks} agents={agents} onSelectTask={selectTask} selectedTaskId={selectedTask?.id} onNewTask={() => setShowCreateTask(true)} onDispatch={async (id) => {
                await fetch('/api/dispatch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: id }) })
              }} onDelete={async (id) => {
                await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
              }} onStatusChange={async (id, status) => {
                await fetch(`/api/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
              }} />}
              {activeTab === 'comms' && <CommsTab activity={activity} agents={agents} />}
              {activeTab === 'epics' && <EpicsTab epics={epics} tasks={tasks} agents={agents} loading={loadingEpics} onCreateEpic={() => setShowCreateEpic(true)} onDecompose={async (id) => { await fetch(`/api/epics/${id}`, { method: 'POST' }) }} onDelete={async (id) => { await fetch(`/api/epics/${id}`, { method: 'DELETE' }) }} />}
              {activeTab === 'files' && <FilesTab tasks={tasks} agents={agents} refreshKey={Object.values(fileSavedVersions).reduce((a, b) => a + b, 0)} />}
              {activeTab === 'skills' && <SkillsTab />}
              {activeTab === 'settings' && <SettingsTab agents={agents} />}
            </div>

            {/* Right Panel */}
            <div style={{ width: 300, borderLeft: '1px solid rgba(0,207,255,0.12)', background: 'rgba(5,10,26,0.95)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
              {rightPanel === 'room' && selectedRoom && (
                <div style={{ flex: 1, overflow: 'auto', borderBottom: '1px solid rgba(0,207,255,0.12)', animation: 'slide-in 0.2s ease-out' }}>
                  <RoomPanel room={selectedRoom} agents={agents} tasks={tasks} activity={activity} onClose={() => selectRoom(null)} />
                </div>
              )}
              {rightPanel === 'agent' && selectedAgent && (
                <div style={{ flex: 1, overflow: 'auto', borderBottom: '1px solid rgba(0,207,255,0.12)', animation: 'slide-in 0.2s ease-out' }}>
                  <AgentPanel agent={selectedAgent} agents={agents} onClose={() => selectAgent(null)}
                    onSaved={(u) => { setAgents(prev => prev.map(a => a.id === u.id ? u : a)); setSelectedAgent(u) }}
                    onDeleted={() => { setAgents(prev => prev.filter(a => a.id !== selectedAgent.id)); setSelectedAgent(null); setRightPanel(null) }} />
                </div>
              )}
              {rightPanel === 'task' && selectedTask && (
                <div style={{ flex: 1, overflow: 'auto', borderBottom: '1px solid rgba(0,207,255,0.12)', animation: 'slide-in 0.2s ease-out' }}>
                  <TaskDetailPanel task={selectedTask} agents={agents} steps={taskSteps[selectedTask.id] ?? []} fileVersion={fileSavedVersions[selectedTask.id] ?? 0} onClose={() => selectTask(null)}
                    onDispatch={async () => fetch('/api/dispatch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: selectedTask.id }) })}
                    onDelete={async () => { await fetch(`/api/tasks/${selectedTask.id}`, { method: 'DELETE' }); selectTask(null) }} />
                </div>
              )}

              {/* Central Comms / ARIA panel — tabbed */}
              <div style={{ flex: rightPanel ? '0 0 240px' : 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                {/* Tab header */}
                <div style={{ padding: '0 10px', borderBottom: '1px solid rgba(0,207,255,0.1)', display: 'flex', alignItems: 'center', gap: 0, flexShrink: 0 }}>
                  <button onClick={() => { setRightTab('comms'); setTimeout(() => { if (rightCommsRef.current) rightCommsRef.current.scrollTop = rightCommsRef.current.scrollHeight }, 20) }} style={{ padding: '8px 10px', background: 'none', border: 'none', borderBottom: `2px solid ${rightTab === 'comms' ? '#00cfff' : 'transparent'}`, color: rightTab === 'comms' ? '#00cfff' : '#4a6a8a', fontFamily: 'Orbitron,sans-serif', fontSize: 8, letterSpacing: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s infinite' }} />
                    COMMS
                  </button>
                  <button onClick={() => setRightTab('aria')} style={{ padding: '8px 10px', background: 'none', border: 'none', borderBottom: `2px solid ${rightTab === 'aria' ? '#00cfff' : 'transparent'}`, color: rightTab === 'aria' ? '#00cfff' : '#4a6a8a', fontFamily: 'Orbitron,sans-serif', fontSize: 8, letterSpacing: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ opacity: ariaStreaming ? 1 : 0.7 }}>◈</span>
                    ARIA
                    {ariaStreaming && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', animation: 'pulse 1s infinite', display: 'inline-block' }} />}
                  </button>
                  {rightTab === 'comms' && orchestrator && <span style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Share Tech Mono,monospace', marginLeft: 'auto' }}>↗ {orchestrator.name}</span>}
                  {rightTab === 'aria' && (
                    <button onClick={async () => { if (confirm('Clear ARIA conversation?')) { await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ clear: true }), headers: { 'Content-Type': 'application/json' } }); setAriaMessages([]) } }}
                      style={{ background: 'none', border: 'none', color: '#2a4a6a', cursor: 'pointer', fontSize: 12, padding: '0 4px', marginLeft: 'auto' }} title="Clear ARIA">↺</button>
                  )}
                </div>

                {rightTab === 'comms' ? (
                  <>
                    <div ref={rightCommsRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {[...activity].reverse().slice(0, 40).map((e, i) => {
                        const ag = agents.find(a => a.id === e.agent_id); const col = ag ? agentColor(ag) : '#00cfff'
                        const isErr = e.type.includes('fail') || e.type.includes('error'); const isOk = e.type.includes('complet') || e.type.includes('creat') || e.type.includes('dispatch')
                        return (
                          <div key={e.id ?? i}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 1 }}>
                              {ag && <span style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 9, color: col }}>{ag.name}</span>}
                              <span style={{ fontSize: 9, color: '#2a4a6a', fontFamily: 'Share Tech Mono,monospace' }}>{new Date(e.created_at).toLocaleTimeString()}</span>
                            </div>
                            <div style={{ fontSize: 11, color: isErr ? '#ef4444' : isOk ? '#22c55e' : '#94a3b8', lineHeight: 1.4, wordBreak: 'break-word' }}>{e.summary.length > 80 ? e.summary.slice(0, 80) + '…' : e.summary}</div>
                          </div>
                        )
                      })}
                      {activity.length === 0 && <div style={{ color: '#2a4a6a', fontSize: 11, fontFamily: 'Share Tech Mono,monospace' }}>No transmissions yet</div>}
                    </div>
                    <div style={{ padding: '8px 10px', borderTop: '1px solid rgba(0,207,255,0.1)', display: 'flex', gap: 6, flexShrink: 0 }}>
                      <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChat()}
                        placeholder={orchestrator ? `→ ${orchestrator.name}…` : 'No orchestrator'} disabled={!orchestrator || sending}
                        style={{ flex: 1, padding: '7px 9px', background: 'rgba(0,207,255,0.06)', border: '1px solid rgba(0,207,255,0.2)', borderRadius: 4, color: '#e2e8f0', fontFamily: 'Share Tech Mono,monospace', fontSize: 12 }} />
                      <button onClick={sendChat} disabled={!chatInput.trim() || sending || !orchestrator}
                        style={{ padding: '7px 10px', background: chatInput.trim() ? 'rgba(0,207,255,0.2)' : 'rgba(0,207,255,0.05)', border: '1px solid rgba(0,207,255,0.4)', borderRadius: 4, color: '#00cfff', fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 1, cursor: 'pointer', transition: 'all 0.15s' }}>SEND</button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* ARIA messages */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {ariaMessages.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '20px 0' }}>
                          <div style={{ fontSize: 20, marginBottom: 6 }}>◈</div>
                          <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 9, color: '#00cfff', letterSpacing: 2, marginBottom: 4 }}>ARIA ONLINE</div>
                          <div style={{ fontSize: 10, color: '#4a6a8a', lineHeight: 1.5 }}>AI officer. Codebase access, git ops, task creation.</div>
                          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
                            {['What tasks are running?', 'Show git status', 'List source files'].map(s => (
                              <button key={s} onClick={() => sendAriaMessage(s)} style={{ fontSize: 9, padding: '3px 7px', background: 'rgba(0,207,255,0.08)', border: '1px solid rgba(0,207,255,0.2)', borderRadius: 10, color: '#00cfff', cursor: 'pointer', fontFamily: 'Share Tech Mono,monospace' }}>{s}</button>
                            ))}
                          </div>
                        </div>
                      )}
                      {ariaMessages.map(m => {
                        if (m.role === 'user') return (
                          <div key={m.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <div style={{ maxWidth: '85%', padding: '6px 10px', background: 'rgba(0,207,255,0.12)', border: '1px solid rgba(0,207,255,0.25)', borderRadius: '10px 10px 2px 10px', fontSize: 11, color: '#e2e8f0', lineHeight: 1.5 }}>{m.content}</div>
                          </div>
                        )
                        if (m.role === 'tool_call') return (
                          <div key={m.id} style={{ padding: '4px 7px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 5, fontSize: 9, color: '#f59e0b', fontFamily: 'Share Tech Mono,monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>⚙ {m.content}</div>
                        )
                        if (m.role === 'tool_result') return (
                          <div key={m.id} style={{ padding: '3px 7px', background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: 4, fontSize: 9, color: '#86efac', fontFamily: 'Share Tech Mono,monospace' }}>✓ {m.content.slice(0, 120)}</div>
                        )
                        if (m.role === 'approval') return (
                          <div key={m.id} style={{ padding: '8px 10px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 7 }}>
                            <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 8, color: '#ef4444', letterSpacing: 1, marginBottom: 5 }}>⚠ APPROVAL: {m.approvalTool?.replace(/_/g, ' ').toUpperCase()}</div>
                            <pre style={{ fontSize: 9, color: '#94a3b8', fontFamily: 'Share Tech Mono,monospace', whiteSpace: 'pre-wrap', margin: '0 0 7px', lineHeight: 1.4 }}>{m.approvalPreview}</pre>
                            {m.approved === null ? (
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => approveAriaAction(m.approvalId!, true)} style={{ flex: 1, padding: '5px', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: 4, color: '#22c55e', fontSize: 9, cursor: 'pointer', fontFamily: 'Orbitron,sans-serif', letterSpacing: 1 }}>APPROVE</button>
                                <button onClick={() => approveAriaAction(m.approvalId!, false)} style={{ flex: 1, padding: '5px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4, color: '#ef4444', fontSize: 9, cursor: 'pointer', fontFamily: 'Orbitron,sans-serif', letterSpacing: 1 }}>DENY</button>
                              </div>
                            ) : (
                              <div style={{ fontSize: 9, color: m.approved ? '#22c55e' : '#ef4444', fontFamily: 'Orbitron,sans-serif' }}>{m.approved ? '✓ APPROVED' : '✕ DENIED'}</div>
                            )}
                          </div>
                        )
                        return (
                          <div key={m.id} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                            <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'rgba(0,207,255,0.15)', border: '1px solid rgba(0,207,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2, fontSize: 8 }}>◈</div>
                            <div style={{ maxWidth: '88%', padding: '6px 10px', background: 'rgba(0,207,255,0.05)', border: '1px solid rgba(0,207,255,0.12)', borderRadius: '10px 10px 10px 2px', fontSize: 11, color: '#cbd5e1', lineHeight: 1.5, wordBreak: 'break-word' }}>
                              {m.content ? renderMarkdown(m.content) : (ariaStreaming ? <span style={{ opacity: 0.5 }}>●●●</span> : '')}
                            </div>
                          </div>
                        )
                      })}
                      <div ref={ariaEndRef} />
                    </div>
                    {/* ARIA input */}
                    <div style={{ padding: '8px 10px', borderTop: '1px solid rgba(0,207,255,0.1)', display: 'flex', gap: 6, flexShrink: 0 }}>
                      <input value={ariaInput} onChange={e => setAriaInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAriaMessage() } }}
                        placeholder={ariaStreaming ? 'ARIA is thinking…' : 'Message ARIA…'}
                        disabled={ariaStreaming}
                        style={{ flex: 1, background: 'rgba(0,207,255,0.06)', border: '1px solid rgba(0,207,255,0.2)', borderRadius: 6, padding: '7px 9px', color: '#e2e8f0', fontFamily: 'Share Tech Mono,monospace', fontSize: 11, outline: 'none' }} />
                      <button onClick={() => sendAriaMessage()} disabled={!ariaInput.trim() || ariaStreaming}
                        style={{ padding: '7px 10px', background: ariaInput.trim() && !ariaStreaming ? 'rgba(0,207,255,0.2)' : 'rgba(0,207,255,0.05)', border: '1px solid rgba(0,207,255,0.3)', borderRadius: 6, color: '#00cfff', fontSize: 13, cursor: 'pointer' }}>↑</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Sentinel Alert Banners ── */}
      {sentinelAlerts.length > 0 && (
        <div style={{ position: 'fixed', top: 56, right: 16, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
          {sentinelAlerts.slice(0, 3).map(alert => {
            const col = alert.severity === 'critical' ? '#ef4444' : alert.severity === 'warning' ? '#f59e0b' : '#00cfff'
            return (
              <div key={alert.id} style={{ background: 'rgba(5,10,26,0.97)', border: `1px solid ${col}`, borderRadius: 8, padding: '10px 14px', boxShadow: `0 0 20px ${col}40` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: col, animation: 'pulse 1s infinite', boxShadow: `0 0 8px ${col}` }} />
                  <span style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, color: col }}>SENTINEL — {alert.severity.toUpperCase()}</span>
                  <button onClick={async () => { await fetch('/api/sentinel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'dismiss', alertId: alert.id }) }) }}
                    style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#4a6a8a', cursor: 'pointer', fontSize: 14 }}>✕</button>
                </div>
                <div style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 11, color: '#e2e8f0', marginBottom: 8, lineHeight: 1.4 }}>{alert.summary}</div>
                <button onClick={async () => {
                  const r = await fetch('/api/sentinel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'investigate', alertId: alert.id }) })
                  if (r.ok) { setActiveTab('tasks') }
                }} style={{ padding: '5px 12px', background: `${col}20`, border: `1px solid ${col}`, borderRadius: 4, color: col, fontFamily: 'Orbitron,sans-serif', fontSize: 8, letterSpacing: 1, cursor: 'pointer' }}>
                  INVESTIGATE
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Modals ── */}
      {showCreateTask && (
        <CreateTaskModal agents={agents} onClose={() => setShowCreateTask(false)}
          onCreate={async (data) => {
            const r = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
            if (r.ok) {
              const task = await r.json()
              if ((data as Record<string, unknown>).autoDispatch) {
                await fetch('/api/dispatch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: task.id }) })
              }
              setShowCreateTask(false)
            }
          }} />
      )}
      {showCreateAgent && (
        <CreateAgentModal onClose={() => setShowCreateAgent(false)}
          onCreate={async (data) => {
            const r = await fetch('/api/agents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
            if (r.ok) { setShowCreateAgent(false) }
          }} />
      )}
      {showSettings && (
        <SettingsModal gwConnected={gwConnected} agents={agents} tasks={tasks} onClose={() => setShowSettings(false)} />
      )}
      {showCreateEpic && (
        <CreateEpicModal agents={agents} onClose={() => setShowCreateEpic(false)}
          onCreate={async (data) => {
            const r = await fetch('/api/epics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
            if (r.ok) { setShowCreateEpic(false); setActiveTab('epics') }
          }} />
      )}

    </div>
  )
}

// ─── Station Tab ──────────────────────────────────────────────
function RoomCell({ room, agents, tasks, selectedRoom, onSelectRoom, wide }: {
  room: typeof ROOMS[number]; agents: Agent[]; tasks: Task[]
  selectedRoom: Room | null; onSelectRoom: (r: Room | null) => void; wide?: boolean
}) {
  const col = room.color
  const roomAgents = agents.filter(a => a.room === room.roomField || a.room === room.id)
  const activeTasks = tasks.filter(t => roomAgents.some(a => a.id === t.agent_id) && t.status === 'active').length
  const isSelected = selectedRoom?.id === room.id
  const hasImage = !!(room as { image?: string }).image

  return (
    <div className="room-card" onClick={() => onSelectRoom(isSelected ? null : room)}
      style={{
        position: 'relative', overflow: 'hidden', cursor: 'pointer',
        border: `1px solid ${isSelected ? col : col + '55'}`,
        borderRadius: 8,
        minHeight: wide ? 100 : 155,
        boxShadow: isSelected ? `0 0 24px ${col}50, inset 0 0 30px ${col}18` : `0 2px 12px rgba(0,0,0,0.5)`,
        display: 'flex', flexDirection: 'column',
        background: hasImage ? 'transparent' : `linear-gradient(160deg, rgba(5,10,26,0.97) 0%, ${col}22 100%)`,
      }}>

      {/* Background image */}
      {hasImage && (
        <img
          src={(room as { image?: string }).image}
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', opacity: 0.55 }}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      )}

      {/* Dark overlay so text is readable */}
      <div style={{ position: 'absolute', inset: 0, background: hasImage
        ? `linear-gradient(to bottom, rgba(0,5,18,0.35) 0%, rgba(0,5,18,0.15) 50%, rgba(0,5,18,0.75) 100%)`
        : `linear-gradient(160deg, rgba(5,10,26,0.6) 0%, ${col}10 100%)`,
        pointerEvents: 'none' }} />

      {/* Top accent line */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,transparent,${col},transparent)`, opacity: isSelected ? 1 : 0.6, zIndex: 2 }} />

      {/* Active pulse indicator */}
      {activeTasks > 0 && (
        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 3, display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(0,0,0,0.5)', borderRadius: 10, padding: '2px 6px' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', animation: 'pulse 1.4s infinite', boxShadow: '0 0 8px #22c55e' }} />
          <span style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 8, color: '#22c55e' }}>×{activeTasks}</span>
        </div>
      )}

      {/* Agent dots in the middle of the room */}
      {!wide && roomAgents.length > 0 && (
        <div style={{ flex: 1, position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 10, padding: '8px 8px 4px' }}>
          {roomAgents.slice(0, 6).map(a => {
            const agCol = agentColor(a)
            const isBusy = a.status === 'busy'
            return (
              <div key={a.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <div style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: isBusy ? '#22c55e' : agCol,
                  boxShadow: isBusy ? `0 0 10px #22c55e, 0 0 20px #22c55e60` : `0 0 8px ${agCol}90`,
                  animation: isBusy ? 'pulse 1.8s infinite' : 'none',
                  border: `2px solid ${isBusy ? '#22c55e' : agCol}`,
                  flexShrink: 0,
                }} />
                <span style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 7, color: '#e2e8f0', textShadow: '0 1px 3px rgba(0,0,0,0.9)', whiteSpace: 'nowrap', maxWidth: 48, overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1 }}>{a.name.split(' ')[0].slice(0, 6)}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Footer: room name + dept */}
      <div style={{ position: 'relative', zIndex: 2, padding: wide ? '10px 14px' : '6px 10px', background: 'rgba(0,5,18,0.75)', borderTop: `1px solid ${col}30`, display: 'flex', alignItems: 'center', gap: wide ? 14 : 6, flexShrink: 0 }}>
        <span style={{ fontSize: wide ? 22 : 16, filter: `drop-shadow(0 0 6px ${col})`, flexShrink: 0 }}>{room.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: wide ? 11 : 9, fontWeight: 700, color: '#e2e8f0', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textShadow: isSelected ? `0 0 10px ${col}` : 'none' }}>{room.name}</div>
          <div style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 7, color: col, opacity: 0.8, letterSpacing: 1 }}>{room.dept}</div>
        </div>
        {wide && roomAgents.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {roomAgents.slice(0, 4).map(a => {
              const agCol = agentColor(a); const isBusy = a.status === 'busy'
              return (
                <div key={a.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: isBusy ? '#22c55e' : agCol, boxShadow: isBusy ? '0 0 8px #22c55e' : `0 0 6px ${agCol}90`, animation: isBusy ? 'pulse 1.8s infinite' : 'none', border: `1px solid ${isBusy ? '#22c55e' : agCol}` }} />
                  <span style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 6, color: '#e2e8f0', whiteSpace: 'nowrap' }}>{a.name.split(' ')[0].slice(0, 6)}</span>
                </div>
              )
            })}
          </div>
        )}
        {roomAgents.length === 0 && <span style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 7, color: '#2a4a6a' }}>VACANT</span>}
      </div>
    </div>
  )
}

function Corridor({ vertical, color }: { vertical?: boolean; color?: string }) {
  const c = color ?? 'rgba(0,207,255,0.15)'
  return vertical
    ? <div style={{ width: 2, background: `linear-gradient(${c}, ${c})`, margin: '0 auto', position: 'relative' }}>
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 6, height: 6, borderRadius: '50%', background: c, boxShadow: `0 0 8px ${c}` }} />
      </div>
    : <div style={{ height: 2, background: `linear-gradient(90deg, transparent, ${c}, transparent)`, width: '100%', position: 'relative' }}>
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 6, height: 6, borderRadius: '50%', background: c, boxShadow: `0 0 8px ${c}` }} />
      </div>
}

function StationTab({ rooms, agents, tasks, selectedRoom, onSelectRoom }: {
  rooms: typeof ROOMS; agents: Agent[]; tasks: Task[]
  selectedRoom: Room | null; onSelectRoom: (r: Room | null) => void
}) {
  const topRow    = rooms.filter(r => ['radar', 'media', 'comm', 'factory'].includes(r.id))
  const bottomRow = rooms.filter(r => ['factory2', 'war', 'treasury', 'armory'].includes(r.id))
  const cmdRoom   = rooms.find(r => r.id === 'command')

  const allRoomAgents = agents.filter(a => a.room === 'command')
  const allActive = tasks.filter(t => t.status === 'active').length
  const totalAgents = agents.length

  const cellProps = { agents, tasks, selectedRoom, onSelectRoom }

  return (
    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', padding: '16px 16px 24px' }}>
      {/* Header stats */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 10, letterSpacing: 4, color: '#4a6a8a' }}>STATION ALPHA — DECK PLAN</div>
        <div style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>
          {[['CREW', totalAgents, '#00cfff'], ['ACTIVE', allActive, '#22c55e'], ['ROOMS', rooms.length, '#8b5cf6']].map(([l, v, c]) => (
            <div key={String(l)} style={{ textAlign: 'center', padding: '4px 10px', background: `${c}0a`, border: `1px solid ${c}25`, borderRadius: 4 }}>
              <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 14, color: String(c) }}>{v}</div>
              <div style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 8, color: '#4a6a8a', letterSpacing: 1 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Blueprint container */}
      <div style={{ minWidth: 480, background: 'rgba(0,10,25,0.6)', border: '1px solid rgba(0,207,255,0.1)', borderRadius: 10, padding: 16, position: 'relative', overflow: 'hidden' }}>
        {/* Blueprint grid overlay */}
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(0,207,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,207,255,0.03) 1px, transparent 1px)', backgroundSize: '32px 32px', pointerEvents: 'none', borderRadius: 10 }} />

        {/* Station label */}
        <div style={{ position: 'absolute', top: 8, left: 12, fontFamily: 'Orbitron,sans-serif', fontSize: 7, letterSpacing: 3, color: 'rgba(0,207,255,0.2)', pointerEvents: 'none' }}>ALPHA-7 BLUEPRINT REV.3</div>

        {/* Top row rooms */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 20 }}>
          {topRow.map(room => <RoomCell key={room.id} room={room} {...cellProps} />)}
        </div>

        {/* Vertical connectors to spine */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, height: 24 }}>
          {topRow.map(room => (
            <div key={room.id} style={{ display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: 2, height: '100%', background: `linear-gradient(${room.color}60, ${room.color}20)` }} />
            </div>
          ))}
        </div>

        {/* Central spine */}
        <div style={{ height: 28, background: 'linear-gradient(90deg, transparent, rgba(0,207,255,0.08), rgba(0,207,255,0.15), rgba(0,207,255,0.08), transparent)', border: '1px solid rgba(0,207,255,0.2)', borderLeft: 'none', borderRight: 'none', borderRadius: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <span style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 7, letterSpacing: 4, color: 'rgba(0,207,255,0.5)' }}>— MAIN CORRIDOR —</span>
          {/* Junction dots */}
          {[0, 25, 50, 75, 100].map(pct => (
            <div key={pct} style={{ position: 'absolute', left: `${pct}%`, top: '50%', transform: 'translate(-50%,-50%)', width: 5, height: 5, borderRadius: '50%', background: 'rgba(0,207,255,0.4)', boxShadow: '0 0 6px rgba(0,207,255,0.4)' }} />
          ))}
        </div>

        {/* Vertical connectors from spine */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, height: 24 }}>
          {bottomRow.map(room => (
            <div key={room.id} style={{ display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: 2, height: '100%', background: `linear-gradient(${room.color}20, ${room.color}60)` }} />
            </div>
          ))}
        </div>

        {/* Bottom row rooms */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {bottomRow.map(room => <RoomCell key={room.id} room={room} {...cellProps} />)}
        </div>

        {/* Command room at center bottom */}
        {cmdRoom && (
          <>
            <div style={{ display: 'flex', justifyContent: 'center', height: 24, marginTop: 0 }}>
              <div style={{ width: 2, height: '100%', background: `linear-gradient(${cmdRoom.color}40, ${cmdRoom.color}80)` }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 8 }}>
              <div />
              <RoomCell room={cmdRoom} {...cellProps} wide />
              <div />
            </div>
          </>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap', paddingLeft: 4 }}>
        {[['● ACTIVE TASK', '#22c55e'], ['● CREW ASSIGNED', '#00cfff'], ['● VACANT', '#2a4a6a']].map(([l, c]) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'Share Tech Mono,monospace', fontSize: 9, color: c }}>{l}</div>
        ))}
      </div>
    </div>
  )
}

// ─── Room Panel ───────────────────────────────────────────────
function RoomPanel({ room, agents, tasks, activity, onClose }: {
  room: Room; agents: Agent[]; tasks: Task[]; activity: ActivityEntry[]; onClose: () => void
}) {
  const col = room.color
  const roomAgents = agents.filter(a => a.room === room.roomField || a.room === room.id)
  const roomTasks = tasks.filter(t => roomAgents.some(a => a.id === t.agent_id))
  const activeTasks = roomTasks.filter(t => t.status === 'active').length
  const roomActivity = activity.filter(e => roomAgents.some(a => a.id === e.agent_id)).slice(0, 5)

  return (
    <div>
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${col}40`, background: `linear-gradient(135deg,${col}18,transparent)`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 3, color: col, marginBottom: 3 }}>{room.dept}</div>
          <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 13, fontWeight: 700, color: col, textShadow: `0 0 10px ${col}60` }}>{room.icon} {room.name}</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#4a6a8a', cursor: 'pointer', fontSize: 16 }}>✕</button>
      </div>
      <div style={{ padding: 12, borderBottom: `1px solid rgba(0,207,255,0.08)` }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {([['ACTIVE', activeTasks, '#22c55e'], ['AGENTS', roomAgents.length, col], ['TOTAL', roomTasks.length, '#00cfff'], ['DONE', roomTasks.filter(t => t.status === 'done').length, '#4a6a8a']] as [string, number, string][]).map(([label, val, c]) => (
            <div key={label} style={{ background: `${c}0a`, border: `1px solid ${c}30`, borderRadius: 4, padding: '8px 6px', textAlign: 'center' }}>
              <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 18, color: c, textShadow: `0 0 8px ${c}60` }}>{val}</div>
              <div style={{ fontSize: 8, color: '#4a6a8a', letterSpacing: 2, fontFamily: 'Share Tech Mono,monospace' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid rgba(0,207,255,0.08)` }}>
        <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, color: '#4a6a8a', marginBottom: 6 }}>CREW</div>
        {roomAgents.length === 0 && <div style={{ fontSize: 11, color: '#2a4a6a' }}>No agents assigned</div>}
        {roomAgents.map(a => (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 0', borderBottom: '1px solid rgba(0,207,255,0.05)' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor(a.status), color: statusColor(a.status), animation: a.status === 'busy' ? 'pulse 1.8s infinite' : 'none' }} />
            <span style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 10, color: col, flex: 1 }}>{a.name}</span>
            <span style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Share Tech Mono,monospace' }}>{a.status}</span>
          </div>
        ))}
      </div>
      <div>
        <div style={{ padding: '8px 14px', fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, color: '#4a6a8a', borderBottom: `1px solid rgba(0,207,255,0.08)` }}>RECENT</div>
        {roomActivity.length === 0 && <div style={{ padding: '8px 14px', fontSize: 11, color: '#2a4a6a' }}>No activity</div>}
        {roomActivity.map((e, i) => (
          <div key={e.id ?? i} style={{ padding: '6px 14px', borderBottom: '1px solid rgba(0,207,255,0.05)' }}>
            <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.summary}</div>
            <div style={{ fontSize: 9, color: '#2a4a6a', marginTop: 1 }}>{new Date(e.created_at).toLocaleTimeString()}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Agent Edit Panel ─────────────────────────────────────────
function AgentPanel({ agent, agents, onClose, onSaved, onDeleted }: {
  agent: Agent; agents: Agent[]
  onClose: () => void; onSaved: (a: Agent) => void; onDeleted: () => void
}) {
  const col = agentColor(agent)
  const [form, setForm] = useState({ name: agent.name, room: agent.room, model_primary: agent.model_primary, soul: agent.soul, github_url: agent.github_url ?? '' })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const field = (k: keyof typeof form, val: string) => setForm(prev => ({ ...prev, [k]: val }))

  async function save() {
    setSaving(true)
    const r = await fetch('/api/agents', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: agent.id, ...form }),
    })
    if (r.ok) { const updated = await r.json(); onSaved(updated) }
    setSaving(false)
  }

  async function del() {
    setDeleting(true)
    await fetch('/api/agents', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: agent.id }) })
    onDeleted()
  }

  const inp = (val: string, onChange: (v: string) => void, placeholder?: string, multiline?: boolean) => {
    const base = { background: 'rgba(0,207,255,0.06)', border: '1px solid rgba(0,207,255,0.2)', borderRadius: 4, color: '#e2e8f0', fontFamily: 'Share Tech Mono,monospace', fontSize: 11, padding: '6px 8px', width: '100%', boxSizing: 'border-box' as const }
    return multiline
      ? <textarea value={val} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={5} style={{ ...base, resize: 'vertical', lineHeight: 1.5 }} />
      : <input value={val} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={base} />
  }

  return (
    <div style={{ padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 3, color: '#4a6a8a', marginBottom: 2 }}>AGENT CONFIG</div>
          <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 14, color: col, textShadow: `0 0 8px ${col}60` }}>{agent.name}</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#4a6a8a', cursor: 'pointer', fontSize: 16 }}>✕</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <label style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Orbitron,sans-serif', letterSpacing: 2, display: 'block', marginBottom: 4 }}>NAME</label>
          {inp(form.name, v => field('name', v), 'Agent name')}
        </div>
        <div>
          <label style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Orbitron,sans-serif', letterSpacing: 2, display: 'block', marginBottom: 4 }}>ROOM</label>
          <select value={form.room} onChange={e => field('room', e.target.value)}
            style={{ background: 'rgba(0,207,255,0.06)', border: '1px solid rgba(0,207,255,0.2)', borderRadius: 4, color: '#e2e8f0', fontFamily: 'Share Tech Mono,monospace', fontSize: 11, padding: '6px 8px', width: '100%' }}>
            {ROOMS.map(r => <option key={r.id} value={r.roomField}>{r.name} ({r.dept})</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Orbitron,sans-serif', letterSpacing: 2, display: 'block', marginBottom: 4 }}>MODEL</label>
          {inp(form.model_primary, v => field('model_primary', v), 'e.g. local-gpu/local-ai')}
        </div>
        <div>
          <label style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Orbitron,sans-serif', letterSpacing: 2, display: 'block', marginBottom: 4 }}>GITHUB</label>
          {inp(form.github_url, v => field('github_url', v), 'https://github.com/...')}
        </div>
        <div>
          <label style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Orbitron,sans-serif', letterSpacing: 2, display: 'block', marginBottom: 4 }}>SOUL / INSTRUCTIONS</label>
          {inp(form.soul, v => field('soul', v), 'System prompt...', true)}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
        <button onClick={save} disabled={saving}
          style={{ flex: 1, padding: '8px', fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, color: '#00cfff', background: 'rgba(0,207,255,0.12)', border: '1px solid rgba(0,207,255,0.4)', borderRadius: 4, cursor: 'pointer' }}>
          {saving ? 'SAVING…' : '✓ SAVE'}
        </button>
        {!confirmDelete
          ? <button onClick={() => setConfirmDelete(true)} style={{ padding: '8px 12px', fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 1, color: '#ef4444', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4, cursor: 'pointer' }}>DEL</button>
          : <button onClick={del} disabled={deleting} style={{ padding: '8px 12px', fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 1, color: '#fff', background: '#ef4444', border: '1px solid #ef4444', borderRadius: 4, cursor: 'pointer' }}>{deleting ? '…' : 'CONFIRM'}</button>
        }
      </div>

      <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(0,207,255,0.03)', border: '1px solid rgba(0,207,255,0.1)', borderRadius: 4 }}>
        <div style={{ fontSize: 9, color: '#2a4a6a', fontFamily: 'Share Tech Mono,monospace' }}>ID: {agent.id}</div>
        <div style={{ fontSize: 9, color: '#2a4a6a', fontFamily: 'Share Tech Mono,monospace', marginTop: 2 }}>OPENCLAW: {agent.openclaw_id}</div>
        <div style={{ fontSize: 9, color: '#2a4a6a', fontFamily: 'Share Tech Mono,monospace', marginTop: 2 }}>STATUS: <span style={{ color: statusColor(agent.status) }}>{agent.status}</span></div>
      </div>
    </div>
  )
}

// ─── Task Detail Panel ────────────────────────────────────────
function TaskDetailPanel({ task, agents, steps = [], fileVersion = 0, onClose, onDispatch, onDelete }: {
  task: Task; agents: Agent[]
  steps?: Array<{ step: number; type: string; content: string }>
  fileVersion?: number
  onClose: () => void; onDispatch: () => void; onDelete: () => void
}) {
  const agent = agents.find(a => a.id === task.agent_id)
  const col = agent ? agentColor(agent) : '#00cfff'
  const statusCol = taskStatusColor(task.status)
  const [dispatching, setDispatching] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showSteps, setShowSteps] = useState(true)
  const [unblockAnswer, setUnblockAnswer] = useState('')

  async function unblockTask(taskId: string, answer: string) {
    if (!answer.trim()) return
    await fetch('/api/tasks/' + taskId + '/unblock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer }) })
    setUnblockAnswer('')
  }
  const [taskFiles, setTaskFiles] = useState<WorkspaceFile[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [previewContent, setPreviewContent] = useState<string | null>(null)

  async function refreshTaskFiles() {
    setLoadingFiles(true)
    try {
      const r = await fetch(`/api/files?taskId=${task.id}`)
      const data = await r.json() as WorkspaceFile[]
      setTaskFiles(Array.isArray(data) ? data : [])
    } catch {} finally { setLoadingFiles(false) }
  }

  // Auto-load on open, and whenever agent writes a new file
  useEffect(() => { refreshTaskFiles() }, [task.id, fileVersion])  // eslint-disable-line react-hooks/exhaustive-deps

  async function togglePreview(f: WorkspaceFile) {
    if (previewPath === f.path) { setPreviewPath(null); setPreviewContent(null); return }
    setPreviewPath(f.path)
    const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
    const isImg = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)
    if (isImg) { setPreviewContent(null); return }  // images use <img> src
    setPreviewContent('Loading…')
    try {
      const r = await fetch(`/api/files/view?path=${encodeURIComponent(`${task.id}/${f.path}`)}`)
      if (!r.ok) { setPreviewContent(`Error ${r.status}`); return }
      const text = await r.text()
      setPreviewContent(text.slice(0, 20000))
    } catch (e) { setPreviewContent(`Failed: ${String(e)}`) }
  }

  const stepIcon = (t: string) => ({ agent_response: '🤖', tool_call: '⚙️', tool_result: '✅', tool_error: '❌', nudge: '💬', complete: '🏁' }[t] ?? '•')
  const stepCol = (t: string) => ({ agent_response: '#94a3b8', tool_call: '#f59e0b', tool_result: '#22c55e', tool_error: '#ef4444', nudge: '#4a6a8a', complete: '#00cfff' }[t] ?? '#4a6a8a')

  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 3, color: '#4a6a8a', marginBottom: 3 }}>TASK DETAIL</div>
          <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 12, color: '#e2e8f0', lineHeight: 1.4, wordBreak: 'break-word' }}>{task.title}</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#4a6a8a', cursor: 'pointer', fontSize: 16, flexShrink: 0, marginLeft: 8 }}>✕</button>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 10, background: `${statusCol}20`, border: `1px solid ${statusCol}50`, color: statusCol, fontFamily: 'Share Tech Mono,monospace', letterSpacing: 1 }}>{task.status.toUpperCase()}</span>
        <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 10, background: `${priorityColor(task.priority)}20`, border: `1px solid ${priorityColor(task.priority)}50`, color: priorityColor(task.priority), fontFamily: 'Share Tech Mono,monospace', letterSpacing: 1 }}>{task.priority.toUpperCase()}</span>
        {agent && <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 10, background: `${col}20`, border: `1px solid ${col}50`, color: col, fontFamily: 'Share Tech Mono,monospace' }}>{agent.name}{agent.type && agent.type !== 'general' ? ` · ${agent.type.toUpperCase()}` : ''}</span>}
        {!!task.step_count && <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 10, background: 'rgba(0,207,255,0.1)', border: '1px solid rgba(0,207,255,0.3)', color: '#00cfff', fontFamily: 'Share Tech Mono,monospace' }}>STEP {task.step_count}</span>}
        {task.current_tool && <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 10, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', fontFamily: 'Share Tech Mono,monospace', animation: 'pulse 1.5s infinite' }}>⚙ {task.current_tool}</span>}
        {task.confidence != null && (() => { const cb = confidenceBadge(task.confidence!); return <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 10, background: `${cb.color}18`, border: `1px solid ${cb.color}50`, color: cb.color, fontFamily: 'Share Tech Mono,monospace' }}>◎ {cb.label}</span> })()}
      </div>

      {task.status === 'active' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'rgba(0,207,255,0.04)', border: '1px solid rgba(0,207,255,0.15)', borderRadius: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', animation: 'pulse 1.2s infinite', flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: '#22c55e', fontFamily: 'Share Tech Mono,monospace' }}>
            {task.current_tool ? `Running ${task.current_tool}…` : `Agent working — step ${task.step_count ?? 0}`}
          </span>
        </div>
      )}

      {task.status === 'reviewing' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#8b5cf6', animation: 'pulse 1.2s infinite', flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: '#a78bfa', fontFamily: 'Share Tech Mono,monospace' }}>Under review by ECHO…</span>
        </div>
      )}

      {task.status === 'blocked' && (
        <div style={{ padding: '10px 12px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 6 }}>
          <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, color: '#f59e0b', marginBottom: 6 }}>⚠ BLOCKED — WAITING FOR INPUT</div>
          <div style={{ fontSize: 11, color: '#fcd34d', fontFamily: 'Share Tech Mono,monospace', marginBottom: 10, lineHeight: 1.5 }}>{task.blocked_reason}</div>
          <textarea value={unblockAnswer} onChange={e => setUnblockAnswer(e.target.value)}
            placeholder="Your answer…"
            style={{ width: '100%', minHeight: 70, padding: '8px 10px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 4, color: '#e2e8f0', fontFamily: 'Share Tech Mono,monospace', fontSize: 11, boxSizing: 'border-box', resize: 'vertical' }} />
          <button onClick={() => unblockTask(task.id, unblockAnswer)} disabled={!unblockAnswer.trim()}
            style={{ marginTop: 8, padding: '6px 14px', background: unblockAnswer.trim() ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.04)', border: `1px solid ${unblockAnswer.trim() ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.1)'}`, borderRadius: 4, color: unblockAnswer.trim() ? '#f59e0b' : '#2a4a6a', fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, cursor: unblockAnswer.trim() ? 'pointer' : 'not-allowed' }}>
            UNBLOCK & RESUME
          </button>
        </div>
      )}

      {task.critique && (
        <div style={{ padding: '8px 10px', background: 'rgba(139,92,246,0.04)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 4 }}>
          <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, color: '#8b5cf6', marginBottom: 4 }}>ECHO REVIEW</div>
          <div style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'Share Tech Mono,monospace', lineHeight: 1.5 }}>{task.critique}</div>
        </div>
      )}

      {task.success_criteria && (
        <div style={{ padding: '6px 10px', background: 'rgba(34,197,94,0.04)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: 4 }}>
          <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 8, letterSpacing: 2, color: '#22c55e', marginBottom: 3 }}>SUCCESS CRITERIA</div>
          <div style={{ fontSize: 10, color: '#86efac', fontFamily: 'Share Tech Mono,monospace' }}>{task.success_criteria}</div>
        </div>
      )}

      {task.description && task.description !== task.title && (
        <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.5, borderTop: '1px solid rgba(0,207,255,0.08)', paddingTop: 8 }}>{task.description}</div>
      )}

      {steps.length > 0 && (
        <div>
          <button onClick={() => setShowSteps(p => !p)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, padding: 0 }}>
            <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, color: '#00cfff' }}>REASONING LOG ({steps.length} steps)</div>
            <span style={{ fontSize: 9, color: '#4a6a8a' }}>{showSteps ? '▲' : '▼'}</span>
          </button>
          {showSteps && (
            <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {steps.map(s => (
                <div key={s.step} style={{ display: 'flex', gap: 6, padding: '5px 8px', background: 'rgba(0,207,255,0.02)', border: `1px solid ${stepCol(s.type)}20`, borderRadius: 4 }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>{stepIcon(s.type)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 8, color: stepCol(s.type), fontFamily: 'Orbitron,sans-serif', letterSpacing: 1, marginBottom: 2 }}>STEP {s.step} · {s.type.replace(/_/g, ' ').toUpperCase()}</div>
                    <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.4, wordBreak: 'break-word', maxHeight: 60, overflow: 'hidden' }}>{s.content.slice(0, 200)}{s.content.length > 200 ? '…' : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {task.result && (
        <div>
          <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, color: '#22c55e', marginBottom: 5 }}>RESULT</div>
          <div style={{ background: 'rgba(34,197,94,0.04)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: 4, padding: '8px 10px', fontSize: 11, color: '#86efac', lineHeight: 1.6, maxHeight: 150, overflowY: 'auto', fontFamily: 'Share Tech Mono,monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{task.result}</div>
        </div>
      )}
      {task.error && (
        <div>
          <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, color: '#ef4444', marginBottom: 5 }}>ERROR</div>
          <div style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 4, padding: '8px 10px', fontSize: 11, color: '#fca5a5', lineHeight: 1.6, maxHeight: 100, overflowY: 'auto', fontFamily: 'Share Tech Mono,monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{task.error}</div>
        </div>
      )}

      <div style={{ fontSize: 9, color: '#2a4a6a', fontFamily: 'Share Tech Mono,monospace' }}>Created: {new Date(task.created_at).toLocaleString()}</div>

      {/* Files section — auto-loads on open + live-refreshes on file_saved events */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, color: '#4a6a8a', flex: 1 }}>
            OUTPUT FILES{taskFiles.length > 0 ? ` (${taskFiles.length})` : ''}
          </div>
          {loadingFiles && <span style={{ fontSize: 9, color: '#2a4a6a', fontFamily: 'Share Tech Mono,monospace' }}>refreshing…</span>}
          <button onClick={refreshTaskFiles} disabled={loadingFiles}
            style={{ background: 'none', border: 'none', color: loadingFiles ? '#2a4a6a' : '#4a6a8a', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }} title="Refresh files">↺</button>
        </div>
        {!loadingFiles && taskFiles.length === 0 ? (
          <div style={{ fontSize: 10, color: '#2a4a6a', fontFamily: 'Share Tech Mono,monospace', padding: '2px 0' }}>No output files yet</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {taskFiles.map(f => {
              const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
              const isImg = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)
              const isText = ['txt', 'md', 'json', 'js', 'ts', 'tsx', 'py', 'css', 'html', 'htm', 'csv', 'log', 'yaml', 'yml', 'sh', 'sql'].includes(ext)
              const canPreview = isImg || isText
              const fullPath = `${task.id}/${f.path}`
              const isPreviewing = previewPath === f.path
              const icon = isImg ? '🖼' : ext === 'pdf' ? '📋' : isText ? '📄' : '📦'
              const sizeStr = f.size < 1024 ? `${f.size}b` : f.size < 1048576 ? `${(f.size / 1024).toFixed(1)}k` : `${(f.size / 1048576).toFixed(1)}M`
              return (
                <div key={f.path}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 7px', background: isPreviewing ? 'rgba(0,207,255,0.06)' : 'rgba(0,207,255,0.02)', border: `1px solid ${isPreviewing ? 'rgba(0,207,255,0.2)' : 'rgba(0,207,255,0.07)'}`, borderRadius: isPreviewing ? '4px 4px 0 0' : 4 }}>
                    <span style={{ fontSize: 11, flexShrink: 0 }}>{icon}</span>
                    <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'Share Tech Mono,monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.path}>{f.name}</span>
                    <span style={{ fontSize: 9, color: '#2a4a6a', fontFamily: 'Share Tech Mono,monospace', flexShrink: 0 }}>{sizeStr}</span>
                    {canPreview && (
                      <button onClick={() => togglePreview(f)}
                        style={{ fontSize: 8, padding: '1px 6px', background: isPreviewing ? 'rgba(0,207,255,0.15)' : 'rgba(0,207,255,0.05)', border: '1px solid rgba(0,207,255,0.2)', borderRadius: 3, color: '#00cfff', cursor: 'pointer', fontFamily: 'Orbitron,sans-serif', letterSpacing: 1, flexShrink: 0 }}>
                        {isPreviewing ? 'CLOSE' : 'VIEW'}
                      </button>
                    )}
                    <a href={`/api/files/download?path=${encodeURIComponent(fullPath)}`} download={f.name}
                      style={{ fontSize: 9, padding: '1px 6px', background: 'rgba(0,207,255,0.08)', border: '1px solid rgba(0,207,255,0.18)', borderRadius: 3, color: '#64748b', textDecoration: 'none', fontFamily: 'Orbitron,sans-serif', letterSpacing: 1, flexShrink: 0 }}>↓</a>
                  </div>
                  {isPreviewing && (
                    <div style={{ borderRadius: '0 0 4px 4px', border: '1px solid rgba(0,207,255,0.2)', borderTop: 'none', background: 'rgba(0,0,0,0.5)', maxHeight: 260, overflowY: 'auto' }}>
                      {isImg
                        ? <img src={`/api/files/view?path=${encodeURIComponent(fullPath)}`} alt={f.name} style={{ maxWidth: '100%', display: 'block' }} />
                        : <pre style={{ margin: 0, padding: '8px 10px', fontSize: 9, color: '#94a3b8', fontFamily: 'Share Tech Mono,monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>
                            {previewContent ?? ''}
                          </pre>
                      }
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        {(task.status === 'backlog' || task.status === 'failed') && (
          <button onClick={async () => { setDispatching(true); await onDispatch(); setDispatching(false) }} disabled={dispatching}
            style={{ flex: 1, padding: '7px', fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 1, color: '#22c55e', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: 4, cursor: 'pointer' }}>
            {dispatching ? 'DISPATCHING…' : '▶ DISPATCH'}
          </button>
        )}
        {!confirmDelete
          ? <button onClick={() => setConfirmDelete(true)} style={{ padding: '7px 10px', fontFamily: 'Orbitron,sans-serif', fontSize: 9, color: '#ef4444', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4, cursor: 'pointer' }}>DEL</button>
          : <button onClick={onDelete} style={{ padding: '7px 10px', fontFamily: 'Orbitron,sans-serif', fontSize: 9, color: '#fff', background: '#ef4444', border: 'none', borderRadius: 4, cursor: 'pointer' }}>CONFIRM</button>}
      </div>
    </div>
  )
}

// ─── Agents Tab ───────────────────────────────────────────────
function AgentsTab({ agents, tasks, onSelectAgent }: { agents: Agent[]; tasks: Task[]; onSelectAgent: (a: Agent) => void }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
      <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 10, letterSpacing: 4, color: '#4a6a8a', marginBottom: 16 }}>AGENT ROSTER</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))', gap: 12 }}>
        {agents.map(a => {
          const col = agentColor(a)
          const dept = agentDept(a)
          const isActive = a.status === 'busy'
          const aTask = tasks.find(t => t.agent_id === a.id && t.status === 'active')
          return (
            <div key={a.id} onClick={() => onSelectAgent(a)}
              style={{ background: `linear-gradient(135deg,rgba(5,10,26,0.9),${col}12)`, border: `1px solid ${col}50`, borderRadius: 8, padding: 16, boxShadow: isActive ? `0 0 16px ${col}30` : 'none', transition: 'all 0.2s', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: `${col}25`, border: `2px solid ${col}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Orbitron,sans-serif', fontSize: 14, fontWeight: 700, color: col, boxShadow: isActive ? `0 0 12px ${col}60` : 'none' }}>
                  {a.name[0]}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 12, color: col, textShadow: isActive ? `0 0 8px ${col}` : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                  <div style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Share Tech Mono,monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.model_primary.split('/').pop()?.slice(0, 18)}</div>
                </div>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor(a.status), color: statusColor(a.status), animation: isActive ? 'pulse 1.8s infinite' : 'none', flexShrink: 0 }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: aTask ? 6 : 0 }}>
                <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 3, background: `${col}20`, border: `1px solid ${col}40`, color: col, fontFamily: 'Share Tech Mono,monospace', letterSpacing: 1 }}>{dept}</span>
                <span style={{ fontSize: 9, color: statusColor(a.status), fontFamily: 'Share Tech Mono,monospace' }}>{a.status}</span>
              </div>
              {aTask && (
                <div style={{ fontSize: 10, color: '#22c55e', fontFamily: 'Share Tech Mono,monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderTop: '1px solid rgba(0,207,255,0.08)', paddingTop: 6 }}>
                  ▶ {aTask.title.slice(0, 28)}
                </div>
              )}
            </div>
          )
        })}
        {agents.length === 0 && <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 60, color: '#2a4a6a', fontFamily: 'Orbitron,sans-serif', fontSize: 12 }}>NO AGENTS ONLINE</div>}
      </div>
    </div>
  )
}

// ─── Tasks Tab ────────────────────────────────────────────────
function TasksTab({ tasks, agents, onSelectTask, selectedTaskId, onNewTask, onDispatch, onDelete, onStatusChange }: {
  tasks: Task[]; agents: Agent[]
  onSelectTask: (t: Task) => void; selectedTaskId?: string
  onNewTask: () => void
  onDispatch: (id: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onStatusChange: (id: string, status: string) => Promise<void>
}) {
  const [filter, setFilter] = useState<string>('all')
  const statuses: Array<{ key: Task['status']; label: string; color: string }> = [
    { key: 'active',  label: 'ACTIVE',  color: '#22c55e' },
    { key: 'backlog', label: 'BACKLOG', color: '#4a6a8a' },
    { key: 'done',    label: 'DONE',    color: '#00cfff' },
    { key: 'failed',  label: 'FAILED',  color: '#ef4444' },
  ]
  const filtered = filter === 'all' ? tasks : tasks.filter(t => t.status === filter)
  const counts = Object.fromEntries(statuses.map(s => [s.key, tasks.filter(t => t.status === s.key).length]))

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(0,207,255,0.1)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button onClick={onNewTask}
          style={{ padding: '7px 14px', fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, color: '#00cfff', background: 'rgba(0,207,255,0.12)', border: '1px solid rgba(0,207,255,0.4)', borderRadius: 4, cursor: 'pointer', boxShadow: '0 0 8px rgba(0,207,255,0.2)' }}>
          + NEW TASK
        </button>
        <div style={{ display: 'flex', gap: 4 }}>
          {[{ key: 'all', label: 'ALL', color: '#4a6a8a' }, ...statuses].map(s => (
            <button key={s.key} onClick={() => setFilter(s.key)} className="btn-action"
              style={{ padding: '4px 10px', fontFamily: 'Orbitron,sans-serif', fontSize: 8, letterSpacing: 1, color: filter === s.key ? s.color : '#4a6a8a', background: filter === s.key ? `${s.color}18` : 'transparent', border: `1px solid ${filter === s.key ? s.color + '60' : 'rgba(0,207,255,0.1)'}`, borderRadius: 3, cursor: 'pointer' }}>
              {s.label} {s.key !== 'all' ? `(${counts[s.key] ?? 0})` : `(${tasks.length})`}
            </button>
          ))}
        </div>
      </div>

      {/* Task list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60, color: '#2a4a6a' }}>
            <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 11, letterSpacing: 2 }}>NO TASKS</div>
          </div>
        )}
        {filtered.map(task => {
          const agent = agents.find(a => a.id === task.agent_id)
          const col = agent ? agentColor(agent) : '#00cfff'
          const statusCol = taskStatusColor(task.status)
          const isSelected = task.id === selectedTaskId
          return (
            <div key={task.id} className="task-row"
              onClick={() => onSelectTask(task)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', marginBottom: 4, borderRadius: 6, background: isSelected ? 'rgba(0,207,255,0.06)' : 'rgba(5,10,26,0.6)', border: `1px solid ${isSelected ? 'rgba(0,207,255,0.3)' : 'rgba(0,207,255,0.08)'}` }}>
              {/* Status dot */}
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusCol, color: statusCol, flexShrink: 0, animation: task.status === 'active' ? 'pulse 1.5s infinite' : 'none', boxShadow: task.status === 'active' ? `0 0 6px ${statusCol}` : 'none' }} />
              {/* Title */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 12, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
                <div style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Share Tech Mono,monospace', marginTop: 2 }}>
                  {agent ? <span style={{ color: col }}>{agent.name}</span> : 'unassigned'}
                  <span style={{ marginLeft: 8 }}>{new Date(task.created_at).toLocaleDateString()}</span>
                </div>
              </div>
              {/* Priority */}
              <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 2, background: `${priorityColor(task.priority)}18`, border: `1px solid ${priorityColor(task.priority)}40`, color: priorityColor(task.priority), fontFamily: 'Share Tech Mono,monospace', flexShrink: 0 }}>
                {task.priority.toUpperCase()}
              </span>
              {/* Quick actions */}
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                {(task.status === 'backlog' || task.status === 'failed') && (
                  <button className="btn-action" onClick={() => onDispatch(task.id)}
                    style={{ padding: '3px 7px', fontFamily: 'Orbitron,sans-serif', fontSize: 8, color: '#22c55e', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 3, cursor: 'pointer' }}>▶</button>
                )}
                {task.status === 'active' && (
                  <button className="btn-action" onClick={() => onStatusChange(task.id, 'backlog')}
                    style={{ padding: '3px 7px', fontFamily: 'Orbitron,sans-serif', fontSize: 8, color: '#eab308', background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', borderRadius: 3, cursor: 'pointer' }}>■</button>
                )}
                <button className="btn-action" onClick={() => onDelete(task.id)}
                  style={{ padding: '3px 6px', fontSize: 10, color: '#ef4444', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 3, cursor: 'pointer' }}>×</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Comms Tab ────────────────────────────────────────────────
function CommsTab({ activity, agents }: { activity: ActivityEntry[]; agents: Agent[] }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
      <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 10, letterSpacing: 4, color: '#4a6a8a', marginBottom: 16 }}>TRANSMISSION LOG — {activity.length} ENTRIES</div>
      <div style={{ background: 'rgba(5,10,26,0.9)', border: '1px solid rgba(0,207,255,0.15)', borderRadius: 8 }}>
        {[...activity].reverse().map((e, i) => {
          const ag = agents.find(a => a.id === e.agent_id)
          const col = ag ? agentColor(ag) : '#00cfff'
          const isErr = e.type.includes('fail') || e.type.includes('error')
          const isOk = e.type.includes('complet') || e.type.includes('creat')
          return (
            <div key={e.id ?? i} style={{ display: 'flex', gap: 10, padding: '8px 14px', borderBottom: '1px solid rgba(0,207,255,0.05)' }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: `${col}25`, border: `1px solid ${col}60`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontFamily: 'Orbitron,sans-serif', color: col, flexShrink: 0 }}>
                {ag ? ag.name[0] : '⚡'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 2 }}>
                  <span style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 10, color: col }}>{ag?.name ?? 'SYSTEM'}</span>
                  <span style={{ fontSize: 9, color: '#2a4a6a', fontFamily: 'Share Tech Mono,monospace' }}>{new Date(e.created_at).toLocaleTimeString()}</span>
                  <span style={{ fontSize: 8, padding: '0 4px', border: '1px solid rgba(0,207,255,0.15)', color: '#4a6a8a', borderRadius: 2, fontFamily: 'Share Tech Mono,monospace' }}>{e.type}</span>
                </div>
                <div style={{ fontSize: 11, color: isErr ? '#ef4444' : isOk ? '#22c55e' : '#94a3b8', lineHeight: 1.5, wordBreak: 'break-word' }}>{e.summary}</div>
              </div>
            </div>
          )
        })}
        {activity.length === 0 && <div style={{ padding: '40px', textAlign: 'center', color: '#2a4a6a', fontFamily: 'Orbitron,sans-serif', fontSize: 12 }}>NO TRANSMISSIONS</div>}
      </div>
    </div>
  )
}

// ─── Skills Tab ───────────────────────────────────────────────
interface Skill {
  id: string; name: string; description: string; type: string
  config: Record<string, unknown>; enabled: number; created_at: number
}

function SkillsTab() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', type: 'web_search', config: '' })
  const [testResult, setTestResult] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch('/api/skills').then(r => r.json()).then(d => { setSkills(Array.isArray(d) ? d : []); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const toggle = async (s: Skill) => {
    await fetch(`/api/skills/${s.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !s.enabled }) })
    setSkills(prev => prev.map(x => x.id === s.id ? { ...x, enabled: x.enabled ? 0 : 1 } : x))
  }

  const deleteSkill = async (id: string) => {
    if (!confirm('Delete this skill?')) return
    await fetch(`/api/skills/${id}`, { method: 'DELETE' })
    setSkills(prev => prev.filter(x => x.id !== id))
  }

  const addSkill = async () => {
    let config: Record<string, unknown> = {}
    try { if (form.config) config = JSON.parse(form.config) } catch { alert('Invalid JSON in config'); return }
    const r = await fetch('/api/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.name, description: form.description, type: form.type, config }) })
    const s = await r.json() as Skill
    setSkills(prev => [...prev, s])
    setShowAdd(false)
    setForm({ name: '', description: '', type: 'web_search', config: '' })
  }

  const testSkill = async (s: Skill) => {
    setTestResult(prev => ({ ...prev, [s.id]: 'Testing…' }))
    const body = s.type === 'web_search' ? { tool: 'search', args: { query: 'test query hello world' } }
      : { tool: 'ping', args: {} }
    const r = await fetch(`/api/skills/${s.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await r.json() as { ok: boolean; result?: string; error?: string }
    setTestResult(prev => ({ ...prev, [s.id]: d.ok ? `✓ ${String(d.result ?? '').slice(0, 100)}` : `✗ ${d.error ?? 'failed'}` }))
  }

  const skillTypeLabel = (t: string) => ({ web_search: '🔍 Web Search', mcp_http: '🔌 MCP Server', builtin: '⚡ Built-in' }[t] ?? t)

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 10, letterSpacing: 4, color: '#4a6a8a' }}>SKILLS REGISTRY</div>
          <div style={{ fontSize: 10, color: '#2a4a6a', fontFamily: 'Share Tech Mono,monospace', marginTop: 2 }}>Tools available to agents and ARIA</div>
        </div>
        <button onClick={() => setShowAdd(p => !p)} style={{ padding: '6px 14px', fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, color: '#00cfff', background: 'rgba(0,207,255,0.1)', border: '1px solid rgba(0,207,255,0.3)', borderRadius: 4, cursor: 'pointer' }}>
          {showAdd ? 'CANCEL' : '+ ADD SKILL'}
        </button>
      </div>

      {showAdd && (
        <div style={{ background: 'rgba(0,207,255,0.04)', border: '1px solid rgba(0,207,255,0.2)', borderRadius: 8, padding: 16, marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, color: '#00cfff', marginBottom: 4 }}>NEW SKILL</div>
          {([
            { label: 'Name', key: 'name', placeholder: 'e.g. Brave Search' },
            { label: 'Description', key: 'description', placeholder: 'What this skill does' },
          ] as const).map(f => (
            <div key={f.key}>
              <div style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Orbitron,sans-serif', letterSpacing: 1, marginBottom: 4 }}>{f.label}</div>
              <input value={form[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.placeholder}
                style={{ width: '100%', background: 'rgba(0,207,255,0.06)', border: '1px solid rgba(0,207,255,0.2)', borderRadius: 4, padding: '6px 8px', color: '#e2e8f0', fontFamily: 'Share Tech Mono,monospace', fontSize: 11, boxSizing: 'border-box' }} />
            </div>
          ))}
          <div>
            <div style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Orbitron,sans-serif', letterSpacing: 1, marginBottom: 4 }}>TYPE</div>
            <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}
              style={{ background: 'rgba(0,207,255,0.06)', border: '1px solid rgba(0,207,255,0.2)', borderRadius: 4, padding: '6px 8px', color: '#e2e8f0', fontFamily: 'Share Tech Mono,monospace', fontSize: 11, width: '100%' }}>
              <option value="web_search">🔍 Web Search (DuckDuckGo)</option>
              <option value="mcp_http">🔌 MCP Server (HTTP)</option>
            </select>
          </div>
          {form.type === 'mcp_http' && (
            <div>
              <div style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Orbitron,sans-serif', letterSpacing: 1, marginBottom: 4 }}>CONFIG (JSON)</div>
              <textarea value={form.config} onChange={e => setForm(p => ({ ...p, config: e.target.value }))}
                placeholder={'{"url": "http://localhost:3001", "apiKey": "optional"}'}
                style={{ width: '100%', height: 80, background: 'rgba(0,207,255,0.06)', border: '1px solid rgba(0,207,255,0.2)', borderRadius: 4, padding: '6px 8px', color: '#e2e8f0', fontFamily: 'Share Tech Mono,monospace', fontSize: 10, boxSizing: 'border-box', resize: 'vertical' }} />
              <div style={{ fontSize: 9, color: '#2a4a6a', marginTop: 4, fontFamily: 'Share Tech Mono,monospace' }}>MCP server must expose POST /call with body: {'{tool, arguments}'}</div>
            </div>
          )}
          <button onClick={addSkill} disabled={!form.name}
            style={{ padding: '8px', fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, color: '#22c55e', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: 4, cursor: 'pointer' }}>
            REGISTER SKILL
          </button>
        </div>
      )}

      {loading && <div style={{ color: '#4a6a8a', fontFamily: 'Share Tech Mono,monospace', fontSize: 12, padding: 20 }}>Loading skills…</div>}

      {!loading && skills.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Orbitron,sans-serif', letterSpacing: 2 }}>NO SKILLS REGISTERED</div>
          <div style={{ fontSize: 10, color: '#2a4a6a', fontFamily: 'Share Tech Mono,monospace', marginTop: 8 }}>Add skills to extend what agents and ARIA can do</div>
        </div>
      )}

      {skills.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {skills.map(s => (
            <div key={s.id} style={{ background: s.enabled ? 'rgba(0,207,255,0.04)' : 'rgba(0,0,0,0.2)', border: `1px solid ${s.enabled ? 'rgba(0,207,255,0.2)' : 'rgba(255,255,255,0.05)'}`, borderRadius: 8, padding: 14, opacity: s.enabled ? 1 : 0.5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 11, color: s.enabled ? '#e2e8f0' : '#4a6a8a', marginBottom: 3 }}>{s.name}</div>
                  <div style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Share Tech Mono,monospace' }}>{skillTypeLabel(s.type)}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => testSkill(s)} style={{ fontSize: 9, padding: '3px 8px', background: 'rgba(0,207,255,0.08)', border: '1px solid rgba(0,207,255,0.2)', borderRadius: 3, color: '#00cfff', cursor: 'pointer', fontFamily: 'Orbitron,sans-serif', letterSpacing: 1 }}>TEST</button>
                  <button onClick={() => toggle(s)} style={{ fontSize: 9, padding: '3px 8px', background: s.enabled ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.05)', border: `1px solid ${s.enabled ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.1)'}`, borderRadius: 3, color: s.enabled ? '#22c55e' : '#4a6a8a', cursor: 'pointer', fontFamily: 'Orbitron,sans-serif', letterSpacing: 1 }}>{s.enabled ? 'ON' : 'OFF'}</button>
                  <button onClick={() => deleteSkill(s.id)} style={{ fontSize: 9, padding: '3px 8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 3, color: '#ef4444', cursor: 'pointer' }}>✕</button>
                </div>
              </div>
              {s.description && <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.4, marginBottom: 6, fontFamily: 'Share Tech Mono,monospace' }}>{s.description}</div>}
              {s.type === 'mcp_http' && !!s.config.url && <div style={{ fontSize: 9, color: '#2a4a6a', fontFamily: 'Share Tech Mono,monospace' }}>URL: {s.config.url as string}</div>}
              {testResult[s.id] && <div style={{ marginTop: 8, fontSize: 10, color: testResult[s.id].startsWith('✓') ? '#22c55e' : '#ef4444', fontFamily: 'Share Tech Mono,monospace', padding: '4px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: 4 }}>{testResult[s.id]}</div>}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 24, padding: 14, background: 'rgba(0,207,255,0.02)', border: '1px solid rgba(0,207,255,0.08)', borderRadius: 6 }}>
        <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, color: '#4a6a8a', marginBottom: 8 }}>BUILT-IN SKILLS</div>
        {[
          { name: 'web_search', desc: 'DuckDuckGo instant answers', status: 'active' },
          { name: 'run_python', desc: 'Execute Python 3 code', status: 'active' },
          { name: 'write_file', desc: 'Write files to task workspace', status: 'active' },
          { name: 'read_file', desc: 'Read files from task workspace', status: 'active' },
          { name: 'remember / recall', desc: 'Persistent agent memory', status: 'active' },
          { name: 'spawn_task', desc: 'Create subtasks from agents', status: 'active' },
          { name: 'fetch_url', desc: 'Fetch and parse web pages', status: 'active' },
        ].map(t => (
          <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid rgba(0,207,255,0.04)' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
            <span style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 10, color: '#00cfff', width: 160, flexShrink: 0 }}>{t.name}</span>
            <span style={{ fontSize: 10, color: '#4a6a8a', fontFamily: 'Share Tech Mono,monospace' }}>{t.desc}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Files Tab ────────────────────────────────────────────────

function FilesTab({ tasks, agents, refreshKey = 0 }: { tasks: Task[]; agents: Agent[]; refreshKey?: number }) {
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [loading, setLoading] = useState(true)
  const [filterTask, setFilterTask] = useState<string>('all')

  const loadFiles = useCallback(() => {
    setLoading(true)
    const url = filterTask !== 'all' ? `/api/files?taskId=${filterTask}` : '/api/files'
    fetch(url).then(r => r.json()).then(d => { setFiles(Array.isArray(d) ? d : []); setLoading(false) }).catch(() => setLoading(false))
  }, [filterTask])

  useEffect(() => { loadFiles() }, [loadFiles, refreshKey])

  const fmt = (b: number) => b < 1024 ? `${b}B` : b < 1048576 ? `${(b/1024).toFixed(1)}KB` : `${(b/1048576).toFixed(2)}MB`
  const extIcon = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase()
    return ({ html: '🌐', css: '🎨', js: '⚡', ts: '⚡', tsx: '⚡', json: '{}', py: '🐍', md: '📝', txt: '📄', png: '🖼', jpg: '🖼', svg: '🎨', pdf: '📑' } as Record<string, string>)[ext ?? ''] ?? '📦'
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 10, letterSpacing: 4, color: '#4a6a8a' }}>WORKSPACE FILES</div>
        <select value={filterTask} onChange={e => setFilterTask(e.target.value)}
          style={{ background: 'rgba(0,207,255,0.06)', border: '1px solid rgba(0,207,255,0.2)', color: '#94a3b8', fontFamily: 'Share Tech Mono,monospace', fontSize: 11, padding: '4px 8px', borderRadius: 4 }}>
          <option value="all">All tasks</option>
          {tasks.map(t => <option key={t.id} value={t.id}>{t.title.slice(0, 40)}</option>)}
        </select>
        <button onClick={loadFiles} style={{ background: 'rgba(0,207,255,0.1)', border: '1px solid rgba(0,207,255,0.3)', color: '#00cfff', fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 1, padding: '5px 10px', borderRadius: 4, cursor: 'pointer' }}>↻</button>
        <span style={{ fontSize: 10, color: '#4a6a8a', fontFamily: 'Share Tech Mono,monospace', marginLeft: 'auto' }}>{files.length} files</span>
      </div>

      {loading && <div style={{ color: '#4a6a8a', fontFamily: 'Share Tech Mono,monospace', fontSize: 12, padding: 20 }}>Scanning workspace...</div>}

      {!loading && files.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#2a4a6a' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📂</div>
          <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 11, letterSpacing: 2 }}>NO FILES</div>
          <div style={{ fontSize: 11, marginTop: 8, fontFamily: 'Share Tech Mono,monospace' }}>Agents save to /app/workspace/[taskId]/</div>
        </div>
      )}

      {!loading && files.length > 0 && (
        <div style={{ background: 'rgba(5,10,26,0.9)', border: '1px solid rgba(0,207,255,0.15)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto' }}>
            {['FILE', 'TASK', 'SIZE', ''].map(h => (
              <div key={h} style={{ padding: '7px 12px', borderBottom: '1px solid rgba(0,207,255,0.1)', fontFamily: 'Orbitron,sans-serif', fontSize: 8, letterSpacing: 2, color: '#4a6a8a' }}>{h}</div>
            ))}
            {files.map(f => {
              const parts = f.path.split('/')
              const taskId = parts.length > 1 ? parts[0] : undefined
              const task = tasks.find(t => t.id === taskId)
              const agent = task ? agents.find(a => a.id === task.agent_id) : undefined
              const col = agent ? agentColor(agent) : '#00cfff'
              return (
                <>
                  <div key={`n-${f.path}`} className="file-row" style={{ padding: '8px 12px', borderBottom: '1px solid rgba(0,207,255,0.05)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13 }}>{extIcon(f.name)}</span>
                    <div>
                      <div style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 11, color: '#e2e8f0' }}>{f.name}</div>
                      <div style={{ fontSize: 9, color: '#4a6a8a' }}>{f.path}</div>
                    </div>
                  </div>
                  <div key={`t-${f.path}`} className="file-row" style={{ padding: '8px 12px', borderBottom: '1px solid rgba(0,207,255,0.05)', display: 'flex', alignItems: 'center' }}>
                    {task ? (
                      <div>
                        <div style={{ fontSize: 10, color: col, fontFamily: 'Share Tech Mono,monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>{task.title.slice(0, 22)}</div>
                        {agent && <div style={{ fontSize: 9, color: '#4a6a8a' }}>{agent.name}</div>}
                      </div>
                    ) : <span style={{ fontSize: 10, color: '#2a4a6a' }}>—</span>}
                  </div>
                  <div key={`s-${f.path}`} className="file-row" style={{ padding: '8px 12px', borderBottom: '1px solid rgba(0,207,255,0.05)', display: 'flex', alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: '#4a6a8a', fontFamily: 'Share Tech Mono,monospace' }}>{fmt(f.size)}</span>
                  </div>
                  <div key={`d-${f.path}`} className="file-row" style={{ padding: '8px 12px', borderBottom: '1px solid rgba(0,207,255,0.05)', display: 'flex', alignItems: 'center' }}>
                    <a href={`/api/files/download?path=${encodeURIComponent(f.path)}`} download={f.name}
                      style={{ fontSize: 9, padding: '2px 8px', background: 'rgba(0,207,255,0.1)', border: '1px solid rgba(0,207,255,0.3)', borderRadius: 3, color: '#00cfff', textDecoration: 'none', fontFamily: 'Orbitron,sans-serif', letterSpacing: 1 }}>
                      ↓ GET
                    </a>
                  </div>
                </>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Create Task Modal ────────────────────────────────────────
function CreateTaskModal({ agents, onClose, onCreate }: {
  agents: Agent[]
  onClose: () => void
  onCreate: (data: Record<string, unknown>) => Promise<void>
}) {
  const [form, setForm] = useState({ title: '', description: '', agent_id: agents[0]?.id ?? '', priority: 'medium', autoDispatch: false })
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!form.title.trim()) return
    setSaving(true)
    await onCreate({ title: form.title, description: form.description, agent_id: form.agent_id, priority: form.priority, autoDispatch: form.autoDispatch })
    if (form.autoDispatch) {
      // dispatch handled by parent via SSE task_update new task
    }
    setSaving(false)
  }

  const inpStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(0,207,255,0.2)', borderRadius: 6, color: '#e2e8f0', fontFamily: 'Share Tech Mono,monospace', fontSize: 12, padding: '8px 10px', width: '100%', boxSizing: 'border-box' as const }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#080e1f', border: '1px solid rgba(0,207,255,0.25)', borderRadius: 10, padding: 24, width: 440, maxWidth: '90vw', boxShadow: '0 0 40px rgba(0,207,255,0.1)', animation: 'slide-in 0.2s ease-out' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 13, color: '#00cfff', letterSpacing: 2 }}>NEW TASK</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#4a6a8a', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Orbitron,sans-serif', letterSpacing: 2, display: 'block', marginBottom: 5 }}>TITLE *</label>
            <input autoFocus value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && submit()}
              placeholder="What needs to be done?" style={inpStyle} />
          </div>
          <div>
            <label style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Orbitron,sans-serif', letterSpacing: 2, display: 'block', marginBottom: 5 }}>DESCRIPTION</label>
            <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              placeholder="Additional context..." rows={3} style={{ ...inpStyle, resize: 'vertical', lineHeight: 1.5 }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Orbitron,sans-serif', letterSpacing: 2, display: 'block', marginBottom: 5 }}>AGENT</label>
              <select value={form.agent_id} onChange={e => setForm(p => ({ ...p, agent_id: e.target.value }))} style={{ ...inpStyle, padding: '7px 10px' }}>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Orbitron,sans-serif', letterSpacing: 2, display: 'block', marginBottom: 5 }}>PRIORITY</label>
              <select value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))} style={{ ...inpStyle, padding: '7px 10px' }}>
                {['low', 'medium', 'high', 'critical'].map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
              </select>
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.autoDispatch} onChange={e => setForm(p => ({ ...p, autoDispatch: e.target.checked }))}
              style={{ accentColor: '#00cfff' }} />
            <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'Share Tech Mono,monospace' }}>Auto-dispatch after creation</span>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '9px', fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, color: '#4a6a8a', background: 'transparent', border: '1px solid rgba(0,207,255,0.15)', borderRadius: 5, cursor: 'pointer' }}>CANCEL</button>
          <button onClick={submit} disabled={!form.title.trim() || saving}
            style={{ flex: 2, padding: '9px', fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, color: form.title.trim() ? '#00cfff' : '#2a4a6a', background: form.title.trim() ? 'rgba(0,207,255,0.12)' : 'transparent', border: `1px solid ${form.title.trim() ? 'rgba(0,207,255,0.4)' : 'rgba(0,207,255,0.1)'}`, borderRadius: 5, cursor: 'pointer', boxShadow: form.title.trim() ? '0 0 10px rgba(0,207,255,0.15)' : 'none' }}>
            {saving ? 'CREATING…' : '+ CREATE TASK'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Create Agent Modal ───────────────────────────────────────
function CreateAgentModal({ onClose, onCreate }: {
  onClose: () => void; onCreate: (data: Record<string, unknown>) => Promise<void>
}) {
  const [form, setForm] = useState({ name: '', room: 'engineering', model_primary: 'local-gpu/local-ai', soul: '', github_url: '' })
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!form.name.trim()) return
    setSaving(true)
    await onCreate(form)
    setSaving(false)
  }

  const inpStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(0,207,255,0.2)', borderRadius: 6, color: '#e2e8f0', fontFamily: 'Share Tech Mono,monospace', fontSize: 12, padding: '8px 10px', width: '100%', boxSizing: 'border-box' as const }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#080e1f', border: '1px solid rgba(0,207,255,0.25)', borderRadius: 10, padding: 24, width: 440, maxWidth: '90vw', boxShadow: '0 0 40px rgba(0,207,255,0.1)', animation: 'slide-in 0.2s ease-out' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 13, color: '#00cfff', letterSpacing: 2 }}>NEW AGENT</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#4a6a8a', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Orbitron,sans-serif', letterSpacing: 2, display: 'block', marginBottom: 5 }}>NAME *</label>
            <input autoFocus value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="e.g. NOVA" style={inpStyle} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Orbitron,sans-serif', letterSpacing: 2, display: 'block', marginBottom: 5 }}>ROOM</label>
              <select value={form.room} onChange={e => setForm(p => ({ ...p, room: e.target.value }))} style={{ ...inpStyle, padding: '7px 10px' }}>
                {ROOMS.map(r => <option key={r.id} value={r.roomField}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Orbitron,sans-serif', letterSpacing: 2, display: 'block', marginBottom: 5 }}>MODEL</label>
              <input value={form.model_primary} onChange={e => setForm(p => ({ ...p, model_primary: e.target.value }))} style={inpStyle} />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Orbitron,sans-serif', letterSpacing: 2, display: 'block', marginBottom: 5 }}>GITHUB URL</label>
            <input value={form.github_url} onChange={e => setForm(p => ({ ...p, github_url: e.target.value }))} placeholder="https://github.com/..." style={inpStyle} />
          </div>
          <div>
            <label style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Orbitron,sans-serif', letterSpacing: 2, display: 'block', marginBottom: 5 }}>SOUL / INSTRUCTIONS</label>
            <textarea value={form.soul} onChange={e => setForm(p => ({ ...p, soul: e.target.value }))}
              placeholder="System prompt for this agent..." rows={4} style={{ ...inpStyle, resize: 'vertical', lineHeight: 1.5 }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '9px', fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, color: '#4a6a8a', background: 'transparent', border: '1px solid rgba(0,207,255,0.15)', borderRadius: 5, cursor: 'pointer' }}>CANCEL</button>
          <button onClick={submit} disabled={!form.name.trim() || saving}
            style={{ flex: 2, padding: '9px', fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, color: form.name.trim() ? '#00cfff' : '#2a4a6a', background: form.name.trim() ? 'rgba(0,207,255,0.12)' : 'transparent', border: `1px solid ${form.name.trim() ? 'rgba(0,207,255,0.4)' : 'rgba(0,207,255,0.1)'}`, borderRadius: 5, cursor: 'pointer' }}>
            {saving ? 'CREATING…' : '+ RECRUIT AGENT'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Epics Tab ────────────────────────────────────────────────
function EpicsTab({ epics, tasks, agents, loading, onCreateEpic, onDecompose, onDelete }: {
  epics: Epic[]; tasks: Task[]; agents: Agent[]; loading: boolean
  onCreateEpic: () => void; onDecompose: (id: string) => void; onDelete: (id: string) => void
}) {
  const epicColor = (s: string) => ({ planning: '#4a6a8a', active: '#8b5cf6', done: '#22c55e', cancelled: '#ef4444' }[s] ?? '#4a6a8a')

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 10, letterSpacing: 4, color: '#4a6a8a', marginBottom: 4 }}>PRIME DIRECTIVES</div>
          <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 14, color: '#e2e8f0' }}>EPICS — {epics.length} TOTAL</div>
        </div>
        <button onClick={onCreateEpic} style={{ padding: '8px 16px', background: 'rgba(139,92,246,0.2)', border: '1px solid #8b5cf690', borderRadius: 6, color: '#a78bfa', fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, cursor: 'pointer' }}>+ NEW EPIC</button>
      </div>

      {loading && <div style={{ color: '#4a6a8a', fontFamily: 'Share Tech Mono,monospace', fontSize: 12 }}>Loading epics...</div>}

      {!loading && epics.length === 0 && (
        <div style={{ textAlign: 'center', padding: 48, color: '#2a4a6a' }}>
          <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 12, marginBottom: 8 }}>NO PRIME DIRECTIVES</div>
          <div style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 11 }}>Create an epic to give Aria a high-level goal to work toward.</div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {epics.map(epic => {
          const col = epicColor(epic.status)
          const allEpicTasks = tasks.filter(t => t.epic_id === epic.id)
          const packageTask = allEpicTasks.find(t => t.title.startsWith('[Package]'))
          const epicTasks = allEpicTasks.filter(t => !t.title.startsWith('[Package]'))
          const pct = epic.task_total > 0 ? Math.round((epic.task_done / epic.task_total) * 100) : 0
          const agent = agents.find(a => a.id === epic.agent_id)

          return (
            <div key={epic.id} style={{ background: 'rgba(5,10,26,0.8)', border: `1px solid ${col}40`, borderRadius: 8, overflow: 'hidden' }}>
              {/* Header */}
              <div style={{ padding: '12px 16px', background: `linear-gradient(135deg, ${col}15, transparent)`, borderBottom: `1px solid ${col}25` }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 8, letterSpacing: 2, color: col, background: `${col}18`, padding: '2px 7px', borderRadius: 10, border: `1px solid ${col}40` }}>{epic.status.toUpperCase()}</span>
                      {agent && <span style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 9, color: '#4a6a8a' }}>↗ {agent.name}</span>}
                    </div>
                    <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 13, color: '#e2e8f0', marginBottom: 4 }}>{epic.title}</div>
                    {epic.description && <div style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>{epic.description}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {epic.status !== 'done' && epic.task_total === 0 && (
                      <button onClick={() => onDecompose(epic.id)} title="Ask Aria to decompose into tasks"
                        style={{ padding: '5px 10px', background: 'rgba(139,92,246,0.2)', border: '1px solid #8b5cf660', borderRadius: 4, color: '#a78bfa', fontFamily: 'Orbitron,sans-serif', fontSize: 8, cursor: 'pointer' }}>
                        DECOMPOSE
                      </button>
                    )}
                    <button onClick={() => onDelete(epic.id)} style={{ padding: '5px 8px', background: 'none', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4, color: '#ef4444', fontSize: 12, cursor: 'pointer', lineHeight: 1 }}>✕</button>
                  </div>
                </div>
              </div>

              {/* Progress */}
              {epic.task_total > 0 && (
                <div style={{ padding: '10px 16px', borderBottom: `1px solid ${col}15` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 9, color: '#4a6a8a' }}>PROGRESS</span>
                    <span style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 9, color: col }}>{pct}% — {epic.task_done}/{epic.task_total} tasks</span>
                  </div>
                  <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: col, borderRadius: 2, transition: 'width 0.5s ease', boxShadow: `0 0 8px ${col}` }} />
                  </div>
                  {epic.task_active > 0 && <div style={{ marginTop: 4, fontFamily: 'Share Tech Mono,monospace', fontSize: 9, color: '#22c55e' }}>▶ {epic.task_active} active</div>}
                </div>
              )}

              {/* Task list preview */}
              {epicTasks.length > 0 && (
                <div style={{ padding: '8px 16px 12px' }}>
                  {epicTasks.slice(0, 5).map(t => (
                    <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: { backlog: '#4a6a8a', active: '#22c55e', done: '#00cfff', failed: '#ef4444', blocked: '#f59e0b', reviewing: '#8b5cf6' }[t.status as string] ?? '#4a6a8a', flexShrink: 0 }} />
                      <span style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 10, color: t.status === 'done' ? '#4a6a8a' : '#94a3b8', textDecoration: t.status === 'done' ? 'line-through' : 'none', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                      <span style={{ fontSize: 8, color: '#2a4a6a', fontFamily: 'Share Tech Mono,monospace', flexShrink: 0 }}>{t.status}</span>
                    </div>
                  ))}
                  {epicTasks.length > 5 && <div style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 9, color: '#2a4a6a', marginTop: 6 }}>+{epicTasks.length - 5} more tasks</div>}
                </div>
              )}

              {/* Package download */}
              {packageTask && packageTask.status === 'done' && (
                <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(0,207,255,0.15)', background: 'rgba(0,207,255,0.04)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>📦</span>
                  <div style={{ flex: 1, fontFamily: 'Share Tech Mono,monospace', fontSize: 10, color: '#00cfff' }}>{packageTask.result ?? 'Output packaged'}</div>
                  <a href={`/api/files/download?path=${encodeURIComponent('/app/workspace/' + packageTask.id + '/' + epic.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-output.zip')}`}
                    download style={{ padding: '5px 12px', background: 'rgba(0,207,255,0.15)', border: '1px solid rgba(0,207,255,0.4)', borderRadius: 4, color: '#00cfff', fontFamily: 'Orbitron,sans-serif', fontSize: 8, cursor: 'pointer', textDecoration: 'none', letterSpacing: 1 }}>
                    ↓ DOWNLOAD
                  </a>
                </div>
              )}
              {packageTask && packageTask.status === 'failed' && (
                <div style={{ padding: '8px 16px', borderTop: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.04)' }}>
                  <span style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 9, color: '#ef4444' }}>⚠ Package failed: {packageTask.error ?? packageTask.result}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Create Epic Modal ────────────────────────────────────────
function CreateEpicModal({ agents, onClose, onCreate }: {
  agents: Agent[]; onClose: () => void; onCreate: (data: Record<string, unknown>) => void
}) {
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [priority, setPriority] = React.useState('medium')
  const [agentId, setAgentId] = React.useState(agents[0]?.id ?? '')

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#060d1f', border: '1px solid rgba(139,92,246,0.5)', borderRadius: 10, padding: 28, width: 520, boxShadow: '0 0 40px rgba(139,92,246,0.2)' }}>
        <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 13, color: '#a78bfa', marginBottom: 20, letterSpacing: 2 }}>NEW PRIME DIRECTIVE</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 10, color: '#4a6a8a', display: 'block', marginBottom: 5 }}>EPIC TITLE *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Build a SaaS landing page"
              style={{ width: '100%', padding: '10px 12px', background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 6, color: '#e2e8f0', fontFamily: 'Share Tech Mono,monospace', fontSize: 13, boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 10, color: '#4a6a8a', display: 'block', marginBottom: 5 }}>DESCRIPTION</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4}
              placeholder="Describe the goal in detail. Aria will use this to decompose into tasks."
              style={{ width: '100%', padding: '10px 12px', background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 6, color: '#e2e8f0', fontFamily: 'Share Tech Mono,monospace', fontSize: 12, resize: 'vertical', boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 10, color: '#4a6a8a', display: 'block', marginBottom: 5 }}>PRIORITY</label>
              <select value={priority} onChange={e => setPriority(e.target.value)}
                style={{ width: '100%', padding: '9px 12px', background: '#060d1f', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 6, color: '#e2e8f0', fontFamily: 'Share Tech Mono,monospace', fontSize: 12 }}>
                {['low','medium','high','critical'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 10, color: '#4a6a8a', display: 'block', marginBottom: 5 }}>ASSIGN TO</label>
              <select value={agentId} onChange={e => setAgentId(e.target.value)}
                style={{ width: '100%', padding: '9px 12px', background: '#060d1f', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 6, color: '#e2e8f0', fontFamily: 'Share Tech Mono,monospace', fontSize: 12 }}>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', background: 'none', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 6, color: '#4a6a8a', fontFamily: 'Orbitron,sans-serif', fontSize: 9, cursor: 'pointer' }}>CANCEL</button>
          <button disabled={!title.trim()} onClick={() => onCreate({ title, description, priority, agent_id: agentId })}
            style={{ flex: 2, padding: '10px', background: title.trim() ? 'rgba(139,92,246,0.3)' : 'rgba(139,92,246,0.05)', border: '1px solid rgba(139,92,246,0.6)', borderRadius: 6, color: title.trim() ? '#a78bfa' : '#4a6a8a', fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, cursor: title.trim() ? 'pointer' : 'default' }}>
            CREATE EPIC
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Settings Modal ───────────────────────────────────────────
function SettingsModal({ gwConnected, agents, tasks, onClose }: {
  gwConnected: boolean; agents: Agent[]; tasks: Task[]; onClose: () => void
}) {
  const [activeSection, setActiveSection] = useState<'system' | 'gateway' | 'workspace'>('system')

  const taskCounts = {
    total: tasks.length,
    active: tasks.filter(t => t.status === 'active').length,
    done: tasks.filter(t => t.status === 'done').length,
    failed: tasks.filter(t => t.status === 'failed').length,
  }

  const sections = [
    { key: 'system' as const, label: 'SYSTEM' },
    { key: 'gateway' as const, label: 'GATEWAY' },
    { key: 'workspace' as const, label: 'WORKSPACE' },
  ]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#080e1f', border: '1px solid rgba(0,207,255,0.25)', borderRadius: 10, width: 520, maxWidth: '92vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 0 60px rgba(0,207,255,0.1)', animation: 'slide-in 0.2s ease-out', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(0,207,255,0.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 14, color: '#00cfff', letterSpacing: 2 }}>⚙ STATION SETTINGS</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#4a6a8a', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Section nav */}
          <div style={{ width: 130, borderRight: '1px solid rgba(0,207,255,0.1)', padding: '12px 0', flexShrink: 0 }}>
            {sections.map(s => (
              <button key={s.key} onClick={() => setActiveSection(s.key)}
                style={{ display: 'block', width: '100%', padding: '10px 16px', textAlign: 'left', fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, color: activeSection === s.key ? '#00cfff' : '#4a6a8a', background: activeSection === s.key ? 'rgba(0,207,255,0.08)' : 'transparent', border: 'none', borderLeft: `2px solid ${activeSection === s.key ? '#00cfff' : 'transparent'}`, cursor: 'pointer' }}>
                {s.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>

            {activeSection === 'system' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 3, color: '#4a6a8a', marginBottom: 4 }}>STATION STATUS</div>
                {[
                  ['Agents Online', `${agents.filter(a => a.status !== 'offline').length} / ${agents.length}`, '#22c55e'],
                  ['Tasks Active', String(taskCounts.active), '#22c55e'],
                  ['Tasks Total', String(taskCounts.total), '#00cfff'],
                  ['Tasks Done', String(taskCounts.done), '#4a6a8a'],
                  ['Tasks Failed', String(taskCounts.failed), '#ef4444'],
                ].map(([label, val, col]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(0,207,255,0.04)', border: '1px solid rgba(0,207,255,0.1)', borderRadius: 4 }}>
                    <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'Share Tech Mono,monospace' }}>{label}</span>
                    <span style={{ fontSize: 11, color: col, fontFamily: 'Share Tech Mono,monospace' }}>{val}</span>
                  </div>
                ))}

                <div style={{ marginTop: 8, fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 3, color: '#4a6a8a', marginBottom: 4 }}>AGENTS</div>
                {agents.map(a => {
                  const col = agentColor(a)
                  return (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', background: 'rgba(0,207,255,0.04)', border: '1px solid rgba(0,207,255,0.08)', borderRadius: 4 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor(a.status), animation: a.status === 'busy' ? 'pulse 1.8s infinite' : 'none' }} />
                      <span style={{ flex: 1, fontFamily: 'Orbitron,sans-serif', fontSize: 10, color: col }}>{a.name}</span>
                      <span style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Share Tech Mono,monospace' }}>{agentDept(a)}</span>
                      <span style={{ fontSize: 9, color: statusColor(a.status), fontFamily: 'Share Tech Mono,monospace' }}>{a.status}</span>
                    </div>
                  )
                })}
              </div>
            )}

            {activeSection === 'gateway' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 3, color: '#4a6a8a', marginBottom: 4 }}>GATEWAY CONNECTION</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px', background: gwConnected ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)', border: `1px solid ${gwConnected ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`, borderRadius: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: gwConnected ? '#22c55e' : '#ef4444', animation: 'pulse 2s infinite' }} />
                  <div>
                    <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 11, color: gwConnected ? '#22c55e' : '#ef4444' }}>{gwConnected ? 'CONNECTED' : 'DISCONNECTED'}</div>
                    <div style={{ fontSize: 10, color: '#4a6a8a', fontFamily: 'Share Tech Mono,monospace', marginTop: 2 }}>OpenClaw Gateway</div>
                  </div>
                </div>

                <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'Share Tech Mono,monospace', padding: '8px 12px', background: 'rgba(0,207,255,0.03)', border: '1px solid rgba(0,207,255,0.1)', borderRadius: 4, lineHeight: 1.6 }}>
                  The gateway handles secure communication with AI models.<br />
                  Gateway URL is configured via OPENCLAW_GATEWAY_URL in the server environment.
                </div>

                {!gwConnected && (
                  <div style={{ padding: '10px 12px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 4 }}>
                    <div style={{ fontSize: 11, color: '#fca5a5', fontFamily: 'Share Tech Mono,monospace' }}>
                      Gateway offline. The server will reconnect automatically. If the problem persists, check that the OpenClaw gateway service is running.
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeSection === 'workspace' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 3, color: '#4a6a8a', marginBottom: 4 }}>FILE WORKSPACE</div>
                <div style={{ padding: '12px', background: 'rgba(0,207,255,0.04)', border: '1px solid rgba(0,207,255,0.15)', borderRadius: 6 }}>
                  <div style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Orbitron,sans-serif', letterSpacing: 2, marginBottom: 6 }}>WORKSPACE PATH</div>
                  <div style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 12, color: '#00cfff' }}>/app/workspace</div>
                </div>
                <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'Share Tech Mono,monospace', padding: '10px 12px', background: 'rgba(0,207,255,0.03)', border: '1px solid rgba(0,207,255,0.08)', borderRadius: 4, lineHeight: 1.7 }}>
                  Agents save output files to:<br />
                  <span style={{ color: '#00cfff' }}>/app/workspace/{'<taskId>'}/<br /></span>
                  Files appear in the FILES tab after the task completes.<br />
                  Each task has its own directory named by its task ID.
                </div>
                <div style={{ padding: '10px 12px', background: 'rgba(34,197,94,0.04)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: 4 }}>
                  <div style={{ fontSize: 9, color: '#4a6a8a', fontFamily: 'Orbitron,sans-serif', letterSpacing: 2, marginBottom: 4 }}>HOW IT WORKS</div>
                  <div style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'Share Tech Mono,monospace', lineHeight: 1.7 }}>
                    1. Create a task and dispatch it to an agent<br />
                    2. The agent receives workspace path instructions<br />
                    3. Agent saves files to /app/workspace/taskId/<br />
                    4. Files appear instantly in the FILES tab<br />
                    5. Download via the ↓ GET button
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Settings Tab ─────────────────────────────────────────────
function SettingsTab({ agents }: { agents: Agent[] }) {
  const [primeDirective, setPrimeDirective] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [schedules, setSchedules] = React.useState<Schedule[]>([])
  const [showNewSchedule, setShowNewSchedule] = React.useState(false)
  const [newSched, setNewSched] = React.useState({ name: '', task_title: '', task_description: '', interval_minutes: 60, agent_id: '' })

  React.useEffect(() => {
    fetch('/api/config?key=prime_directive').then(r => r.json()).then(d => setPrimeDirective(d.value ?? '')).catch(() => {})
    fetch('/api/schedules').then(r => r.json()).then(setSchedules).catch(() => {})
  }, [])

  async function savePrime() {
    setSaving(true)
    await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'prime_directive', value: primeDirective }) })
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  async function toggleSchedule(id: string, enabled: number) {
    await fetch(`/api/schedules/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: enabled ? 0 : 1 }) })
    setSchedules(s => s.map(x => x.id === id ? { ...x, enabled: enabled ? 0 : 1 } : x))
  }

  async function deleteSchedule(id: string) {
    await fetch(`/api/schedules/${id}`, { method: 'DELETE' })
    setSchedules(s => s.filter(x => x.id !== id))
  }

  async function createSchedule() {
    if (!newSched.name || !newSched.task_title) return
    const res = await fetch('/api/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSched) })
    const row = await res.json()
    setSchedules(s => [...s, row])
    setShowNewSchedule(false)
    setNewSched({ name: '', task_title: '', task_description: '', interval_minutes: 60, agent_id: '' })
  }

  function formatInterval(mins: number) {
    if (mins < 60) return `${mins}m`
    if (mins < 1440) return `${Math.floor(mins / 60)}h ${mins % 60 > 0 ? `${mins % 60}m` : ''}`.trim()
    return `${Math.floor(mins / 1440)}d`
  }

  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', background: 'rgba(0,207,255,0.06)', border: '1px solid rgba(0,207,255,0.2)', borderRadius: 4, color: '#e2e8f0', fontFamily: 'Share Tech Mono,monospace', fontSize: 12, boxSizing: 'border-box' }
  const labelStyle: React.CSSProperties = { fontFamily: 'Share Tech Mono,monospace', fontSize: 10, color: '#4a6a8a', display: 'block', marginBottom: 5 }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 10, letterSpacing: 4, color: '#4a6a8a', marginBottom: 4 }}>STATION CONFIG</div>
        <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 14, color: '#e2e8f0' }}>SETTINGS</div>
      </div>

      {/* Prime Directive */}
      <div style={{ background: 'rgba(5,10,26,0.8)', border: '1px solid rgba(0,207,255,0.2)', borderRadius: 8, padding: 16 }}>
        <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 10, letterSpacing: 3, color: '#00cfff', marginBottom: 4 }}>PRIME DIRECTIVE</div>
        <div style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 10, color: '#4a6a8a', marginBottom: 10 }}>Injected into every agent's system prompt. Sets the station's core operating principles.</div>
        <textarea value={primeDirective} onChange={e => setPrimeDirective(e.target.value)} rows={5}
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
          <button onClick={savePrime} disabled={saving}
            style={{ padding: '7px 18px', background: 'rgba(0,207,255,0.15)', border: '1px solid rgba(0,207,255,0.4)', borderRadius: 4, color: '#00cfff', fontFamily: 'Orbitron,sans-serif', fontSize: 9, letterSpacing: 2, cursor: 'pointer' }}>
            {saving ? 'SAVING…' : 'SAVE'}
          </button>
          {saved && <span style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 10, color: '#22c55e' }}>✓ Saved</span>}
        </div>
      </div>

      {/* Schedules */}
      <div style={{ background: 'rgba(5,10,26,0.8)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 8, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 10, letterSpacing: 3, color: '#8b5cf6', marginBottom: 2 }}>SCHEDULED TASKS</div>
            <div style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 10, color: '#4a6a8a' }}>Recurring tasks dispatched automatically</div>
          </div>
          <button onClick={() => setShowNewSchedule(p => !p)} style={{ padding: '5px 12px', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.4)', borderRadius: 4, color: '#a78bfa', fontFamily: 'Orbitron,sans-serif', fontSize: 8, letterSpacing: 2, cursor: 'pointer' }}>+ NEW</button>
        </div>

        {showNewSchedule && (
          <div style={{ background: 'rgba(139,92,246,0.05)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 6, padding: 14, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div><label style={labelStyle}>NAME *</label><input value={newSched.name} onChange={e => setNewSched(p => ({ ...p, name: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>TASK TITLE *</label><input value={newSched.task_title} onChange={e => setNewSched(p => ({ ...p, task_title: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>TASK DESCRIPTION</label><textarea value={newSched.task_description} onChange={e => setNewSched(p => ({ ...p, task_description: e.target.value }))} rows={3} style={{ ...inputStyle, resize: 'vertical' }} /></div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}><label style={labelStyle}>INTERVAL (minutes)</label><input type="number" min={5} value={newSched.interval_minutes} onChange={e => setNewSched(p => ({ ...p, interval_minutes: parseInt(e.target.value) || 60 }))} style={inputStyle} /></div>
              <div style={{ flex: 1 }}><label style={labelStyle}>AGENT</label>
                <select value={newSched.agent_id} onChange={e => setNewSched(p => ({ ...p, agent_id: e.target.value }))} style={{ ...inputStyle, height: 34 }}>
                  <option value="">Auto (ARIA)</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={createSchedule} style={{ padding: '6px 14px', background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.4)', borderRadius: 4, color: '#a78bfa', fontFamily: 'Orbitron,sans-serif', fontSize: 8, letterSpacing: 2, cursor: 'pointer' }}>CREATE</button>
              <button onClick={() => setShowNewSchedule(false)} style={{ padding: '6px 14px', background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, color: '#4a6a8a', fontFamily: 'Orbitron,sans-serif', fontSize: 8, letterSpacing: 2, cursor: 'pointer' }}>CANCEL</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {schedules.length === 0 && <div style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 11, color: '#2a4a6a', padding: '8px 0' }}>No schedules configured.</div>}
          {schedules.map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: `rgba(139,92,246,${s.enabled ? '0.06' : '0.02'})`, border: `1px solid rgba(139,92,246,${s.enabled ? '0.25' : '0.1'})`, borderRadius: 6 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 11, color: s.enabled ? '#e2e8f0' : '#4a6a8a' }}>{s.name}</div>
                <div style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 9, color: '#4a6a8a', marginTop: 2 }}>{s.task_title} · every {formatInterval(s.interval_minutes)}{s.last_run ? ` · last: ${new Date(s.last_run).toLocaleTimeString()}` : ' · never run'}</div>
              </div>
              <button onClick={() => toggleSchedule(s.id, s.enabled)} style={{ padding: '3px 10px', background: s.enabled ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)', border: `1px solid ${s.enabled ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.1)'}`, borderRadius: 10, color: s.enabled ? '#22c55e' : '#4a6a8a', fontFamily: 'Share Tech Mono,monospace', fontSize: 9, cursor: 'pointer' }}>
                {s.enabled ? 'ON' : 'OFF'}
              </button>
              <button onClick={() => deleteSchedule(s.id)} style={{ background: 'none', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 4, color: '#ef4444', fontSize: 11, cursor: 'pointer', padding: '2px 6px', lineHeight: 1 }}>✕</button>
            </div>
          ))}
        </div>
      </div>

      {/* Crew types reference */}
      <div style={{ background: 'rgba(5,10,26,0.8)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 16 }}>
        <div style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 10, letterSpacing: 3, color: '#4a6a8a', marginBottom: 12 }}>CREW ROSTER</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {agents.map(a => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'rgba(0,207,255,0.02)', border: '1px solid rgba(0,207,255,0.08)', borderRadius: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: a.status === 'busy' ? '#22c55e' : '#4a6a8a', flexShrink: 0 }} />
              <span style={{ fontFamily: 'Orbitron,sans-serif', fontSize: 10, color: '#e2e8f0', minWidth: 70 }}>{a.name}</span>
              {a.type && <span style={{ fontSize: 8, padding: '1px 6px', borderRadius: 8, background: `${agentTypeColor(a.type)}18`, border: `1px solid ${agentTypeColor(a.type)}40`, color: agentTypeColor(a.type), fontFamily: 'Share Tech Mono,monospace' }}>{a.type.toUpperCase()}</span>}
              <span style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 9, color: '#4a6a8a' }}>{a.room} · {a.model_primary}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
