# Architecture

The architecture of the `openclaw-command-deck` application is structured around a modular design that facilitates interaction between various components. Below is an overview of the key components and their interactions.

## Components

### API Layer

The application exposes a RESTful API through various endpoints organized under the `app/src/app/api` directory. Each endpoint is responsible for handling specific functionalities:

- **Activity API** (`activity/route.ts`): Manages activity logs, allowing retrieval based on task and agent IDs.
- **Agents API** (`agents/route.ts`): Handles CRUD operations for agents, including creating, updating, and deleting agent records.
- **Chat API** (`chat/route.ts` and `chat/approve/route.ts`): Manages chat interactions and HITL (Human-In-The-Loop) approvals.
- **Dispatch API** (`dispatch/route.ts`): Responsible for dispatching tasks to agents.
- **Knowledge API** (`knowledge/route.ts`): Manages knowledge-related queries.
- **Status API** (`status/route.ts`): Provides status information about the application.

### Database Layer

The application interacts with a database through a set of utility functions defined in `app/src/lib/db.ts`. These functions include:

- `queryAll`: Executes a query and returns all results.
- `run`: Executes a query that modifies data (INSERT, UPDATE, DELETE).
- `queryOne`: Executes a query and returns a single result.

### Event Handling

The application utilizes an event-driven architecture for real-time updates. The `app/src/lib/events.ts` module provides a `broadcast` function that allows components to emit events, such as updates to agents. This is particularly useful for notifying clients of changes in the state of agents.

### Instrumentation

The application includes instrumentation for monitoring and logging. The `app/instrumentation.ts` file initializes the sentinel service, which is responsible for monitoring the application's health and performance.

### Scheduler

The `app/src/lib/scheduler.ts` module is responsible for scheduling tasks and managing their execution. This component interacts with the database to retrieve tasks and update their statuses.

### Gateway

The `app/src/lib/gateway.ts` module serves as an entry point for external communications, handling requests from clients and routing them to the appropriate API endpoints.

### Frontend

The frontend is built using Next.js, with components organized under `app/src/components`. Key components include:

- **StarField**: A visual component for displaying a star field.
- **StationControl**: A control interface for managing agent interactions.

### Configuration

The application configuration is managed through `app/next.config.mjs` and `app/package.json`, which define the environment settings and dependencies required for the application to run.

## Interaction Between Components

1. **Client Requests**: Clients interact with the application through the API endpoints. For example, a client may send a request to create a new agent via the Agents API.

2. **Database Operations**: The API layer communicates with the database using the utility functions. For instance, when creating an agent, the API will call `run` to insert the new agent into the database.

3. **Event Broadcasting**: After an agent is created, the Agents API broadcasts an event to notify other components of the change. This allows for real-time updates in the frontend.

4. **Task Scheduling**: The Scheduler retrieves tasks from the database and manages their execution, updating their statuses as needed.

5. **Monitoring**: The instrumentation module runs on server start, initializing monitoring services to track application performance and health.

This modular architecture allows for clear separation of concerns, making the application easier to maintain and extend. Each component can be developed and tested independently, while still interacting seamlessly with the rest of the system.
