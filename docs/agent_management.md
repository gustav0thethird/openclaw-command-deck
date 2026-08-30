# Agent Management

This document outlines the management of agents within the OpenClaw Command Deck, including their creation, updates, and deletions.

## Creating an Agent

To create a new agent, send a POST request to the `/api/agents` endpoint with the following JSON body:

```json
{
  "name": "Agent Name",
  "openclaw_id": "main",
  "room": "engineering",
  "model_primary": "model_name",
  "model_fallbacks": ["fallback_model1", "fallback_model2"],
  "soul": "agent_soul",
  "github_url": "https://github.com/user/repo"
}
```

### Required Fields
- `name`: The name of the agent (required).

### Optional Fields
- `openclaw_id`: Identifier for the OpenClaw instance (default is 'main').
- `room`: The room where the agent is assigned (default is 'engineering').
- `model_primary`: The primary model used by the agent (default is 'local-gpu/local-ai').
- `model_fallbacks`: An array of fallback models.
- `soul`: The soul attribute of the agent.
- `github_url`: A URL to the agent's GitHub repository.

### Response
Upon successful creation, the response will include the newly created agent's details and a status code of 201.

## Updating an Agent

To update an existing agent, send a PATCH request to the `/api/agents` endpoint with the following JSON body:

```json
{
  "id": "agent-id",
  "name": "Updated Agent Name",
  "openclaw_id": "new_openclaw_id",
  "room": "new_room",
  "model_primary": "new_model_name",
  "model_fallbacks": ["new_fallback_model1"],
  "soul": "new_agent_soul",
  "status": "new_status",
  "github_url": "https://github.com/user/new_repo"
}
```

### Required Fields
- `id`: The unique identifier of the agent to be updated (required).

### Allowed Fields
- `name`
- `openclaw_id`
- `room`
- `model_primary`
- `model_fallbacks`
- `soul`
- `status`
- `github_url`

### Response
Upon successful update, the response will include the updated agent's details.

## Deleting an Agent

To delete an agent, send a DELETE request to the `/api/agents` endpoint with the following JSON body:

```json
{
  "id": "agent-id"
}
```

### Required Fields
- `id`: The unique identifier of the agent to be deleted (required).

### Constraints
- An agent cannot be deleted if it is the last agent in the system.

### Response
Upon successful deletion, the response will confirm the action with an `{ "ok": true }` message. If the deletion is not permitted, an error message will be returned.
