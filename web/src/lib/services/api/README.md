# API Service Layer Documentation

This directory contains the client-side API service layer that provides a clean, unified interface for interacting with Fluxbase using direct SDK queries and Row-Level Security (RLS).

## 🏗️ Architecture Overview

The new architecture eliminates edge functions in favor of direct client-side Fluxbase SDK usage:

```
┌─────────────────────────────────────────────────────────────┐
│              Modern Client-Side Architecture                │
├─────────────────────────────────────────────────────────────┤
│  UI Components (Svelte)                                     │
│  ├── Pages (+page.svelte)                                   │
│  ├── Components (.svelte)                                   │
│  └── Stores (auth, session, jobs)                           │
├─────────────────────────────────────────────────────────────┤
│  ServiceAdapter (Unified API Interface)                     │
│  ├── Authentication (2FA, profile, preferences)             │
│  ├── Trips (CRUD, suggestions, locations)                   │
│  ├── Jobs (CRUD, export, import)                            │
│  ├── Admin (workers, users)                                 │
│  └── External APIs (Pelias geocoding, storage)              │
├─────────────────────────────────────────────────────────────┤
│  Fluxbase SDK (Direct Database Access)                      │
│  ├── fluxbase.auth.* (Authentication)                       │
│  ├── fluxbase.from('table') (CRUD operations)               │
│  ├── fluxbase.storage.* (File storage)                      │
│  └── fluxbase.functions.invoke() (3 remaining functions)    │
├─────────────────────────────────────────────────────────────┤
│  Row-Level Security (RLS)                                   │
│  ├── user_profiles: Users can access own profile            │
│  ├── user_preferences: Users can manage own preferences     │
│  ├── trips: Users can CRUD own trips                        │
│  ├── jobs: Users can CRUD own jobs                          │
│  ├── tracker_data: Users can access own data                │
│  └── workers: Admins can manage workers                     │
└─────────────────────────────────────────────────────────────┘
```

## 📁 Service Structure

### `service-adapter.ts` - Unified Service Adapter

The ServiceAdapter provides a single, cohesive interface for all API operations:

**Purpose**: Unified client-side API interface with direct Fluxbase SDK usage
**Architecture Shift**: Replaced 22 edge functions with direct database queries
**Security Model**: RLS policies enforce data access at database level

## 🔧 ServiceAdapter Methods

### Authentication & Profile

```typescript
// 2FA Management
await serviceAdapter.check2FA()        // fluxbase.auth.get2FAStatus()
await serviceAdapter.setup2FA()        // fluxbase.auth.setup2FA() + enable2FA()
await serviceAdapter.verify2FA(code)   // fluxbase.auth.verify2FA()
await serviceAdapter.disable2FA(code)  // fluxbase.auth.disable2FA()
await serviceAdapter.recover2FA(code)  // fluxbase.auth.verify2FA() with recovery

// Profile Management
await serviceAdapter.getProfile()                    // Direct query to user_profiles
await serviceAdapter.updateProfile(profileData)      // auth.updateUser() + table update

// Preferences Management
await serviceAdapter.getPreferences()                // Direct query to user_preferences
await serviceAdapter.updatePreferences(prefs)        // Direct upsert to user_preferences

// Password Management
await serviceAdapter.updatePassword(newPassword)     // fluxbase.auth.updateUser()
```

### Trips Management

```typescript
// Basic CRUD
const trips = await serviceAdapter.getTrips({ page, limit, search, status })
const trip = await serviceAdapter.createTrip(tripData)
const updated = await serviceAdapter.updateTrip(tripId, updates)

// Trip Suggestions (status='pending')
const suggested = await serviceAdapter.getSuggestedTrips()
await serviceAdapter.approveSuggestedTrips([tripIds])
await serviceAdapter.rejectSuggestedTrips([tripIds])
await serviceAdapter.clearAllSuggestedTrips()
await serviceAdapter.createTripFromSuggestion(tripId, updates)

// Trip Locations (bundled queries)
const data = await serviceAdapter.getTripsLocations(tripId)
// Returns: { trackerData, locations, poiVisits }

// Trip Exclusions (JSON array in user_preferences)
const exclusions = await serviceAdapter.getTripExclusions()
const created = await serviceAdapter.createTripExclusion(exclusionData)
const updated = await serviceAdapter.updateTripExclusion(id, data)
await serviceAdapter.deleteTripExclusion(id)
```

### Jobs Management

```typescript
// Job CRUD
const jobs = await serviceAdapter.getJobs({ page, limit, type })
const job = await serviceAdapter.createJob({ type, priority, ...data })
await serviceAdapter.cancelJob(jobId)
const progress = await serviceAdapter.getJobProgress(jobId)

// Export Jobs (delegates to getJobs)
const exportJobs = await serviceAdapter.getExportJobs({ page, limit })
const exportJob = await serviceAdapter.createExportJob({ format, dateRange })

// Import Progress (delegates to getJobs)
const importProgress = await serviceAdapter.getImportProgress()
```

### Admin Operations

```typescript
// Worker Management (admin only, enforced by RLS)
const workers = await serviceAdapter.getAdminWorkers()
await serviceAdapter.manageWorkers({ action, workerId, data })

// User Management (admin only, enforced by RLS)
const users = await serviceAdapter.getAdminUsers({ page, limit, search, role })
```

### External APIs & Utilities

```typescript
// Geocoding (direct Pelias API calls)
const results = await serviceAdapter.searchGeocode(query)

// Storage (signed URLs)
const url = await serviceAdapter.getExportDownloadUrl(fileName)

// POI Visits
const visits = await serviceAdapter.getPOIVisits(tripId)
await serviceAdapter.detectPOIVisits({ ... })
```

## 🚀 Usage Examples

### Authentication Flow

```typescript
// Sign in with 2FA support
const { data, error } = await fluxbase.auth.signInWithPassword({ email, password })

// Check if 2FA required (built into SDK response)
if (data && 'requires_2fa' in data && data.requires_2fa) {
  // Redirect to 2FA verification
  goto(`/auth/2fa-verify?email=${email}`)
} else {
  // User signed in successfully
  const session = data.session
}

// Get 2FA status
const serviceAdapter = new ServiceAdapter({ session })
const { enabled } = await serviceAdapter.check2FA()
```

### Trip Management

```typescript
const serviceAdapter = new ServiceAdapter({ session })

// Get paginated trips with search
const { trips, pagination } = await serviceAdapter.getTrips({
  page: 1,
  limit: 20,
  search: 'vacation',
  status: 'approved'
})

// Create trip with automatic distance calculation
const trip = await serviceAdapter.createTrip({
  title: 'Summer Vacation',
  start_date: '2024-07-01',
  end_date: '2024-07-15',
  user_id: userId
})

// Update trip (recalculates distance)
await serviceAdapter.updateTrip(tripId, {
  title: 'Updated Vacation'
})
```

### Job Management

```typescript
// Create export job
const job = await serviceAdapter.createExportJob({
  format: 'gpx',
  date_from: '2024-01-01',
  date_to: '2024-12-31'
})

// Monitor job progress
const progress = await serviceAdapter.getJobProgress(job.id)

// Cancel job (auto-creates reverse geocoding job for imports)
await serviceAdapter.cancelJob(job.id)
```

### Admin Operations

```typescript
// Get all users (admin only)
const { users, pagination } = await serviceAdapter.getAdminUsers({
  page: 1,
  limit: 50,
  search: 'john',
  role: 'user'
})

// Manage workers (admin only)
await serviceAdapter.manageWorkers({
  action: 'create',
  data: { name: 'Worker-1', capacity: 10 }
})
```

## 🔒 Security Model

### Row-Level Security (RLS) Policies

All data access is secured at the database level using RLS policies:

```sql
-- Example: Users can only access their own trips
CREATE POLICY "Users can view their own trips" ON trips
  FOR SELECT USING (auth.uid() = user_id);

-- Example: Admins can manage workers
CREATE POLICY "Admins can manage workers" ON workers
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
```

**Benefits:**
- ✅ Security enforced at database level (can't bypass)
- ✅ No need for edge functions to check permissions
- ✅ Consistent security across all access methods
- ✅ Automatic filtering of unauthorized data

### Authentication

```typescript
// Session is passed to ServiceAdapter constructor
const serviceAdapter = new ServiceAdapter({ session })

// Fluxbase SDK automatically includes auth token in all requests
const { data } = await fluxbase.from('trips').select('*')
// RLS policies automatically filter to current user's trips
```

## 📊 Architecture Benefits

### Eliminated Edge Functions (88% Reduction)

**Before:** 25 edge functions
**After:** 3 edge functions (health, owntracks-points, trips-suggest-image)
**Removed:** 22 functions replaced with direct SDK calls

**Benefits:**
- ✅ No cold starts (functions run client-side)
- ✅ Simpler deployment (fewer functions to manage)
- ✅ Better performance (direct database queries)
- ✅ Easier debugging (all code in one place)
- ✅ Lower cost (no function execution fees)

### Direct Database Access

```typescript
// ❌ Old: Edge function call (slow, cold starts)
const { data } = await fluxbase.functions.invoke('get-trips', { page: 1 })

// ✅ New: Direct query (fast, no cold start)
const { data } = await fluxbase
  .from('trips')
  .select('*')
  .eq('user_id', userId)
  .range(0, 19)
```

### Client-Side Business Logic

Business logic now runs client-side with helper methods:

```typescript
// Distance calculation helper
private async calculateTripDistance(tripId: string, userId: string): Promise<number> {
  const { data } = await fluxbase
    .from('tracker_data')
    .select('distance')
    .eq('trip_id', tripId)
    .eq('user_id', userId)

  return data?.reduce((sum, row) => sum + (row.distance || 0), 0) || 0
}

// Auto-job creation on cancel
if (originalJob.type === 'import' && originalJob.status === 'completed') {
  await this.createJob({
    type: 'reverse_geocoding',
    priority: 'normal',
    created_by: userId
  })
}
```

## 🧪 Testing

### Service Adapter Testing

```typescript
import { describe, it, expect, vi } from 'vitest'
import { ServiceAdapter } from './service-adapter'

describe('ServiceAdapter', () => {
  it('should get trips with pagination', async () => {
    const mockSession = { user: { id: 'user123' } }
    const adapter = new ServiceAdapter({ session: mockSession })

    const result = await adapter.getTrips({ page: 1, limit: 10 })

    expect(result.trips).toBeDefined()
    expect(result.pagination).toBeDefined()
  })
})
```

## 🔄 Migration Guide

### From Edge Functions to Direct SDK

```typescript
// ❌ Old: Edge function
const { data, error } = await fluxbase.functions.invoke('auth-preferences', {
  method: 'GET'
})

// ✅ New: Direct query
const { data, error } = await fluxbase
  .from('user_preferences')
  .select('*')
  .eq('id', userId)
  .single()
```

### From Server-Side to Client-Side

```typescript
// ❌ Old: Server-side validation in edge function
if (!isAdmin) {
  return { error: 'Unauthorized' }
}

// ✅ New: RLS policy enforces at database level
// No code needed - RLS policy automatically enforces admin-only access
```

## 🔮 Future Enhancements

### 1. Optimistic Updates

```typescript
// Update UI immediately, rollback on error
const optimisticTrip = { ...trip, title: newTitle }
updateUIOptimistically(optimisticTrip)

try {
  await serviceAdapter.updateTrip(tripId, { title: newTitle })
} catch (error) {
  rollbackUI(trip)
}
```

### 2. Request Deduplication

```typescript
// Prevent duplicate requests for same data
const cachedResult = requestCache.get(cacheKey)
if (cachedResult) return cachedResult

const result = await serviceAdapter.getTrips(query)
requestCache.set(cacheKey, result)
```

### 3. Real-time Subscriptions

```typescript
// Subscribe to real-time updates
const subscription = fluxbase
  .from('jobs')
  .on('UPDATE', payload => {
    updateJobProgress(payload.new)
  })
  .subscribe()
```

## 📝 Summary

The ServiceAdapter provides a modern, efficient API layer that:

- **Eliminates edge functions** (88% reduction)
- **Uses direct Fluxbase SDK** for all operations
- **Enforces security via RLS** at database level
- **Runs business logic client-side** for better performance
- **Provides unified interface** for all API operations
- **Simplifies deployment** with fewer moving parts

This architecture is more performant, easier to maintain, and provides a better developer experience than the previous edge function-based approach.
