import { queryAll } from '@/lib/db'
import StarField from '@/components/StarField'
import StationControl from '@/components/StationControl'
import type { Task, Agent, ActivityEntry } from '@/components/StationControl'

// Re-fetch on every request — never serve stale data
export const dynamic = 'force-dynamic'

export default function Home() {
  const tasks = queryAll<Task>('SELECT * FROM tasks ORDER BY created_at DESC')
  const agents = queryAll<Agent>('SELECT * FROM agents ORDER BY created_at ASC')
  const activity = queryAll<ActivityEntry>('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 100')

  return (
    <>
      <StarField />
      <StationControl
        initialTasks={tasks}
        initialAgents={agents}
        initialActivity={activity}
      />
    </>
  )
}
