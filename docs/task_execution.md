# Task Execution

## Overview

In the `openclaw-command-deck` system, tasks are executed through a structured process that involves various states and interactions. The execution of tasks is managed primarily through a ReAct loop, which facilitates the handling of tasks, their statuses, and user interactions.

### Task Management

Tasks are stored in a database and can be created, updated, retrieved, or deleted through a set of API endpoints. Each task has attributes such as `title`, `description`, `status`, `mode`, `agent_id`, `priority`, `due_date`, and `tags`. The status of a task can vary, including states like `backlog`, `blocked`, and others.

#### Creating a Task

Tasks can be created using a POST request to the `/api/tasks` endpoint. The required fields include `title`, while `description`, `mode`, `agent_id`, `priority`, `due_date`, and `tags` are optional. Upon creation, the task is initialized with a status of `backlog`.

#### Updating a Task

Tasks can be updated via a PATCH request to the `/api/tasks/[id]` endpoint. The allowed fields for updates include `title`, `description`, `status`, `mode`, `agent_id`, `result`, `error`, `priority`, `due_date`, and `tags`. If the task's status is updated, an activity log is generated to track changes.

#### Deleting a Task

Tasks can be deleted using a DELETE request to the `/api/tasks/[id]`. This action removes the task from the database and logs the deletion activity.

### Task Execution Loop

The ReAct loop is a core component of task execution. It operates by continuously checking the status of tasks and responding to changes or user inputs. The loop ensures that tasks are processed in a timely manner and that any blocked tasks can be unblocked and re-dispatched.

#### Handling Blocked Tasks

When a task is blocked, it requires user input to proceed. A POST request to the `/api/tasks/[id]/unblock` endpoint allows users to provide an answer to unblock the task. The user's response is prepended to the task's description, and the task's status is updated to `backlog`. The task is then immediately re-dispatched for processing.

### Task Steps

Each task can have multiple steps associated with it, which can be retrieved using a GET request to the `/api/tasks/steps` endpoint. This allows for tracking the progress of a task through its various stages.

### Event Broadcasting

Throughout the task execution process, events are broadcasted to notify other components of the system about changes in task status or updates. This ensures that all parts of the system remain synchronized and responsive to user actions and task changes.

### Conclusion

The task execution mechanism in the `openclaw-command-deck` system is designed to be efficient and responsive, leveraging a ReAct loop to manage task states and user interactions effectively. This structured approach allows for clear tracking and management of tasks throughout their lifecycle.
