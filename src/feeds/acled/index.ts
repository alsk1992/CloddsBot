/**
 * ACLED (Armed Conflict Location & Event Data) Feed
 *
 * Real-time conflict, protest, and political violence event tracking worldwide.
 * Requires API key (free for researchers/journalists).
 *
 * API docs: https://apidocs.acleddata.com
 */

import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface ACLEDEvent {
  eventId: string;
  eventDate: Date;
  year: number;
  eventType: ACLEDEventType;
  subEventType: string;
  actor1: string;
  actor2: string;
  interaction: number;
  region: string;
  country: string;
  admin1: string;
  admin2: string;
  admin3: string;
  location: string;
  latitude: number;
  longitude: number;
  source: string;
  sourceScale: string;
  notes: string;
  fatalities: number;
  timestamp: Date;
  tags?: string[];
}

export type ACLEDEventType =
  | 'Battles'
  | 'Explosions/Remote violence'
  | 'Violence against civilians'
  | 'Protests'
  | 'Riots'
  | 'Strategic developments';

export interface ACLEDQuery {
  /** ISO country code or country name */
  country?: string;
  /** Region name (e.g. 'Middle East', 'Eastern Africa') */
  region?: string;
  /** Filter by event type */
  eventType?: ACLEDEventType;
  /** Start date (YYYY-MM-DD) */
  startDate?: string;
  /** End date (YYYY-MM-DD) */
  endDate?: string;
  /** Minimum fatalities */
  minFatalities?: number;
  /** Full-text search in notes */
  keyword?: string;
  /** Max results (default 500, max 5000) */
  limit?: number;
}

export interface ACLEDSummary {
  country: string;
  totalEvents: number;
  totalFatalities: number;
  byType: Record<string, { count: number; fatalities: number }>;
  period: { start: string; end: string };
}

export interface ACLEDFeed extends EventEmitter {
  start(): Promise<void>;
  stop(): void;

  /** Query conflict events with filters */
  getEvents(query: ACLEDQuery): Promise<ACLEDEvent[]>;

  /** Get a summary of events for a country/region in a date range */
  getSummary(country: string, startDate: string, endDate: string): Promise<ACLEDSummary>;

  /** Get the latest events worldwide (last 7 days) */
  getLatest(limit?: number): Promise<ACLEDEvent[]>;

  /** Get events near a lat/lon within a radius (km) */
  getNearby(lat: number, lon: number, radiusKm: number, limit?: number): Promise<ACLEDEvent[]>;

  /** List available countries */
  getCountries(): Promise<string[]>;

  /** Get fatality trends for a country (monthly aggregates) */
  getTrends(country: string, months?: number): Promise<Array<{ month: string; events: number; fatalities: number }>>;
}

// =============================================================================
// API HELPERS
// =============================================================================

const BASE_URL = 'https://api.acleddata.com/acled/read';

interface ACLEDRawResponse {
  status: number;
  success: boolean;
  count: number;
  data: Array<{
    data_id: string;
    event_date: string;
    year: string;
    event_type: string;
    sub_event_type: string;
    actor1: string;
    actor2: string;
    interaction: string;
    region: string;
    country: string;
    admin1: string;
    admin2: string;
    admin3: string;
    location: string;
    latitude: string;
    longitude: string;
    source: string;
    source_scale: string;
    notes: string;
    fatalities: string;
    timestamp: string;
    tags?: string;
  }>;
}

function getCredentials(): { apiKey: string; email: string } {
  const apiKey = process.env.ACLED_API_KEY;
  const email = process.env.ACLED_EMAIL || '';
  if (!apiKey) {
    throw new Error('ACLED_API_KEY environment variable is required');
  }
  return { apiKey, email };
}

async function acledFetch(params: Record<string, string>): Promise<ACLEDRawResponse> {
  const { apiKey, email } = getCredentials();

  const queryParams = new URLSearchParams({
    key: apiKey,
    ...(email ? { email } : {}),
    ...params,
  });

  const url = `${BASE_URL}?${queryParams.toString()}`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`ACLED API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json() as ACLEDRawResponse;
  if (!data.success) {
    throw new Error(`ACLED API returned unsuccessful response`);
  }

  return data;
}

function parseEvent(raw: ACLEDRawResponse['data'][0]): ACLEDEvent {
  return {
    eventId: raw.data_id,
    eventDate: new Date(raw.event_date),
    year: parseInt(raw.year, 10),
    eventType: raw.event_type as ACLEDEventType,
    subEventType: raw.sub_event_type,
    actor1: raw.actor1,
    actor2: raw.actor2,
    interaction: parseInt(raw.interaction, 10),
    region: raw.region,
    country: raw.country,
    admin1: raw.admin1,
    admin2: raw.admin2,
    admin3: raw.admin3,
    location: raw.location,
    latitude: parseFloat(raw.latitude),
    longitude: parseFloat(raw.longitude),
    source: raw.source,
    sourceScale: raw.source_scale,
    notes: raw.notes,
    fatalities: parseInt(raw.fatalities, 10) || 0,
    timestamp: new Date(raw.timestamp ? parseInt(raw.timestamp, 10) * 1000 : raw.event_date),
    tags: raw.tags ? raw.tags.split('; ').filter(Boolean) : undefined,
  };
}

function buildQueryParams(query: ACLEDQuery): Record<string, string> {
  const params: Record<string, string> = {};

  if (query.country) params.country = query.country;
  if (query.region) params.region = query.region;
  if (query.eventType) params.event_type = query.eventType;
  if (query.startDate) params.event_date = `${query.startDate}|${query.endDate || new Date().toISOString().slice(0, 10)}`;
  if (query.endDate && !query.startDate) params.event_date = `|${query.endDate}`;
  if (query.minFatalities !== undefined) params.fatalities = `${query.minFatalities}|`;
  if (query.keyword) params.notes = query.keyword;
  params.limit = String(Math.min(query.limit || 500, 5000));

  return params;
}

// =============================================================================
// FACTORY
// =============================================================================

export async function createACLEDFeed(): Promise<ACLEDFeed> {
  const emitter = new EventEmitter() as ACLEDFeed;
  let running = false;

  emitter.start = async () => {
    running = true;
    logger.info('ACLED conflict feed started');
  };

  emitter.stop = () => {
    running = false;
    logger.info('ACLED conflict feed stopped');
  };

  emitter.getEvents = async (query: ACLEDQuery): Promise<ACLEDEvent[]> => {
    const params = buildQueryParams(query);
    const response = await acledFetch(params);
    return response.data.map(parseEvent);
  };

  emitter.getSummary = async (country: string, startDate: string, endDate: string): Promise<ACLEDSummary> => {
    const events = await emitter.getEvents({
      country,
      startDate,
      endDate,
      limit: 5000,
    });

    const byType: Record<string, { count: number; fatalities: number }> = {};
    let totalFatalities = 0;

    for (const evt of events) {
      totalFatalities += evt.fatalities;
      const existing = byType[evt.eventType];
      if (existing) {
        existing.count++;
        existing.fatalities += evt.fatalities;
      } else {
        byType[evt.eventType] = { count: 1, fatalities: evt.fatalities };
      }
    }

    return {
      country,
      totalEvents: events.length,
      totalFatalities,
      byType,
      period: { start: startDate, end: endDate },
    };
  };

  emitter.getLatest = async (limit = 100): Promise<ACLEDEvent[]> => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return emitter.getEvents({
      startDate: weekAgo.toISOString().slice(0, 10),
      endDate: now.toISOString().slice(0, 10),
      limit,
    });
  };

  emitter.getNearby = async (lat: number, lon: number, radiusKm: number, limit = 50): Promise<ACLEDEvent[]> => {
    // ACLED doesn't have a native radius query, so we compute a bounding box
    // and post-filter by haversine distance
    const latDelta = radiusKm / 111.32;
    const lonDelta = radiusKm / (111.32 * Math.cos(lat * Math.PI / 180));

    const params: Record<string, string> = {
      latitude: `${(lat - latDelta).toFixed(4)}|${(lat + latDelta).toFixed(4)}`,
      longitude: `${(lon - lonDelta).toFixed(4)}|${(lon + lonDelta).toFixed(4)}`,
      limit: String(Math.min(limit * 3, 5000)), // fetch extra, filter later
    };

    const response = await acledFetch(params);
    const events = response.data.map(parseEvent);

    // Haversine post-filter
    const filtered = events.filter(evt => {
      const R = 6371;
      const dLat = (evt.latitude - lat) * Math.PI / 180;
      const dLon = (evt.longitude - lon) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat * Math.PI / 180) * Math.cos(evt.latitude * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
      const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return dist <= radiusKm;
    });

    return filtered.slice(0, limit);
  };

  emitter.getCountries = async (): Promise<string[]> => {
    // ACLED has no dedicated countries endpoint. Return the most commonly
    // queried conflict-affected countries. API accepts both names and ISO codes.
    return [
      'Afghanistan', 'Algeria', 'Angola', 'Bangladesh', 'Brazil', 'Burkina Faso',
      'Cameroon', 'Central African Republic', 'Chad', 'Colombia', 'DR Congo',
      'Egypt', 'Ethiopia', 'Guatemala', 'Haiti', 'India', 'Indonesia', 'Iran',
      'Iraq', 'Israel', 'Kenya', 'Lebanon', 'Libya', 'Mali', 'Mexico',
      'Mozambique', 'Myanmar', 'Nicaragua', 'Niger', 'Nigeria', 'Pakistan',
      'Palestine', 'Peru', 'Philippines', 'Russia', 'Saudi Arabia', 'Somalia',
      'South Africa', 'South Sudan', 'Sudan', 'Syria', 'Thailand', 'Turkey',
      'Uganda', 'Ukraine', 'Venezuela', 'Yemen', 'Zimbabwe',
    ].sort();
  };

  emitter.getTrends = async (country: string, months = 12): Promise<Array<{ month: string; events: number; fatalities: number }>> => {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - months, 1);

    const events = await emitter.getEvents({
      country,
      startDate: startDate.toISOString().slice(0, 10),
      endDate: now.toISOString().slice(0, 10),
      limit: 5000,
    });

    // Group by month
    const monthlyMap = new Map<string, { events: number; fatalities: number }>();
    for (const evt of events) {
      const monthKey = `${evt.eventDate.getFullYear()}-${String(evt.eventDate.getMonth() + 1).padStart(2, '0')}`;
      const existing = monthlyMap.get(monthKey);
      if (existing) {
        existing.events++;
        existing.fatalities += evt.fatalities;
      } else {
        monthlyMap.set(monthKey, { events: 1, fatalities: evt.fatalities });
      }
    }

    // Sort chronologically
    return [...monthlyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({ month, ...data }));
  };

  return emitter;
}
