# Configuration

This document provides details on configuring the OpenClaw Command Deck application, including environment variables and settings.

## Environment Variables

The application may require specific environment variables to be set for proper configuration. Ensure that these variables are defined in your environment before running the application.

### Required Environment Variables

- **DATABASE_URL**: The connection string for the database.
- **API_KEY**: The key used for authenticating API requests.

## Configuration API

The application provides an API for retrieving and updating configuration settings.

### GET /api/config

This endpoint retrieves configuration values. You can request a specific key or all configuration rows.

#### Request Parameters

- **key** (optional): The specific configuration key you want to retrieve.

#### Response

- If a key is provided, the response will include the key and its corresponding value.
- If no key is provided, the response will return all configuration rows, including the keys, values, and the last updated timestamp.

### POST /api/config

This endpoint allows you to set configuration values.

#### Request Body

The body of the request must be a JSON object containing:

- **key**: The configuration key (required).
- **value**: The configuration value (required, must be a string).

#### Response

- Returns an error if the key is missing or if the value is not a string.
- On success, it returns a confirmation that the configuration has been updated.

### Example Usage

#### Retrieve a Specific Configuration

```http
GET /api/config?key=prime_directive
```

#### Update a Configuration

```http
POST /api/config
Content-Type: application/json

{
  "key": "prime_directive",
  "value": "new_value"
}
```

## Notes

- Ensure that any keys used in the configuration are unique.
- The application broadcasts configuration updates, so any changes made will be reflected in real-time for connected clients.
