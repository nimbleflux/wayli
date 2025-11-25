#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read

/**
 * Fluxbase Edge Function Local Testing Tool
 *
 * Usage:
 *   deno run --allow-net --allow-env --allow-read /functions/test-function.ts <function-name> [options]
 *
 * Examples:
 *   ./test-function.ts test-sdk
 *   ./test-function.ts database-access --body '{"table":"users","limit":5}'
 *   ./test-function.ts my-function --method POST --user-id "123e4567-e89b-12d3-a456-426614174000"
 */

interface TestOptions {
  functionName: string
  method?: string
  url?: string
  headers?: Record<string, string>
  body?: string
  params?: Record<string, string>
  userId?: string
  userEmail?: string
  userRole?: string
  sessionId?: string
}

async function testFunction(options: TestOptions) {
  const {
    functionName,
    method = 'POST',
    url = `http://localhost:8080/api/v1/functions/${functionName}/invoke`,
    headers = {},
    body = '{}',
    params = {},
    userId,
    userEmail,
    userRole,
    sessionId,
  } = options

  console.log('🧪 Testing Edge Function:', functionName)
  console.log('━'.repeat(60))

  // Build the request object that mirrors what the function receives
  const request = {
    method,
    url,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body,
    params,
    user_id: userId,
    user_email: userEmail,
    user_role: userRole,
    session_id: sessionId,
  }

  console.log('📤 Request:')
  console.log(JSON.stringify(request, null, 2))
  console.log('━'.repeat(60))

  try {
    // Try to load and execute the function directly
    const functionPath = `/functions/${functionName}/index.ts`

    console.log(`📁 Loading function from: ${functionPath}`)

    // Import the function module
    const module = await import(functionPath)

    if (!module.default && typeof module.handler !== 'function') {
      throw new Error('Function must export a handler function or default export')
    }

    const handler = module.handler || module.default

    console.log('⚙️  Executing handler...')
    console.log('━'.repeat(60))

    const startTime = performance.now()
    const response = await handler(request)
    const duration = performance.now() - startTime

    console.log('✅ Response:')
    console.log(`   Status: ${response.status}`)
    if (response.headers) {
      console.log('   Headers:', response.headers)
    }
    if (response.body) {
      try {
        const parsed = JSON.parse(response.body)
        console.log('   Body:')
        console.log(JSON.stringify(parsed, null, 4))
      } catch {
        console.log('   Body:', response.body)
      }
    }
    console.log('━'.repeat(60))
    console.log(`⏱️  Execution time: ${duration.toFixed(2)}ms`)
    console.log('✅ Test completed successfully')

  } catch (error) {
    console.error('━'.repeat(60))
    console.error('❌ Test failed:')
    console.error(error)
    Deno.exit(1)
  }
}

// Parse command line arguments
function parseArgs(args: string[]): TestOptions {
  const functionName = args[0]

  if (!functionName) {
    console.error('Usage: test-function.ts <function-name> [options]')
    console.error('')
    console.error('Options:')
    console.error('  --method <METHOD>        HTTP method (default: POST)')
    console.error('  --body <JSON>            Request body as JSON string')
    console.error('  --user-id <UUID>         Authenticated user ID')
    console.error('  --user-email <EMAIL>     User email')
    console.error('  --user-role <ROLE>       User role')
    console.error('  --session-id <UUID>      Session ID')
    console.error('  --header <KEY:VALUE>     Add custom header (can be used multiple times)')
    console.error('')
    console.error('Examples:')
    console.error('  ./test-function.ts test-sdk')
    console.error('  ./test-function.ts database-access --body \'{"table":"users"}\'')
    console.error('  ./test-function.ts my-api --user-id "123..." --user-email "user@example.com"')
    Deno.exit(1)
  }

  const options: TestOptions = { functionName }
  const headers: Record<string, string> = {}

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    const nextArg = args[i + 1]

    switch (arg) {
      case '--method':
        options.method = nextArg
        i++
        break
      case '--body':
        options.body = nextArg
        i++
        break
      case '--user-id':
        options.userId = nextArg
        i++
        break
      case '--user-email':
        options.userEmail = nextArg
        i++
        break
      case '--user-role':
        options.userRole = nextArg
        i++
        break
      case '--session-id':
        options.sessionId = nextArg
        i++
        break
      case '--header':
        const [key, value] = nextArg.split(':')
        if (key && value) {
          headers[key.trim()] = value.trim()
        }
        i++
        break
    }
  }

  if (Object.keys(headers).length > 0) {
    options.headers = headers
  }

  return options
}

// Main execution
if (import.meta.main) {
  const options = parseArgs(Deno.args)
  await testFunction(options)
}
