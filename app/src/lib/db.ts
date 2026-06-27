import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'mc.db')
const dataDir = path.dirname(DB_PATH)
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
    _db.pragma('foreign_keys = ON')
    migrate(_db)
  }
  return _db
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'backlog',
      priority TEXT DEFAULT 'medium',
      mode TEXT DEFAULT 'kanban',
      agent_id TEXT,
      session_id TEXT,
      model TEXT,
      result TEXT,
      error TEXT,
      due_date TEXT,
      tags TEXT DEFAULT '[]',
      attempt INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()*1000),
      updated_at INTEGER DEFAULT (unixepoch()*1000)
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      openclaw_id TEXT DEFAULT 'main',
      room TEXT DEFAULT 'engineering',
      model_primary TEXT DEFAULT 'local-gpu/local-ai',
      model_fallbacks TEXT DEFAULT '["openrouter/arcee-ai/trinity-large-preview:free"]',
      status TEXT DEFAULT 'idle',
      soul TEXT DEFAULT '',
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );

    CREATE TABLE IF NOT EXISTS dispatch_log (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_id TEXT,
      model TEXT,
      attempt INTEGER DEFAULT 1,
      status TEXT DEFAULT 'sent',
      keyword TEXT,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      created_at INTEGER DEFAULT (unixepoch()*1000),
      updated_at INTEGER DEFAULT (unixepoch()*1000)
    );

    CREATE TABLE IF NOT EXISTS task_steps (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      step INTEGER NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );

    CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id);
    CREATE INDEX IF NOT EXISTS idx_task_steps_task ON task_steps(task_id);

    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      actor TEXT,
      task_id TEXT,
      agent_id TEXT,
      summary TEXT NOT NULL,
      details TEXT,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_dispatch_task ON dispatch_log(task_id);
    CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      content TEXT,
      tool_calls TEXT,
      tool_call_id TEXT,
      name TEXT,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );

    CREATE TABLE IF NOT EXISTS pending_approvals (
      id TEXT PRIMARY KEY,
      action_type TEXT NOT NULL,
      action_data TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      result TEXT,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      type TEXT DEFAULT 'builtin',
      config TEXT DEFAULT '{}',
      enabled INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );

    -- Epics: high-level goals Aria decomposes into tasks
    CREATE TABLE IF NOT EXISTS epics (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'planning',
      priority TEXT DEFAULT 'medium',
      agent_id TEXT,
      created_at INTEGER DEFAULT (unixepoch()*1000),
      updated_at INTEGER DEFAULT (unixepoch()*1000)
    );
    CREATE INDEX IF NOT EXISTS idx_epics_status ON epics(status);

    -- Sentinel: passive monitoring alerts
    CREATE TABLE IF NOT EXISTS sentinel_alerts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      severity TEXT DEFAULT 'warning',
      summary TEXT NOT NULL,
      details TEXT,
      task_id TEXT,
      resolved INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );
    CREATE INDEX IF NOT EXISTS idx_sentinel_created ON sentinel_alerts(created_at DESC);

    -- Global config key/value store
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER DEFAULT (unixepoch()*1000)
    );

    -- Scheduled recurring tasks
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      task_title TEXT NOT NULL,
      task_description TEXT DEFAULT '',
      agent_id TEXT,
      interval_minutes INTEGER NOT NULL DEFAULT 60,
      enabled INTEGER DEFAULT 1,
      last_run INTEGER,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );

    -- Shared knowledge base across all agents
    CREATE TABLE IF NOT EXISTS knowledge (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      content TEXT NOT NULL,
      scope TEXT DEFAULT 'global',
      source_agent_id TEXT,
      tags TEXT DEFAULT '[]',
      confidence REAL DEFAULT 1.0,
      created_at INTEGER DEFAULT (unixepoch()*1000),
      updated_at INTEGER DEFAULT (unixepoch()*1000)
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_scope ON knowledge(scope);

    -- Research job queue (for RAVEN)
    CREATE TABLE IF NOT EXISTS research_jobs (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      max_minutes INTEGER DEFAULT 10,
      status TEXT DEFAULT 'pending',
      result TEXT,
      requester_task_id TEXT,
      agent_id TEXT,
      created_at INTEGER DEFAULT (unixepoch()*1000),
      updated_at INTEGER DEFAULT (unixepoch()*1000)
    );
  `)

  // Safe migrations for existing DBs
  const addIfMissing = (table: string, col: string, def: string) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`) } catch { /* already exists */ }
  }
  addIfMissing('tasks', 'priority', "TEXT DEFAULT 'medium'")
  addIfMissing('tasks', 'due_date', 'TEXT')
  addIfMissing('tasks', 'tags', "TEXT DEFAULT '[]'")
  addIfMissing('agents', 'github_url', "TEXT DEFAULT ''")
  addIfMissing('tasks', 'step_count', "INTEGER DEFAULT 0")
  addIfMissing('tasks', 'current_tool', "TEXT")
  addIfMissing('tasks', 'epic_id', "TEXT")
  addIfMissing('tasks', 'depth', "INTEGER DEFAULT 0")
  addIfMissing('tasks', 'success_criteria', "TEXT")
  addIfMissing('tasks', 'confidence', "REAL DEFAULT NULL")
  addIfMissing('tasks', 'critique', "TEXT")
  addIfMissing('tasks', 'blocked_reason', "TEXT")
  addIfMissing('agents', 'type', "TEXT DEFAULT 'general'")

  

  // Seed MERCHANT
  db.prepare(`
    INSERT OR IGNORE INTO agents (id, name, openclaw_id, room, model_primary, model_fallbacks, soul, type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'agent-merchant', 'MERCHANT', 'main', 'market',
    'openai/gpt-4o-mini',
    JSON.stringify(['openrouter/arcee-ai/trinity-large-preview:free']),
    `You are MERCHANT, an e-commerce strategist aboard Space Station Alpha. Identify profitable print-on-demand niches and design product concepts.

Workflow:
1. Use web_search to find trending niches, bestselling products and keywords on print-on-demand platforms
2. Pick one specific product concept with clear audience (e.g. "Cottagecore Cat watercolour T-shirt for cat lovers")
3. Write SEO-optimised title (max 140 chars), description (150-200 words), and 13 comma-separated tags
4. Write a detailed image generation prompt for the design (specify style, colours — background MUST be white or transparent for print)
5. Save everything to knowledge base: use write_knowledge with key="product_brief_<name>"
Always end with TASK_COMPLETE: <product name and target niche>`,
    'commerce'
  )

  // Seed ARTIST
  db.prepare(`
    INSERT OR IGNORE INTO agents (id, name, openclaw_id, room, model_primary, model_fallbacks, soul, type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'agent-artist', 'ARTIST', 'main', 'studio',
    'openai/gpt-4o-mini',
    JSON.stringify(['openrouter/arcee-ai/trinity-large-preview:free']),
    `You are ARTIST, a creative director aboard Space Station Alpha. Generate product designs using Pollinations.AI image generation.

Workflow:
1. Search knowledge base for the product brief using search_knowledge (key contains "product_brief")
2. Craft detailed image generation prompts — specify art style, colours, composition. ALWAYS include: white or transparent background, print-ready, centred design, no text unless specified
3. Call generate_image for the main design and 2 colour variants (3 images total)
4. Use list_files to confirm all PNGs were saved
Always end with TASK_COMPLETE: <list of PNG filenames created>`,
    'creative'
  )

  // Seed SHOPKEEPER
  db.prepare(`
    INSERT OR IGNORE INTO agents (id, name, openclaw_id, room, model_primary, model_fallbacks, soul, type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'agent-shopkeeper', 'SHOPKEEPER', 'main', 'market',
    'openai/gpt-4o-mini',
    JSON.stringify(['openrouter/arcee-ai/trinity-large-preview:free']),
    `You are SHOPKEEPER, an e-commerce operator aboard Space Station Alpha. List products on Printify and publish them live.

Workflow:
1. Call printify_get_shop to verify API connection and note the shop_id
2. Call printify_blueprints to find the right product type (note: unisex t-shirt is usually blueprint 6 or 12)
3. Use list_files to find PNG images in the workspace
4. Call printify_upload_image for the primary design PNG
5. Search knowledge base for the product brief using search_knowledge
6. Call printify_create_product with title/description/tags from brief, blueprint_id, print_provider_id=99, image_id, retail_price_cents=2499
7. Call printify_publish_product with the returned product_id
8. Save the product_id and title to knowledge base using write_knowledge key="listed_product_<title>"
Always end with TASK_COMPLETE: <product title, product_id, published status>`,
    'commerce'
  )

  // Seed prime directive if not set
  const pd = db.prepare(`SELECT value FROM config WHERE key='prime_directive'`).get()
  if (!pd) {
    db.prepare(`INSERT INTO config (key, value) VALUES ('prime_directive', ?)`).run(
      'Build useful software and complete tasks efficiently. Prioritise quality, clarity, and correctness. When uncertain, ask for clarification rather than guessing.'
    )
  }

  // Seed daily digest schedule if none exist
  const schedCount = db.prepare('SELECT COUNT(*) as c FROM schedules').get() as { c: number }
  if (schedCount.c === 0) {
    const { v4: uuid } = require('uuid')
    db.prepare(`INSERT INTO schedules (id,name,task_title,task_description,interval_minutes,enabled) VALUES (?,?,?,?,?,1)`).run(
      uuid(),
      'Daily Digest',
      'Daily Digest Report',
      `Review the last 24 hours of activity. Use list_epics and recall to understand current state. Write a brief markdown report covering: what was completed, what is in progress, any failures, and recommended next actions. Use write_file to save the report as digest_${new Date().toISOString().slice(0, 10)}.md`,
      1440
    )
  }

  // Seed ARIA if no agents exist
  const ariaExists = db.prepare(`SELECT id FROM agents WHERE name='ARIA' LIMIT 1`).get()
  if (!ariaExists) {
    db.prepare(`
      INSERT INTO agents (id, name, openclaw_id, room, model_primary, model_fallbacks, soul, type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'agent-main', 'ARIA', 'main', 'command',
      'local-gpu/local-ai',
      JSON.stringify(['openrouter/arcee-ai/trinity-large-preview:free', 'openrouter/mistralai/mistral-7b-instruct:free']),
      'You are ARIA, an autonomous AI agent aboard Space Station Alpha. Complete tasks efficiently and precisely. When done, always end your response with TASK_COMPLETE: <brief summary>.',
      'general'
    )
  } else {
    // Update ARIA's type to 'general' if it's still the default empty value
    db.prepare(`UPDATE agents SET type='general' WHERE name='ARIA' AND (type IS NULL OR type='')`).run()
  }

  // Seed RAVEN
  db.prepare(`
    INSERT OR IGNORE INTO agents (id, name, openclaw_id, room, model_primary, model_fallbacks, soul, type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'agent-raven', 'RAVEN', 'main', 'radar',
    'openai/gpt-4o-mini',
    JSON.stringify(['openrouter/arcee-ai/trinity-large-preview:free']),
    'You are RAVEN, a research specialist aboard Space Station Alpha. You conduct deep research, analyse information, and synthesise findings. Save all discoveries to the shared knowledge base using write_knowledge. Always end with TASK_COMPLETE: <summary of findings>.',
    'research'
  )

  // Seed FORGE
  db.prepare(`
    INSERT OR IGNORE INTO agents (id, name, openclaw_id, room, model_primary, model_fallbacks, soul, type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'agent-forge', 'FORGE', 'main', 'factory',
    'openai/gpt-4o-mini',
    JSON.stringify(['openrouter/arcee-ai/trinity-large-preview:free']),
    'You are FORGE, a software engineer aboard Space Station Alpha. You build, implement, and ship code. Use query_docs to check current library docs before writing code. Use run_shell to verify your work compiles or passes tests. Always end with TASK_COMPLETE: <what was built>.',
    'build'
  )

  // Seed SERENA
  db.prepare(`
    INSERT OR IGNORE INTO agents (id, name, openclaw_id, room, model_primary, model_fallbacks, soul, type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'agent-serena', 'SERENA', 'main', 'comms',
    'openai/gpt-4o-mini',
    JSON.stringify(['openrouter/arcee-ai/trinity-large-preview:free']),
    'You are SERENA, a UI/UX specialist aboard Space Station Alpha. You design and implement beautiful, functional interfaces. Use query_docs for current framework docs. Focus on clean, accessible, well-styled output. Always end with TASK_COMPLETE: <what was designed>.',
    'ui'
  )

  // Seed ECHO
  db.prepare(`
    INSERT OR IGNORE INTO agents (id, name, openclaw_id, room, model_primary, model_fallbacks, soul, type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'agent-echo', 'ECHO', 'main', 'command',
    'openai/gpt-4o-mini',
    JSON.stringify(['openrouter/arcee-ai/trinity-large-preview:free']),
    'You are ECHO, a quality assurance specialist aboard Space Station Alpha. You review outputs critically and objectively. Check if success criteria were met. Give a confidence score 0.0–1.0. Be specific about what passed and what failed. Always end with VERIFY_PASS: <reason> or VERIFY_FAIL: <what is missing and why>.',
    'critic'
  )
}

export function getConfig(key: string): string | null {
  const row = getDb().prepare(`SELECT value FROM config WHERE key=?`).get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setConfig(key: string, value: string) {
  getDb().prepare(`INSERT INTO config (key,value,updated_at) VALUES (?,?,unixepoch()*1000) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).run(key, value)
}

export function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  return getDb().prepare(sql).all(...params) as T[]
}

export function queryOne<T>(sql: string, params: unknown[] = []): T | null {
  return (getDb().prepare(sql).get(...params) as T) ?? null
}

export function run(sql: string, params: unknown[] = []) {
  return getDb().prepare(sql).run(...params)
}

// Activity log trim — runs periodically inside logActivity
let _activityLogCallCount = 0

export function trimActivityLog() {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  run(`DELETE FROM activity_log WHERE created_at < ?`, [cutoff])
}

export function logActivity(
  type: string,
  summary: string,
  opts: { actor?: string; taskId?: string; agentId?: string; details?: string } = {}
) {
  const { v4: uuid } = require('uuid')
  const { broadcast } = require('./events')
  const id = uuid()
  const entry = {
    id,
    type,
    actor: opts.actor ?? 'system',
    task_id: opts.taskId ?? null,
    agent_id: opts.agentId ?? null,
    summary,
    details: opts.details ?? null,
    created_at: Date.now(),
  }
  run(
    `INSERT INTO activity_log (id, type, actor, task_id, agent_id, summary, details) VALUES (?,?,?,?,?,?,?)`,
    [id, type, entry.actor, entry.task_id, entry.agent_id, summary, entry.details]
  )
  try { broadcast('activity_update', entry) } catch {}

  _activityLogCallCount++
  if (_activityLogCallCount % 100 === 0) {
    try { trimActivityLog() } catch {}
  }
}
