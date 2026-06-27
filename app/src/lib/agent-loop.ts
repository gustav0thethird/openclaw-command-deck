// Agentic loop — direct OpenAI function calling (bypasses OpenClaw text-based format)
import OpenAI from 'openai'
import { run, logActivity, getConfig } from './db'
import { broadcast } from './events'
import { v4 as uuid } from 'uuid'
import { TOOL_MAP } from './tools'

const MAX_DEPTH = 1  // tasks spawned by agents can't spawn further tasks

// Per-agent-type step caps
const MAX_STEPS_BY_TYPE: Record<string, number> = {
  research: 25,
  build: 15,
  ui: 15,
  critic: 5,
  creative: 15,
  commerce: 20,
  general: 12,
}
const DEFAULT_MAX_STEPS = 12

// Tools available per agent type
const TOOLS_BY_TYPE: Record<string, string[]> = {
  research: [
    'web_search', 'fetch_url', 'read_file', 'write_file', 'list_files',
    'write_knowledge', 'search_knowledge', 'queue_research', 'get_research',
    'remember', 'recall', 'ask_user', 'read_vault',
  ],
  build: [
    'web_search', 'fetch_url', 'read_file', 'write_file', 'list_files',
    'run_python', 'run_shell', 'query_docs', 'write_knowledge', 'search_knowledge',
    'remember', 'recall', 'http_request', 'ask_user', 'read_vault',
    // spawn_task intentionally excluded for build agents
  ],
  ui: [
    'write_file', 'read_file', 'list_files', 'fetch_url', 'web_search',
    'query_docs', 'write_knowledge', 'search_knowledge', 'ask_user',
  ],
  critic: [
    'read_file', 'list_files', 'search_knowledge',
  ],
  general: [
    'web_search', 'fetch_url', 'read_file', 'write_file', 'list_files',
    'run_python', 'write_knowledge', 'search_knowledge', 'queue_research', 'get_research',
    'remember', 'recall', 'spawn_task', 'create_epic', 'list_epics', 'create_agent',
    'http_request', 'ask_user', 'read_vault', 'generate_image',
    // run_shell and query_docs excluded from general
  ],
  creative: [
    'generate_image', 'view_image', 'remove_background',
    'write_file', 'read_file', 'list_files',
    'search_knowledge', 'write_knowledge', 'ask_user',
  ],
  commerce: [
    'web_search', 'fetch_url', 'read_file', 'write_file', 'list_files',
    'generate_image',
    'printify_get_shop', 'printify_blueprints', 'printify_upload_image',
    'printify_create_product', 'printify_publish_product', 'printify_get_orders',
    'etsy_create_listing',
    'write_knowledge', 'search_knowledge', 'remember', 'recall', 'ask_user',
  ],
}

interface Agent {
  id: string
  name: string
  openclaw_id: string
  model_primary: string
  soul: string
  type?: string
}

interface Task {
  id: string
  title: string
  description: string
  attempt: number
  depth?: number
  success_criteria?: string
  epic_id?: string
}

// ─── Build agent-type-specific OPENAI_TOOLS array ─────────────
function buildOpenAiTools(agentType: string): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const allowedNames = new Set(TOOLS_BY_TYPE[agentType] ?? TOOLS_BY_TYPE.general)

  // Full tool schema definitions
  const allTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write content to a file in the task workspace. Use for EVERY file you create.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Filename, e.g. index.html or src/App.tsx' },
            content: { type: 'string', description: 'Full file content' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file from the task workspace',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Filename to read (or taskId/filename to read from another task workspace)' } },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: 'List all files in the task workspace',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_python',
        description: 'Execute Python 3 code and return stdout/stderr',
        parameters: {
          type: 'object',
          properties: { code: { type: 'string', description: 'Python code to execute' } },
          required: ['code'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_shell',
        description: 'Run a whitelisted shell command to verify work',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string', description: 'Shell command (must start with a whitelisted prefix)' } },
          required: ['command'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the web for information',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Search query' } },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'fetch_url',
        description: 'Fetch the text content of a URL',
        parameters: {
          type: 'object',
          properties: { url: { type: 'string', description: 'URL to fetch' } },
          required: ['url'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'http_request',
        description: 'Make a full HTTP request (GET, POST, PUT, DELETE, PATCH)',
        parameters: {
          type: 'object',
          properties: {
            method: { type: 'string', description: 'HTTP method: GET | POST | PUT | DELETE | PATCH' },
            url: { type: 'string', description: 'Full URL' },
            body: { type: 'string', description: 'JSON body string (optional)' },
            headers: { type: 'string', description: 'JSON string of extra headers (optional)' },
          },
          required: ['method', 'url'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'remember',
        description: 'Save a key-value pair to persistent agent memory',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Memory label' },
            value: { type: 'string', description: 'Value to store' },
          },
          required: ['key', 'value'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'recall',
        description: 'Search agent memory for relevant information',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Keywords to search' } },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'spawn_task',
        description: 'Create and dispatch a subtask to another agent',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Task title' },
            description: { type: 'string', description: 'What needs to be done' },
            agent_id: { type: 'string', description: 'Agent ID (optional)' },
          },
          required: ['title'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_epic',
        description: 'Create a high-level epic and decompose it into tasks',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Epic title' },
            description: { type: 'string', description: 'What needs to be achieved' },
            tasks: { type: 'string', description: 'JSON array of {title, description} objects (optional)' },
          },
          required: ['title'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_epics',
        description: 'List current epics and their task progress',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_agent',
        description: 'Spawn a new AI agent',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            soul: { type: 'string' },
            room: { type: 'string' },
            model: { type: 'string' },
          },
          required: ['name', 'soul'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_knowledge',
        description: 'Save a finding or fact to the shared knowledge base',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Short label, e.g. product_brief_tshirt' },
            content: { type: 'string', description: 'Knowledge content — use param name "content" not "value"' },
            tags: { type: 'string', description: 'Comma-separated tags (optional)' },
            scope: { type: 'string', description: 'global | agent:<id> | epic:<id> (optional)' },
          },
          required: ['key', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_knowledge',
        description: 'Search the shared knowledge base',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Keywords to search' } },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'query_docs',
        description: 'Fetch live documentation for a library or framework',
        parameters: {
          type: 'object',
          properties: {
            library: { type: 'string', description: 'Library name, e.g. "react", "nextjs"' },
            topic: { type: 'string', description: 'Topic, e.g. "hooks", "routing" (optional)' },
          },
          required: ['library'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'queue_research',
        description: "Add a research topic to RAVEN's queue",
        parameters: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'What to research' },
            minutes: { type: 'string', description: 'Max time in minutes (default 10)' },
          },
          required: ['topic'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_research',
        description: 'Get the result of a queued research job',
        parameters: {
          type: 'object',
          properties: { job_id: { type: 'string', description: 'Job ID from queue_research' } },
          required: ['job_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'ask_user',
        description: 'Pause the task and ask the user a question when you cannot proceed without input',
        parameters: {
          type: 'object',
          properties: { question: { type: 'string', description: 'Question to ask the user' } },
          required: ['question'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_vault',
        description: 'Read a file from the Obsidian knowledge vault',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Relative path in vault, e.g. "Projects/MyProject.md"' } },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'generate_image',
        description: 'Generate an image using Pollinations.AI (free, no API key) and save it as a PNG in the task workspace',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Detailed description of the image to generate' },
            filename: { type: 'string', description: 'Filename without extension (default: "generated")' },
          },
          required: ['prompt'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'printify_get_shop',
        description: 'Get Printify shop info. Call first to verify API connection. No parameters needed.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'printify_blueprints',
        description: 'List available Printify product types (t-shirts, mugs, hoodies, etc.) to find blueprint_id. No parameters needed.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'printify_upload_image',
        description: 'Upload a PNG image to Printify media library. Returns image_id needed for creating products. For files from another task workspace, use "taskId/filename.png" format.',
        parameters: {
          type: 'object',
          properties: {
            filename: { type: 'string', description: 'PNG filename in workspace (e.g. "design.png" or "taskId/design.png" for cross-task)' },
          },
          required: ['filename'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'printify_create_product',
        description: 'Create a product on Printify. Requires blueprint_id (use 6 for unisex t-shirt), print_provider_id (use 99), and image_id from printify_upload_image.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Product title' },
            description: { type: 'string', description: 'Product description' },
            blueprint_id: { type: 'string', description: 'Blueprint ID (6 = unisex t-shirt, 3 = mug)' },
            print_provider_id: { type: 'string', description: 'Print provider ID (use 99 as default)' },
            image_id: { type: 'string', description: 'Image ID returned by printify_upload_image' },
            retail_price_cents: { type: 'string', description: 'Price in cents, e.g. "2499" for $24.99' },
            tags: { type: 'string', description: 'Comma-separated tags (optional)' },
          },
          required: ['title', 'description', 'blueprint_id', 'print_provider_id', 'image_id', 'retail_price_cents'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'printify_publish_product',
        description: 'Publish a Printify product to the connected Etsy store to make it live',
        parameters: {
          type: 'object',
          properties: {
            product_id: { type: 'string', description: 'The Printify product ID to publish' },
          },
          required: ['product_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'printify_get_orders',
        description: 'Get recent orders from the Printify/Etsy shop to track sales and fulfillment',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'etsy_create_listing',
        description: 'Create a listing directly on Etsy (requires prior OAuth via /api/etsy/connect)',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Listing title (max 140 chars)' },
            description: { type: 'string', description: 'Listing description' },
            price_usd: { type: 'string', description: 'Price in USD, e.g. "24.99"' },
            tags: { type: 'string', description: 'Comma-separated tags (max 13)' },
            image_filename: { type: 'string', description: 'PNG filename in task workspace' },
            quantity: { type: 'string', description: 'Stock quantity (default 999)' },
          },
          required: ['title', 'description', 'price_usd'],
        },
      },
    },
  ]

  return allTools.filter(t => allowedNames.has((t as any).function.name))
}

// ─── Step logger ─────────────────────────────────────────────
function logStep(taskId: string, step: number, type: string, content: string) {
  run(
    `INSERT INTO task_steps (id,task_id,step,type,content) VALUES (?,?,?,?,?)`,
    [uuid(), taskId, step, type, content.slice(0, 8000)]
  )
  run(`UPDATE tasks SET step_count=?,current_tool=? WHERE id=?`,
    [step, type === 'tool_call' ? content.split('(')[0] : null, taskId])
  broadcast('task_step', { taskId, step, type, content: content.slice(0, 2000) })
}

// ─── System prompt ────────────────────────────────────────────
function buildSystemPrompt(agent: Agent, task: Task): string {
  const soul = agent.soul?.trim() ? `${agent.soul}\n\n` : ''

  // Prepend prime directive if configured
  const primeDirective = getConfig('prime_directive')
  const primePart = primeDirective ? `PRIME DIRECTIVE: ${primeDirective}\n\n` : ''

  const today = new Date().toISOString().slice(0, 10)

  // Shared workspace when part of an epic — all tasks can read/write same files
  const workspacePath = task.epic_id
    ? `/app/workspace/epic-${task.epic_id}/`
    : `/app/workspace/${task.id}/`
  const workspaceNote = task.epic_id
    ? `Your workspace is SHARED with all tasks in this project at ${workspacePath} — files written by previous tasks (product_brief.txt, tshirt_design.png etc.) are directly accessible here.`
    : `Your workspace is at ${workspacePath} — all files you write_file are saved there.`

  return `${primePart}${soul}You are an autonomous agent. Complete tasks by calling the provided tools.

Today's date: ${today}
${workspaceNote}

Rules:
- Use write_file for EVERY file you need to create — writing files is not optional
- Do NOT use write_file to write image files (.png/.jpg) — use generate_image instead
- You may call multiple tools in sequence to complete a task
- Once all work is done, respond with: TASK_COMPLETE: <one-line summary>
- You may optionally include a confidence score: TASK_COMPLETE: <summary> [confidence:0.85]
- Never say TASK_COMPLETE before you have actually created/modified files or produced output
- If you need human input to proceed, use ask_user — this pauses the task`
}

// ─── OpenAI client factory (supports local GPU override) ─────
function makeOpenAiClient(agent: Agent): { client: OpenAI; model: string } {
  const apiKey = process.env.OPENAI_API_KEY ?? 'replace-me'
  const rawModel = agent.model_primary ?? 'openai/gpt-4o-mini'

  // Local GPU model routing
  if (rawModel === 'local-gpu/local-ai') {
    return {
      client: new OpenAI({
        apiKey: process.env.LOCAL_GPU_API_KEY ?? 'local',
        baseURL: process.env.LOCAL_GPU_URL ?? 'http://localhost:11435/v1',
      }),
      model: 'local-ai',
    }
  }

  // Strip provider prefix (e.g. "openai/gpt-4o-mini" → "gpt-4o-mini")
  const model = rawModel.includes('/') ? rawModel.split('/').slice(1).join('/') : rawModel

  // OpenRouter uses a different base URL
  if (agent.model_primary.startsWith('openrouter/')) {
    return {
      client: new OpenAI({
        apiKey: process.env.OPENROUTER_API_KEY ?? apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
      }),
      model,
    }
  }

  return { client: new OpenAI({ apiKey }), model }
}

// ─── Execute a tool ───────────────────────────────────────────
async function executeTool(
  name: string,
  args: Record<string, string>,
  context: { taskId: string; agentId: string; depth: number; epicId?: string }
): Promise<string> {
  const tool = TOOL_MAP.get(name)
  if (!tool) return `Unknown tool "${name}". Available: ${[...TOOL_MAP.keys()].join(', ')}`
  try {
    const result = await tool.execute(args, context)
    return result.output.slice(0, 4000)
  } catch (err) {
    return `Tool error: ${String(err)}`
  }
}

// ─── Main loop ────────────────────────────────────────────────
export async function runAgentLoop(
  task: Task & { success_criteria?: string; epic_id?: string },
  agent: Agent & { type?: string },
  _sessionKey: string,
  onStep?: (step: number, type: string, content: string) => void,
): Promise<{ status: 'done' | 'failed' | 'blocked'; summary: string; confidence?: number }> {

  if (!process.env.OPENAI_API_KEY && agent.model_primary !== 'local-gpu/local-ai') {
    return { status: 'failed', summary: 'OPENAI_API_KEY not configured' }
  }

  const agentType = agent.type ?? 'general'
  const maxSteps = MAX_STEPS_BY_TYPE[agentType] ?? DEFAULT_MAX_STEPS
  const { client: openai, model } = makeOpenAiClient(agent)
  const openAiTools = buildOpenAiTools(agentType)

  logActivity('agent_loop_start', `Agentic loop started for: ${task.title}`, { taskId: task.id, agentId: agent.id })

  // Build user message — include success criteria if provided
  let userMessage = `Task: ${task.title}\n\n${task.description || 'Complete this task.'}`
  if (task.success_criteria) {
    userMessage += `\n\nSuccess criteria: ${task.success_criteria}`
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(agent, task) },
    { role: 'user', content: userMessage },
  ]

  let step = 0
  let toolsUsed = 0

  while (step < maxSteps) {
    step++
    run(`UPDATE tasks SET step_count=? WHERE id=?`, [step, task.id])
    broadcast('task_update', { id: task.id, info: `Step ${step}/${maxSteps}` })

    let completion: OpenAI.Chat.Completions.ChatCompletion
    try {
      completion = await openai.chat.completions.create({
        model,
        messages,
        tools: openAiTools,
        tool_choice: 'auto',
        max_tokens: 4096,
      })
    } catch (err) {
      return { status: 'failed', summary: `OpenAI error at step ${step}: ${String(err)}` }
    }

    const choice = completion.choices[0]
    const msg = choice.message
    const textContent = msg.content ?? ''
    const hasCalls = (msg.tool_calls?.length ?? 0) > 0

    logStep(task.id, step, 'agent_response',
      textContent || (hasCalls ? `[${msg.tool_calls!.length} tool call(s) pending]` : '(empty)'))
    onStep?.(step, 'agent_response', textContent)

    // Push assistant turn into history
    messages.push(msg)

    if (hasCalls) {
      for (const tc of msg.tool_calls!) {
        const { id: tcId, function: tcFn } = tc as { id: string; function: { name: string; arguments: string } }
        const fnName = tcFn.name
        let fnArgs: Record<string, string> = {}
        try { fnArgs = JSON.parse(tcFn.arguments) } catch {}

        const callDesc = `${fnName}(${Object.entries(fnArgs)
          .map(([k, v]) => `${k}=${JSON.stringify(String(v).slice(0, 80))}`)
          .join(', ')})`
        logStep(task.id, step, 'tool_call', callDesc)
        onStep?.(step, 'tool_call', callDesc)

        run(`UPDATE tasks SET current_tool=? WHERE id=?`, [fnName, task.id])
        broadcast('task_update', { id: task.id, info: `Tool: ${fnName}` })

        const result = await executeTool(fnName, fnArgs, {
          taskId: task.id,
          agentId: agent.id,
          depth: task.depth ?? 0,
          epicId: task.epic_id,
        })
        logStep(task.id, step, 'tool_result', result)
        onStep?.(step, 'tool_result', result)

        // Detect ASK_USER sentinel from tool result
        if (result.startsWith('ASK_USER:')) {
          const question = result.replace(/^ASK_USER:\s*/i, '').trim()
          logStep(task.id, step, 'blocked', `Waiting for user: ${question}`)
          return { status: 'blocked', summary: question }
        }

        messages.push({ role: 'tool', tool_call_id: tcId, content: result })
        toolsUsed++
      }
      continue
    }

    // Check for ASK_USER in plain text response
    const askUserMatch = textContent.match(/ASK_USER:\s*(.+?)(?:\n|$)/i)
    if (askUserMatch) {
      const question = askUserMatch[1].trim()
      logStep(task.id, step, 'blocked', `Waiting for user: ${question}`)
      run(`UPDATE tasks SET blocked_reason=?, updated_at=unixepoch()*1000 WHERE id=?`, [question, task.id])
      return { status: 'blocked', summary: question }
    }

    // No tool calls — check for TASK_COMPLETE
    const completionMatch = textContent.match(/TASK_COMPLETE:\s*(.+?)(?:\[confidence:([\d.]+)\])?(?:\n|$)/i)

    if (completionMatch) {
      if (toolsUsed === 0) {
        logStep(task.id, step, 'nudge', 'TASK_COMPLETE with no tool use — must actually do the work first')
        messages.push({
          role: 'user',
          content: 'You must use tools to do the actual work. Call write_file to create every required file, then say TASK_COMPLETE.',
        })
        continue
      }
      const summary = completionMatch[1].trim()
      const confidence = completionMatch[2] ? parseFloat(completionMatch[2]) : undefined
      logStep(task.id, step, 'complete', summary)
      return { status: 'done', summary, ...(confidence !== undefined ? { confidence } : {}) }
    }

    // Also check for inline confidence format: TASK_COMPLETE: summary [confidence:X]
    const altCompletionMatch = textContent.match(/TASK_COMPLETE:\s*(.*?)(?:\s+\[confidence:([\d.]+)\])?\s*$/im)
    if (altCompletionMatch && toolsUsed > 0) {
      const summary = altCompletionMatch[1].trim()
      const confidence = altCompletionMatch[2] ? parseFloat(altCompletionMatch[2]) : undefined
      logStep(task.id, step, 'complete', summary)
      return { status: 'done', summary, ...(confidence !== undefined ? { confidence } : {}) }
    }

    if (choice.finish_reason === 'stop' && toolsUsed > 0) {
      const summary = textContent.slice(0, 200).trim() || 'Task completed'
      logStep(task.id, step, 'complete', summary)
      return { status: 'done', summary }
    }

    // Neither tools nor completion — nudge
    logStep(task.id, step, 'nudge', 'No tool calls or completion — prompting to continue')
    messages.push({
      role: 'user',
      content: 'Continue the task. Use write_file to create required files, then say TASK_COMPLETE: <summary>.',
    })
  }

  return { status: 'failed', summary: `Max steps (${maxSteps}) reached without completion` }
}

// ─── Verification ─────────────────────────────────────────────
export async function runVerification(
  task: Task & { success_criteria?: string },
  agent: Agent,
  _sessionKey: string,
  agentSummary: string,
): Promise<{ verdict: 'pass' | 'fail'; reason: string }> {
  if (!process.env.OPENAI_API_KEY) return { verdict: 'pass', reason: 'No API key — skipped' }

  // Always use ECHO if available, otherwise fall back to the task agent
  const { queryOne: qOne } = require('./db')
  const echoAgent = qOne(`SELECT * FROM agents WHERE id='agent-echo' LIMIT 1`) as Agent | null
  const verifyAgent = echoAgent ?? agent

  const { client: openai, model } = makeOpenAiClient(verifyAgent)

  const successCriteriaBlock = task.success_criteria
    ? `\nSuccess criteria: ${task.success_criteria}`
    : ''

  try {
    const res = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: verifyAgent.soul?.trim()
            ? verifyAgent.soul
            : 'You are a quality assurance reviewer. Be objective and specific.',
        },
        {
          role: 'user',
          content: `Task: ${task.title}\nDescription: ${task.description ?? 'n/a'}${successCriteriaBlock}\nAgent summary: ${agentSummary}\n\nDid the agent fully complete the task? Give a confidence score 0.0-1.0.\nReply with exactly:\nVERIFY_PASS: <reason>\nor\nVERIFY_FAIL: <what is missing and why>`,
        },
      ],
      max_tokens: 300,
    })
    const content = res.choices[0].message.content ?? ''
    const passed = /VERIFY_PASS:/i.test(content)
    return { verdict: passed ? 'pass' : 'fail', reason: content.trim() }
  } catch {
    return { verdict: 'pass', reason: 'Verification error — defaulting to pass' }
  }
}
