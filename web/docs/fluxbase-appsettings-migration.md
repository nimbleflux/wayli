# Fluxbase AppSettingsManager Migration

## Overview

This document describes the migration from custom server settings management to using Fluxbase's built-in `AppSettingsManager` API.

## What Changed

### Before
The application used a custom `server-settings` endpoint that:
- Manually queried system settings for app configuration
- Stored all settings as custom key-value pairs in system settings
- Required custom code to manage authentication, email, and other settings

### After
The application now uses Fluxbase's `AppSettingsManager` which:
- Provides a structured, type-safe API for app settings
- Automatically handles authentication settings (signup, email verification, etc.)
- Manages email configuration (SMTP, SendGrid, Mailgun, SES)
- Supports password complexity and session management
- Still uses system settings for Wayli-specific custom settings

## AppSettingsManager API

### Available Methods

#### Authentication
```typescript
// Enable/disable user signup
await mgmtClient.admin.settings.app.enableSignup()
await mgmtClient.admin.settings.app.disableSignup()

// Email verification
await mgmtClient.admin.settings.app.setEmailVerificationRequired(true)

// Password requirements
await mgmtClient.admin.settings.app.setPasswordMinLength(12)
await mgmtClient.admin.settings.app.setPasswordComplexity({
  require_uppercase: true,
  require_lowercase: true,
  require_number: true,
  require_special: true
})

// Session management
await mgmtClient.admin.settings.app.setSessionSettings(
  timeoutMinutes: 60,
  maxSessionsPerUser: 5
)
```

#### Email Configuration
```typescript
// Enable/disable email
await mgmtClient.admin.settings.app.setEmailEnabled(true)

// Configure SMTP
await mgmtClient.admin.settings.app.configureSMTP({
  host: 'smtp.example.com',
  port: 587,
  username: 'user@example.com',
  password: 'password',
  use_tls: true,
  from_address: 'noreply@example.com',
  from_name: 'Wayli',
  reply_to_address: 'support@example.com'
})

// Or use other providers
await mgmtClient.admin.settings.app.configureSendGrid(apiKey, options)
await mgmtClient.admin.settings.app.configureMailgun(apiKey, domain, options)
await mgmtClient.admin.settings.app.configureSES(accessKeyId, secretAccessKey, region, options)
```

#### Features & Security
```typescript
// Feature toggles
await mgmtClient.admin.settings.app.setFeature('realtime', true)
await mgmtClient.admin.settings.app.setFeature('storage', true)
await mgmtClient.admin.settings.app.setFeature('functions', true)

// Rate limiting
await mgmtClient.admin.settings.app.setRateLimiting(true)
```

#### Retrieving Settings
```typescript
// Get all app settings
const appSettings = await mgmtClient.admin.settings.app.get()

// Returns:
// {
//   authentication: {
//     enable_signup: boolean,
//     enable_magic_link: boolean,
//     password_min_length: number,
//     require_email_verification: boolean
//   },
//   email: {
//     enabled: boolean,
//     provider: 'smtp' | 'sendgrid' | 'mailgun' | 'ses',
//     ...
//   },
//   features: {
//     enable_realtime: boolean,
//     enable_storage: boolean,
//     enable_functions: boolean
//   },
//   security: {
//     enable_global_rate_limit: boolean
//   }
// }
```

## Custom Wayli Settings

For Wayli-specific settings (like server name and Pexels API key), we continue to use the system settings with the `wayli.*` prefix:

```typescript
// Set custom setting
await mgmtClient.admin.settings.system.update('wayli.server_name', {
  value: { value: 'My Wayli Server' },
  description: 'Wayli server name for branding'
})

// Get custom settings
const { settings } = await mgmtClient.admin.settings.system.list()
const wayliSettings = settings.filter(s => s.key.startsWith('wayli.'))
```

## Updated Endpoints

### `/fluxbase/functions/server-settings`
Now returns both app settings and custom Wayli settings:
```json
{
  "success": true,
  "data": {
    "server_name": "Wayli",
    "is_setup_complete": true,
    "server_pexels_api_key_available": true,
    "signup_enabled": true,
    "email_verification_required": false,
    "email_enabled": true
  }
}
```

### `/fluxbase/functions/admin-settings`
Updated to use AppSettingsManager methods:
- GET: Returns both app settings and custom Wayli settings
- PUT: Uses appropriate AppSettingsManager methods for app settings
- PUT: Continues to use system settings for custom Wayli settings

## Benefits

1. **Type Safety**: AppSettingsManager provides structured types
2. **Consistency**: Settings follow Fluxbase conventions
3. **Validation**: Built-in validation for settings values
4. **Maintenance**: Less custom code to maintain
5. **Features**: Access to new Fluxbase features automatically
6. **Documentation**: Official Fluxbase documentation available

## Migration Path

If you need to migrate existing settings:

1. Authentication settings → Use AppSettingsManager methods
2. Email settings → Use `configureSMTP()` or other email methods
3. Custom Wayli settings → Keep in system settings with `wayli.*` prefix

## References

- [Fluxbase AppSettingsManager Documentation](https://fluxbase.eu/docs/api/sdk/classes/AppSettingsManager)
- [Server Settings Endpoint](../fluxbase/functions/server-settings/index.ts)
- [Admin Settings Endpoint](../fluxbase/functions/admin-settings/index.ts)
