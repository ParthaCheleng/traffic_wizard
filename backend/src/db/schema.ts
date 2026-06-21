import { pgTable, uuid, timestamp, doublePrecision, varchar, integer, geometry } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Users table (maps to Supabase Auth)
export const users = pgTable('users', {
  id: uuid('id').primaryKey(), // We'll link this to Supabase's auth.users.id
  createdAt: timestamp('created_at').defaultNow(),
});

// Real-time device locations
export const deviceLocations = pgTable('device_locations', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id),
  // PostGIS Point geometry
  location: geometry('location', { type: 'point', srid: 4326 }).notNull(),
  heading: doublePrecision('heading'),
  speedKmh: doublePrecision('speed_kmh'),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
});

// Traffic hotspots computed from clustered telemetry
export const trafficHotspots = pgTable('traffic_hotspots', {
  id: uuid('id').defaultRandom().primaryKey(),
  // PostGIS Polygon geometry representing the hotspot area
  area: geometry('area', { type: 'polygon', srid: 4326 }).notNull(),
  severityLevel: integer('severity_level').notNull(),
  aiSummary: varchar('ai_summary', { length: 500 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
});
