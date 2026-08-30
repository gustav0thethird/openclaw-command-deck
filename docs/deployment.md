# Deployment

This document provides instructions for deploying the OpenClaw Command Deck application using Docker.

## Prerequisites

Ensure you have Docker and Docker Compose installed on your machine.

## Building and Running the Application

1. **Clone the Repository**

   Clone the repository to your local machine:

   ```bash
   git clone <repository-url>
   cd openclaw-command-deck
   ```

2. **Create a `.env` File**

   Create a `.env` file in the root of the project to define environment variables. You may need to specify paths for identity, Git root, and vault as follows:

   ```env
   IDENTITY_PATH=~/.openclaw/identity
   GIT_ROOT_PATH=~/projects/mission-control
   VAULT_PATH=~/mission-vault
   ```

3. **Build and Start the Docker Container**

   Use Docker Compose to build and start the application:

   ```bash
   docker-compose up --build
   ```

   This command will:

   - Build the Docker image defined in the `Dockerfile`.
   - Start the `mission-control` service, which runs the application.

4. **Access the Application**

   Once the application is running, you can access it at `http://localhost:4000`.

## Docker Configuration

The `docker-compose.yml` file defines the following configuration for the `mission-control` service:

- **Build Context**: The Dockerfile is located in the root directory.
- **Working Directory**: The working directory inside the container is set to `/app`.
- **Entrypoint**: The entrypoint runs TypeScript checks, builds the application, and starts the Next.js server on port 4000.
- **Ports**: The container port 4000 is mapped to the host port 4000.
- **Environment Variables**: Environment variables are loaded from the `.env` file.
- **Volumes**: Several volumes are mounted to persist data and share files between the host and the container.
- **Restart Policy**: The container will restart unless stopped.

## Stopping the Application

To stop the application, press `CTRL+C` in the terminal where Docker Compose is running. To remove the containers, run:

```bash
docker-compose down
```

This command will stop and remove the containers defined in the `docker-compose.yml` file.
