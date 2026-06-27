// Scheduler — polls schedules table every 2 minutes, dispatches due tasks
// Also polls research_jobs table for pending RAVEN jobs
import { queryAll, queryOne, run, logActivity } from './db'
import { broadcast } from './events'
import { v4 as uuid } from 'uuid'

const POLL_INTERVAL_MS = 2 * 60 * 1000  // 2 minutes

let started = false

export function startScheduler() {
  if (started) return
  started = true
  console.log('[Scheduler] Started')
  setTimeout(poll, 10000)  // first run after 10s
  setInterval(poll, POLL_INTERVAL_MS)
}

function poll() {
  try { checkSchedules() } catch (e) { console.error('[Scheduler] checkSchedules error:', e) }
  try { checkResearchJobs() } catch (e) { console.error('[Scheduler] checkResearchJobs error:', e) }
}

interface Schedule {
  id: string
  name: string
  task_title: string
  task_description: string
  agent_id: string | null
  interval_minutes: number
  enabled: number
  last_run: number | null
}

interface Agent {
  id: string
  name: string
  type: string
}

function checkSchedules() {
  // Find schedules that are enabled and overdue
  const due = queryAll<Schedule>(`
    SELECT * FROM schedules
    WHERE enabled=1
      AND (last_run IS NULL OR last_run < (unixepoch()*1000 - interval_minutes*60000))
  `)

  if (due.length === 0) return

  // Find default ARIA agent (type='general') as fallback
  const ariaAgent = queryOne<Agent>(`SELECT * FROM agents WHERE type='general' ORDER BY created_at ASC LIMIT 1`)

  for (const sched of due) {
    // Resolve which agent to dispatch to
    let agentId = sched.agent_id
    if (!agentId) {
      if (!ariaAgent) {
        console.warn(`[Scheduler] No agent available for schedule "${sched.name}"`)
        continue
      }
      agentId = ariaAgent.id
    }

    // Verify the agent still exists
    const agent = queryOne<Agent>(`SELECT * FROM agents WHERE id=?`, [agentId])
    if (!agent) {
      console.warn(`[Scheduler] Agent ${agentId} not found for schedule "${sched.name}", falling back to ARIA`)
      if (!ariaAgent) continue
      agentId = ariaAgent.id
    }

    // Create the task
    const taskId = uuid()
    run(
      `INSERT INTO tasks (id,title,description,status,priority,agent_id) VALUES (?,?,?,'backlog','medium',?)`,
      [taskId, sched.task_title, sched.task_description ?? '', agentId]
    )
    broadcast('task_update', { id: taskId, title: sched.task_title, status: 'backlog' })

    // Update last_run timestamp
    run(`UPDATE schedules SET last_run=? WHERE id=?`, [Date.now(), sched.id])

    // Dispatch the task
    import('./dispatch').then(({ dispatchTask }) => {
      dispatchTask(taskId).catch((e: unknown) => {
        console.error(`[Scheduler] Dispatch failed for schedule "${sched.name}":`, e)
      })
    }).catch((e: unknown) => {
      console.error('[Scheduler] Failed to import dispatch:', e)
    })

    logActivity('schedule_dispatch', `Scheduled task dispatched: ${sched.task_title}`, {
      taskId,
      agentId: agentId ?? undefined,
    })

    console.log(`[Scheduler] Dispatched scheduled task "${sched.task_title}" (schedule: ${sched.name})`)
  }
}

interface ResearchJob {
  id: string
  topic: string
  max_minutes: number
  status: string
  requester_task_id: string | null
}

function checkResearchJobs() {
  // Pick up one pending research job at a time
  const job = queryOne<ResearchJob>(`
    SELECT * FROM research_jobs WHERE status='pending' ORDER BY created_at ASC LIMIT 1
  `)

  if (!job) return

  // Find RAVEN (research agent)
  const raven = queryOne<Agent>(`SELECT * FROM agents WHERE type='research' ORDER BY created_at ASC LIMIT 1`)
  if (!raven) {
    console.warn('[Scheduler] No research agent (RAVEN) available for research job')
    return
  }

  // Build a task description that instructs RAVEN to update the job on completion
  const description = `You have been assigned a research job (job_id: ${job.id}).

RESEARCH TOPIC: ${job.topic}

Instructions:
1. Use web_search to gather information on the topic.
2. Synthesise your findings into a comprehensive summary.
3. Use write_knowledge to save key findings with key="${job.id}" and appropriate tags.
4. Write your final research report using write_file (filename: research_${job.id}.md).
5. At the end of your response, include exactly this line so the system can record your result:
   RESEARCH_RESULT: <one-line summary of your findings>

Time budget: ${job.max_minutes} minutes. Be thorough but concise.`

  const taskId = uuid()
  run(
    `INSERT INTO tasks (id,title,description,status,priority,agent_id) VALUES (?,?,?,'backlog','high',?)`,
    [taskId, `Research: ${job.topic}`, description, raven.id]
  )

  // Mark the job as running
  run(
    `UPDATE research_jobs SET status='running', agent_id=?, updated_at=unixepoch()*1000 WHERE id=?`,
    [raven.id, job.id]
  )

  broadcast('task_update', { id: taskId, title: `Research: ${job.topic}`, status: 'backlog' })

  // Dispatch the research task
  import('./dispatch').then(({ dispatchTask }) => {
    dispatchTask(taskId).catch((e: unknown) => {
      console.error(`[Scheduler] Research job dispatch failed for job ${job.id}:`, e)
      // Revert job status on dispatch failure
      run(`UPDATE research_jobs SET status='pending', agent_id=NULL, updated_at=unixepoch()*1000 WHERE id=?`, [job.id])
    })
  }).catch((e: unknown) => {
    console.error('[Scheduler] Failed to import dispatch for research job:', e)
  })

  logActivity('research_dispatch', `Research job started: ${job.topic}`, {
    taskId,
    agentId: raven.id,
  })

  console.log(`[Scheduler] Dispatched research job "${job.topic}" to ${raven.name} (task: ${taskId})`)
}
