// 🖥️ CLIENT SERVICES EXPORTS
// This file exports all client-side services

// Core services
export * from './service-layer-adapter';
export * from './session';

// API services
export * from './api';

// External services
export * from './external';

// Utility services
export * from './logging.service';
export * from './error-handler.service';
export * from './rate-limit.service';
export * from './job-creation.service';
export * from './location-cache.service';

// Feature services
export * from './trip-image-suggestion.service';
export * from './export.service';
export * from './export-processor.service';
export * from './audit-logger.service';
export * from './user-profile.service';
export * from './want-to-visit.service';
// Note: statistics.service removed - now using client-statistics.service
// Note: trip-detection.service removed - now running as Fluxbase job
export * from './trip-locations.service';
export * from './trips.service';
