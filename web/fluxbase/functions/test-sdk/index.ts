/**
 * Test SDK Import Function
 *
 * This function demonstrates that the SDK can be imported and used within edge functions.
 * It's a simple test to verify the import map configuration works correctly.
 */

import { createClient } from '@fluxbase/sdk'
import { corsHeaders } from '_shared/cors.ts'

interface Request {
  method: string
  url: string
  headers: Record<string, string>
  body: string
  params: Record<string, string>
  user_id?: string
  user_email?: string
  user_role?: string
  session_id?: string
}

interface Response {
  status: number
  headers?: Record<string, string>
  body?: string
}

async function handler(req: Request): Promise<Response> {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return {
      status: 204,
      headers: corsHeaders(),
      body: ''
    }
  }

  try {
    // Verify SDK import worked
    const sdkImported = typeof createClient === 'function'

    // Get environment variables
    const baseUrl = Deno.env.get('FLUXBASE_BASE_URL')
    const serviceKey = Deno.env.get('FLUXBASE_SERVICE_ROLE_KEY')

    // Test creating a client (without actually using it)
    let clientCreated = false
    if (baseUrl && serviceKey) {
      try {
        const client = createClient(baseUrl, serviceKey)
        clientCreated = typeof client === 'object'
      } catch (error) {
        console.error('Failed to create client:', error)
      }
    }

    return {
      status: 200,
      headers: {
        ...corsHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        message: 'SDK import test successful!',
        checks: {
          sdkImported,
          clientCreated,
          hasBaseUrl: !!baseUrl,
          hasServiceKey: !!serviceKey
        },
        userContext: {
          user_id: req.user_id || null,
          user_email: req.user_email || null,
          user_role: req.user_role || null,
          session_id: req.session_id || null
        }
      }, null, 2)
    }
  } catch (error) {
    console.error('Error in SDK test:', error)
    return {
      status: 500,
      headers: {
        ...corsHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: String(error)
      })
    }
  }
}
