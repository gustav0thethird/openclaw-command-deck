# ARIA Chat

ARIA Chat is a feature that integrates OpenAI's capabilities with a human-in-the-loop (HITL) tool approval system. This allows users to interact with the system through a chat interface, leveraging AI to perform various tasks while ensuring that critical actions are approved by a human operator.

## Capabilities

### OpenAI Integration
- Utilizes OpenAI's API for generating responses and executing commands.
- Supports streaming responses for real-time interaction.

### Tool Functionality
ARIA Chat provides a set of predefined tools that can be invoked during a chat session. These tools include:

1. **List Tasks**: Retrieve current tasks with their statuses.
2. **List Agents**: Get a list of all agents available in the system.
3. **Create Task**: Create a new task and optionally dispatch it.
4. **Read Source File**: Access a file from the Mission Control source code.
5. **List Source Files**: List files in a specified directory of the source code.
6. **Write Source File**: Update or create a file in the source code (requires approval).
7. **Git Status**: Show the current git status of the codebase.
8. **Git Diff**: Display uncommitted changes in the codebase.
9. **Git Log**: Show recent commits in the repository.
10. **Git Commit and Push**: Commit changes and push to GitHub (requires approval).

### HITL Approval Process
Certain actions, such as writing to source files or committing changes, require user approval. The approval process involves:

- Submitting a request for approval when an action is initiated.
- The system generates a placeholder message indicating that the action is awaiting approval.
- Users can approve or deny the action, which updates the status in the database and modifies the chat message accordingly.

## Usage

To use the ARIA Chat feature, follow these steps:

1. **Initiate a Chat Session**: Start a chat session through the designated interface.
2. **Invoke Tools**: Use the available tools by specifying the desired action in the chat.
3. **Handle Approvals**: If an action requires approval, monitor the chat for notifications and respond accordingly.
4. **Review Responses**: Analyze the AI-generated responses and take further actions as needed.

## API Endpoints

### Chat Route
The main endpoint for ARIA Chat is defined in `app/src/app/api/chat/route.ts`. This endpoint handles incoming chat messages and processes requests to invoke tools.

### Approval Route
The approval process is managed through the endpoint located at `app/src/app/api/chat/approve/route.ts`. This endpoint allows users to approve or deny pending actions.

## Conclusion
ARIA Chat combines AI capabilities with a structured approval process, enabling efficient task management while maintaining oversight on critical actions. Users can leverage this feature to enhance their workflow and ensure that important decisions are made with human input.
