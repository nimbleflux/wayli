# Fluxbase Edge Functions

This directory contains edge functions for your Fluxbase application.

## Configuration Files

- **deno.json** - Production configuration (uses npm:@fluxbase/sdk)
- **deno.dev.json** - Development configuration (uses local /fluxbase-sdk mount)

### Using Development Configuration

For local development with live SDK changes:

```bash
# In your edge function
export FLUXBASE_FUNCTIONS_DENO_CONFIG="deno.dev.json"

# Or symlink for easier use
ln -sf deno.dev.json deno.json
```

### Using Production Configuration

For production deployments:

```bash
# Ensure deno.json points to npm package
export FLUXBASE_FUNCTIONS_DENO_CONFIG="deno.json"

# Or symlink
ln -sf deno.json.prod deno.json
```

## Importing the Fluxbase SDK

With the import map configured, you can import the SDK easily:

```typescript
import { createClient } from '@fluxbase/sdk'

async function handler(req: any) {
  const client = createClient(
    Deno.env.get('FLUXBASE_BASE_URL')!,
    Deno.env.get('FLUXBASE_SERVICE_ROLE_KEY')!
  )

  // Use the SDK
  const { data, error } = await client
    .from('users')
    .select('*')
    .execute()

  return {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }
}
```

## Available Context

Edge functions receive:

- `req.user_id` - Authenticated user ID (if JWT provided)
- `req.method` - HTTP method
- `req.url` - Request URL
- `req.headers` - Request headers
- `req.body` - Request body (string)
- `req.params` - URL parameters

### Environment Variables

- `FLUXBASE_BASE_URL` - API base URL
- `FLUXBASE_SERVICE_ROLE_KEY` - Service role key for elevated access
- `FLUXBASE_ANON_KEY` - Anonymous key for public access

## File Structure

Functions use a flat file structure for simplicity:

```plaintext
functions/
├── deno.json                  # Import map configuration
├── deno.dev.json              # Development configuration
├── health.ts                  # Health check function
├── owntracks-points.ts        # GPS tracking function
├── trips-suggest-image.ts     # Image suggestion function
└── types.d.ts                 # Shared type definitions
```

Each function is a standalone TypeScript file containing all its logic and utilities.

## Automatic Function Deployment

Functions are automatically synced to Fluxbase when Wayli starts:

### How It Works

1. **Docker/Production:** Functions are synced during container startup (before nginx starts)
2. **Development:** Run `npm run sync-functions:dev` to manually sync functions

### Configuration

Environment variables:
- `FLUXBASE_BASE_URL` - Fluxbase API URL (required)
- `FLUXBASE_SERVICE_ROLE_KEY` - Service role key for deployment (required)
- `FLUXBASE_FUNCTIONS_NAMESPACE` - Namespace for functions (default: "wayli")
- `FLUXBASE_FUNCTIONS_DELETE_MISSING` - Delete functions not in sync (default: true)
- `SKIP_FUNCTION_SYNC` - Skip automatic sync on startup (default: false)

### Manual Sync

To manually sync functions:

```bash
# Development (from web directory)
# Automatically loads .env and .env.local files
npm run sync-functions:dev

# Production/Docker
# Uses environment variables from container
npm run sync-functions
```

**Note:** The sync script automatically loads environment variables from `.env.local` and `.env` files in development. Existing environment variables (e.g., from Docker) take precedence over file-based variables.

### Adding New Functions

Functions are **automatically discovered** from the `fluxbase/functions/` directory. Simply create a new `.ts` file with the appropriate JSDoc annotations:

```typescript
/**
 * My New Function
 * Description of what this function does
 *
 * @fluxbase:allow-net    // Allow network access (API calls, database)
 * @fluxbase:allow-env    // Allow reading environment variables
 * @fluxbase:allow-read   // Allow file system reads (optional)
 * @fluxbase:disabled     // Temporarily disable (optional)
 * @fluxbase:allow-unauthenticated  // Allow public access (optional)
 */

// Your function code here
interface FluxbaseRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  params: Record<string, string>;
}

interface FluxbaseResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

async function handler(req: FluxbaseRequest): Promise<FluxbaseResponse> {
  return {
    status: 200,
    body: JSON.stringify({ message: 'Hello from my function!' })
  };
}

export default handler;
```

**That's it!** The sync script will automatically:
- Discover your function on next startup
- Parse the JSDoc annotations for permissions
- Deploy it to Fluxbase

**Excluded files**: `types.d.ts`, `deno.json`, `README.md`, `test-*.ts`, and `*.test.ts` are automatically skipped.

## Local Testing

### Using the Test Tool (Recommended)

Fluxbase provides a local testing tool that mimics the production runtime:

```bash
# Test a simple function
/functions/test-function.ts test-sdk

# Test with custom body
/functions/test-function.ts database-access --body '{"table":"users","limit":5}'

# Test with authentication context
/functions/test-function.ts my-function \
  --user-id "123e4567-e89b-12d3-a456-426614174000" \
  --user-email "user@example.com" \
  --user-role "admin" \
  --session-id "session-123"

# Test with custom method
/functions/test-function.ts my-api --method GET
```

The test tool:
- ✅ Loads your function with the correct import maps
- ✅ Simulates the request object structure
- ✅ Shows execution time and detailed output
- ✅ Supports all authentication context (user_id, email, role, session)

### Manual Testing with Deno

You can also test directly with Deno:

```bash
cd /functions/my-function
deno run --allow-net --allow-env --allow-read \
  --config=../deno.dev.json \
  index.ts
```

### Testing via the SDK

Test deployed functions via the Fluxbase SDK:

```typescript
import { createClient } from '@fluxbase/sdk'

const client = createClient('http://localhost:8080', process.env.ANON_KEY!)

const { data, error } = await client.functions.invoke('my-function', {
  body: { test: 'data' }
})
```
