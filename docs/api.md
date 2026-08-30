# API Reference

## Activity Log

### GET /api/activity
Retrieve activity logs with optional filtering.

**Query Parameters:**
- `limit`: Number of records to return (default: 100).
- `taskId`: Filter by specific task ID.
- `agentId`: Filter by specific agent ID.

**Response:**
Returns a JSON array of activity logs.

---

## Agents

### GET /api/agents
Retrieve a list of all agents.

**Response:**
Returns a JSON array of agents.

### POST /api/agents
Create a new agent.

**Request Body:**
```json
{
  "name": "string",
  "openclaw_id": "string (optional, default: 'main')",
  "room": "string (optional, default: 'engineering')",
  "model_primary": "string",
  "model_fallbacks": "array (optional)",
  "soul": "string (optional)",
  "github_url": "string (optional)"
}
```

**Response:**
Returns the created agent object.

### PATCH /api/agents
Update an existing agent.

**Request Body:**
```json
{
  "id": "string",
  "name": "string (optional)",
  "openclaw_id": "string (optional)",
  "room": "string (optional)",
  "model_primary": "string (optional)",
  "model_fallbacks": "array (optional)",
  "soul": "string (optional)",
  "status": "string (optional)",
  "github_url": "string (optional)"
}
```

**Response:**
Returns the updated agent object.

### DELETE /api/agents
Delete an agent.

**Request Body:**
```json
{
  "id": "string"
}
```

**Response:**
Returns a confirmation object.

---

## Chat

### POST /api/chat
Interact with the ARIA Chat system.

**Request Body:**
Depends on the specific interaction.

**Response:**
Returns the chat response.

### POST /api/chat/approve
Approve or deny a pending HITL action.

**Request Body:**
```json
{
  "id": "string",
  "approved": "boolean"
}
```

**Response:**
Returns the result of the approval process.

---

## Configuration

### GET /api/config
Retrieve configuration values.

**Query Parameters:**
- `key`: Specific configuration key to retrieve.

**Response:**
Returns the configuration value or all configuration rows.

### POST /api/config
Set a configuration value.

**Request Body:**
```json
{
  "key": "string",
  "value": "string"
}
```

**Response:**
Returns a confirmation object.

---

## Debug

### GET /api/debug
Retrieve a full system snapshot.

**Response:**
Returns a JSON object with system statistics.

### GET /api/debug/task/[id]
Retrieve detailed information about a specific task.

**Response:**
Returns task details, including steps, logs, and workspace files.

---

## Dispatch

### POST /api/dispatch
Dispatch a task.

**Request Body:**
```json
{
  "taskId": "string"
}
```

**Response:**
Returns a confirmation object.

---

## Epics

### GET /api/epics
Retrieve a list of epics.

**Response:**
Returns a JSON array of epics.

### GET /api/epics/[id]
Retrieve details of a specific epic.

**Response:**
Returns the epic details.

---

## Files

### GET /api/files
Retrieve a list of files.

**Response:**
Returns a JSON array of files.

### GET /api/files/view
View a specific file.

**Response:**
Returns the file content.

### GET /api/files/download
Download a specific file.

**Response:**
Returns the file for download.

---

## Schedules

### GET /api/schedules
Retrieve a list of schedules.

**Response:**
Returns a JSON array of schedules.

### GET /api/schedules/[id]
Retrieve details of a specific schedule.

**Response:**
Returns the schedule details.

---

## Skills

### GET /api/skills
Retrieve a list of skills.

**Response:**
Returns a JSON array of skills.

### GET /api/skills/[id]
Retrieve details of a specific skill.

**Response:**
Returns the skill details.

---

## Status

### GET /api/status
Retrieve the current status of the application.

**Response:**
Returns a JSON object with status information.

---

## Tasks

### GET /api/tasks
Retrieve a list of tasks.

**Response:**
Returns a JSON array of tasks.

### GET /api/tasks/[id]
Retrieve details of a specific task.

**Response:**
Returns the task details.

### PATCH /api/tasks/[id]/unblock
Unblock a specific task.

**Response:**
Returns a confirmation object.

### POST /api/tasks
Create a new task.

**Request Body:**
```json
{
  "title": "string",
  "description": "string (optional)",
  "priority": "string (optional)",
  "agent_id": "string (optional)",
  "dispatch": "boolean (optional)"
}
```

**Response:**
Returns the created task object.

---

## Test

### GET /api/test
Run a test endpoint.

**Response:**
Returns a confirmation object.
