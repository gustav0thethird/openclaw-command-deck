// Sentinel — passive monitor, zero AI cost unless an alert fires
// Polls DB every 60s for anomalies, broadcasts SSE sentinel_alert events
// When user clicks Investigate, dispatches a one-shot task to Aria

import { queryAll, queryOne, run, logActivity } from './db'
import { broadcast } from './events'
import { v4 as uuid } from 'uuid'

const POLL_INTERVAL_MS = 60_000
const STUCK_TASK_MINUTES = 20
const FAILURE_WINDOW_MINUTES = 15
const FAILURE_THRESHOLD = 5      // raised — avoid noise on busy runs
const ALERT_DEDUP_MINUTES = 60   // same alert type won't re-fire for 1 hour

let started = false

export function startSentinel() {
  if (started) return
  started = true
  console.log('[Sentinel] Started — polling every 60s')
  setTimeout(poll, 5000) // first run after 5s boot delay
  setInterval(poll, POLL_INTERVAL_MS)
}

function poll() {
  try {
    checkStuckTasks()
    checkFailureSpike()
    checkGateway()
  } catch (err) {
    console.error('[Sentinel] Poll error:', err)
  }
}

function raiseAlert(type: string, severity: 'info' | 'warning' | 'critical', summary: string, details?: string) {
  // Deduplicate: don't re-raise same type if unresolved alert exists within last 10 min
  const recent = queryOne<{ id: string }>(
    `SELECT id FROM sentinel_alerts WHERE type=? AND resolved=0 AND created_at > ? LIMIT 1`,
    [type, Date.now() - ALERT_DEDUP_MINUTES * 60 * 1000]
  )
  if (recent) return

  const id = uuid()
  run(`INSERT INTO sentinel_alerts (id,type,severity,summary,details) VALUES (?,?,?,?,?)`,
    [id, type, severity, summary, details ?? null])
  logActivity('sentinel_alert', summary)
  broadcast('sentinel_alert', { id, type, severity, summary, details })
  console.log(`[Sentinel] ALERT (${severity}) — ${summary}`)
}

function checkStuckTasks() {
  const cutoff = Date.now() - STUCK_TASK_MINUTES * 60 * 1000
  const stuck = queryAll<{ id: string; title: string; agent_id: string }>(
    `SELECT id, title, agent_id FROM tasks WHERE status='active' AND updated_at < ? LIMIT 5`,
    [cutoff]
  )
  for (const t of stuck) {
    raiseAlert(
      `stuck_task_${t.id}`,
      'warning',
      `Task stuck for >${STUCK_TASK_MINUTES}min: "${t.title}"`,
      `Task ID: ${t.id}`
    )
  }
}

function checkFailureSpike() {
  const since = Date.now() - FAILURE_WINDOW_MINUTES * 60 * 1000
  const failures = queryOne<{ n: number }>(
    `SELECT COUNT(*) as n FROM activity_log WHERE type LIKE '%fail%' AND created_at > ?`,
    [since]
  )
  if ((failures?.n ?? 0) >= FAILURE_THRESHOLD) {
    raiseAlert(
      'failure_spike',
      'warning',
      `${failures!.n} failures in the last ${FAILURE_WINDOW_MINUTES} minutes`,
      `Check activity log for details`
    )
  }
}

function checkGateway() {
  try {
    const { getGateway } = require('./gateway')
    const gw = getGateway()
    if (!gw.isReady()) {
      raiseAlert('gateway_down', 'critical', 'OpenClaw gateway is disconnected', 'Agent communication may be impaired')
    }
  } catch {}
}

// Called when user clicks Investigate on an alert
export async function investigateAlert(alertId: string, orchestratorAgentId: string): Promise<string> {
  const alert = queryOne<{ id: string; type: string; summary: string; details: string }>(
    `SELECT * FROM sentinel_alerts WHERE id=?`, [alertId]
  )
  if (!alert) return 'Alert not found'

  // Pull real context so the agent doesn't hallucinate
  const recentFails = queryAll<{ title: string; error: string; updated_at: number }>(
    `SELECT title, error, updated_at FROM tasks WHERE status='failed' ORDER BY updated_at DESC LIMIT 5`
  )
  const recentActivity = queryAll<{ type: string; summary: string; created_at: number }>(
    `SELECT type, summary, created_at FROM activity_log ORDER BY created_at DESC LIMIT 20`
  )
  const failContext = recentFails.length
    ? recentFails.map(t => `- ${t.title}: ${t.error ?? 'no error message'}`).join('\n')
    : 'No recent failures found.'
  const actContext = recentActivity.map(a => `[${a.type}] ${a.summary}`).join('\n')

  const taskId = uuid()
  const description = `SENTINEL ALERT — REAL DATA INVESTIGATION\n\nAlert type: ${alert.type}\nSummary: ${alert.summary}\nDetails: ${alert.details ?? 'none'}\n\nRECENT FAILED TASKS:\n${failContext}\n\nRECENT ACTIVITY LOG:\n${actContext}\n\nBased on the REAL data above, write a brief diagnosis of what went wrong and one concrete recommendation. Use write_file to save a report as sentinel_report.md. Do not invent task names — only reference what is listed above.`
  run(`INSERT INTO tasks (id,title,description,status,priority,agent_id,depth) VALUES (?,?,?,'backlog','high',?,0)`,
    [taskId, `[Sentinel] ${alert.summary}`, description, orchestratorAgentId])
  broadcast('task_update', { id: taskId, title: `[Sentinel] ${alert.summary}`, status: 'backlog' })

  const { dispatchTask } = require('./dispatch')
  dispatchTask(taskId).catch(() => {})

  // Mark alert as being investigated
  run(`UPDATE sentinel_alerts SET resolved=1 WHERE id=?`, [alertId])
  broadcast('sentinel_alert_resolved', { id: alertId, taskId })

  return taskId
}

export function getActiveAlerts() {
  return queryAll(
    `SELECT * FROM sentinel_alerts WHERE resolved=0 ORDER BY created_at DESC LIMIT 20`
  )
}
