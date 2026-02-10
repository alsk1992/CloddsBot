/**
 * NOAA Weather API Client
 *
 * Free weather data from the National Weather Service (no API key required).
 * Provides forecasts, current conditions, and historical data.
 */

import { logger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface NOAAPoint {
  gridId: string;           // Office ID (e.g., "OKX" for New York)
  gridX: number;
  gridY: number;
  forecastUrl: string;
  forecastHourlyUrl: string;
  observationStationsUrl: string;
  city?: string;
  state?: string;
  timezone: string;
}

export interface ForecastPeriod {
  number: number;
  name: string;              // "Tonight", "Saturday", etc.
  startTime: string;
  endTime: string;
  isDaytime: boolean;
  temperature: number;
  temperatureUnit: 'F' | 'C';
  temperatureTrend?: string;
  probabilityOfPrecipitation: {
    value: number | null;
    unitCode: string;
  };
  dewpoint?: {
    value: number;
    unitCode: string;
  };
  relativeHumidity?: {
    value: number;
    unitCode: string;
  };
  windSpeed: string;
  windDirection: string;
  icon: string;
  shortForecast: string;
  detailedForecast: string;
}

export interface WeatherForecast {
  location: string;
  generatedAt: string;
  periods: ForecastPeriod[];
}

export interface HourlyForecast {
  location: string;
  generatedAt: string;
  periods: ForecastPeriod[];
}

export interface CurrentObservation {
  station: string;
  timestamp: string;
  temperature: number;
  temperatureUnit: 'F' | 'C';
  humidity: number;
  windSpeed: number;
  windDirection: string;
  description: string;
  precipitationLastHour?: number;
}

// City coordinates for major US cities
export const CITY_COORDINATES: Record<string, { lat: number; lon: number; name: string }> = {
  'new york': { lat: 40.7128, lon: -74.0060, name: 'New York, NY' },
  'nyc': { lat: 40.7128, lon: -74.0060, name: 'New York, NY' },
  'los angeles': { lat: 34.0522, lon: -118.2437, name: 'Los Angeles, CA' },
  'la': { lat: 34.0522, lon: -118.2437, name: 'Los Angeles, CA' },
  'chicago': { lat: 41.8781, lon: -87.6298, name: 'Chicago, IL' },
  'houston': { lat: 29.7604, lon: -95.3698, name: 'Houston, TX' },
  'phoenix': { lat: 33.4484, lon: -112.0740, name: 'Phoenix, AZ' },
  'philadelphia': { lat: 39.9526, lon: -75.1652, name: 'Philadelphia, PA' },
  'san antonio': { lat: 29.4241, lon: -98.4936, name: 'San Antonio, TX' },
  'san diego': { lat: 32.7157, lon: -117.1611, name: 'San Diego, CA' },
  'dallas': { lat: 32.7767, lon: -96.7970, name: 'Dallas, TX' },
  'san jose': { lat: 37.3382, lon: -121.8863, name: 'San Jose, CA' },
  'austin': { lat: 30.2672, lon: -97.7431, name: 'Austin, TX' },
  'jacksonville': { lat: 30.3322, lon: -81.6557, name: 'Jacksonville, FL' },
  'fort worth': { lat: 32.7555, lon: -97.3308, name: 'Fort Worth, TX' },
  'columbus': { lat: 39.9612, lon: -82.9988, name: 'Columbus, OH' },
  'charlotte': { lat: 35.2271, lon: -80.8431, name: 'Charlotte, NC' },
  'san francisco': { lat: 37.7749, lon: -122.4194, name: 'San Francisco, CA' },
  'sf': { lat: 37.7749, lon: -122.4194, name: 'San Francisco, CA' },
  'indianapolis': { lat: 39.7684, lon: -86.1581, name: 'Indianapolis, IN' },
  'seattle': { lat: 47.6062, lon: -122.3321, name: 'Seattle, WA' },
  'denver': { lat: 39.7392, lon: -104.9903, name: 'Denver, CO' },
  'washington': { lat: 38.9072, lon: -77.0369, name: 'Washington, DC' },
  'dc': { lat: 38.9072, lon: -77.0369, name: 'Washington, DC' },
  'boston': { lat: 42.3601, lon: -71.0589, name: 'Boston, MA' },
  'nashville': { lat: 36.1627, lon: -86.7816, name: 'Nashville, TN' },
  'detroit': { lat: 42.3314, lon: -83.0458, name: 'Detroit, MI' },
  'oklahoma city': { lat: 35.4676, lon: -97.5164, name: 'Oklahoma City, OK' },
  'portland': { lat: 45.5152, lon: -122.6784, name: 'Portland, OR' },
  'las vegas': { lat: 36.1699, lon: -115.1398, name: 'Las Vegas, NV' },
  'memphis': { lat: 35.1495, lon: -90.0490, name: 'Memphis, TN' },
  'louisville': { lat: 38.2527, lon: -85.7585, name: 'Louisville, KY' },
  'baltimore': { lat: 39.2904, lon: -76.6122, name: 'Baltimore, MD' },
  'milwaukee': { lat: 43.0389, lon: -87.9065, name: 'Milwaukee, WI' },
  'albuquerque': { lat: 35.0844, lon: -106.6504, name: 'Albuquerque, NM' },
  'tucson': { lat: 32.2226, lon: -110.9747, name: 'Tucson, AZ' },
  'fresno': { lat: 36.7378, lon: -119.7871, name: 'Fresno, CA' },
  'sacramento': { lat: 38.5816, lon: -121.4944, name: 'Sacramento, CA' },
  'atlanta': { lat: 33.7490, lon: -84.3880, name: 'Atlanta, GA' },
  'miami': { lat: 25.7617, lon: -80.1918, name: 'Miami, FL' },
  'minneapolis': { lat: 44.9778, lon: -93.2650, name: 'Minneapolis, MN' },
  'cleveland': { lat: 41.4993, lon: -81.6944, name: 'Cleveland, OH' },
  'new orleans': { lat: 29.9511, lon: -90.0715, name: 'New Orleans, LA' },
  'tampa': { lat: 27.9506, lon: -82.4572, name: 'Tampa, FL' },
  'pittsburgh': { lat: 40.4406, lon: -79.9959, name: 'Pittsburgh, PA' },
  'cincinnati': { lat: 39.1031, lon: -84.5120, name: 'Cincinnati, OH' },
  'st louis': { lat: 38.6270, lon: -90.1994, name: 'St. Louis, MO' },
  'orlando': { lat: 28.5383, lon: -81.3792, name: 'Orlando, FL' },
};

const NOAA_BASE_URL = 'https://api.weather.gov';
const USER_AGENT = 'Clodds-Weather/1.0 (contact@clodds.ai)';

// ============================================================================
// NOAA API Client
// ============================================================================

export class NOAAClient {
  private pointCache: Map<string, { data: NOAAPoint; timestamp: number }> = new Map();
  private forecastCache: Map<string, { data: WeatherForecast; timestamp: number }> = new Map();
  private readonly cacheTTL = 15 * 60 * 1000; // 15 minutes
  private readonly maxCacheSize = 500;

  private evictCache<T>(cache: Map<string, { data: T; timestamp: number }>): void {
    if (cache.size <= this.maxCacheSize) return;
    let oldestKey: string | null = null;
    let oldestTs = Infinity;
    for (const [key, entry] of cache) {
      if (entry.timestamp < oldestTs) {
        oldestTs = entry.timestamp;
        oldestKey = key;
      }
    }
    if (oldestKey) cache.delete(oldestKey);
  }

  /**
   * Get grid point data for coordinates
   */
  async getPoint(lat: number, lon: number): Promise<NOAAPoint> {
    const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    const cached = this.pointCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }

    try {
      const url = `${NOAA_BASE_URL}/points/${lat.toFixed(4)},${lon.toFixed(4)}`;
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
      });

      if (!response.ok) {
        throw new Error(`NOAA API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        properties: {
          gridId: string;
          gridX: number;
          gridY: number;
          forecast: string;
          forecastHourly: string;
          observationStations: string;
          relativeLocation?: { properties?: { city?: string; state?: string } };
          timeZone: string;
        };
      };

      const point: NOAAPoint = {
        gridId: data.properties.gridId,
        gridX: data.properties.gridX,
        gridY: data.properties.gridY,
        forecastUrl: data.properties.forecast,
        forecastHourlyUrl: data.properties.forecastHourly,
        observationStationsUrl: data.properties.observationStations,
        city: data.properties.relativeLocation?.properties?.city,
        state: data.properties.relativeLocation?.properties?.state,
        timezone: data.properties.timeZone,
      };

      this.pointCache.set(cacheKey, { data: point, timestamp: Date.now() });
      this.evictCache(this.pointCache);
      return point;
    } catch (error) {
      logger.error('[NOAA] Failed to get point data:', error);
      throw error;
    }
  }

  /**
   * Get 7-day forecast for coordinates
   */
  async getForecast(lat: number, lon: number): Promise<WeatherForecast> {
    const cacheKey = `forecast:${lat.toFixed(4)},${lon.toFixed(4)}`;
    const cached = this.forecastCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }

    const point = await this.getPoint(lat, lon);

    try {
      const response = await fetch(point.forecastUrl, {
        headers: { 'User-Agent': USER_AGENT },
      });

      if (!response.ok) {
        throw new Error(`NOAA API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        properties: {
          generatedAt: string;
          periods: ForecastPeriod[];
        };
      };

      const location = point.city && point.state
        ? `${point.city}, ${point.state}`
        : `${lat.toFixed(2)}, ${lon.toFixed(2)}`;

      const forecast: WeatherForecast = {
        location,
        generatedAt: data.properties.generatedAt,
        periods: data.properties.periods,
      };

      this.forecastCache.set(cacheKey, { data: forecast, timestamp: Date.now() });
      this.evictCache(this.forecastCache);
      return forecast;
    } catch (error) {
      logger.error('[NOAA] Failed to get forecast:', error);
      throw error;
    }
  }

  /**
   * Get hourly forecast for coordinates
   */
  async getHourlyForecast(lat: number, lon: number): Promise<HourlyForecast> {
    const point = await this.getPoint(lat, lon);

    try {
      const response = await fetch(point.forecastHourlyUrl, {
        headers: { 'User-Agent': USER_AGENT },
      });

      if (!response.ok) {
        throw new Error(`NOAA API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        properties: {
          generatedAt: string;
          periods: ForecastPeriod[];
        };
      };

      const location = point.city && point.state
        ? `${point.city}, ${point.state}`
        : `${lat.toFixed(2)}, ${lon.toFixed(2)}`;

      return {
        location,
        generatedAt: data.properties.generatedAt,
        periods: data.properties.periods,
      };
    } catch (error) {
      logger.error('[NOAA] Failed to get hourly forecast:', error);
      throw error;
    }
  }

  /**
   * Get current observations from nearest station
   */
  async getCurrentObservation(lat: number, lon: number): Promise<CurrentObservation | null> {
    const point = await this.getPoint(lat, lon);

    try {
      // Get observation stations
      const stationsResponse = await fetch(point.observationStationsUrl, {
        headers: { 'User-Agent': USER_AGENT },
      });

      if (!stationsResponse.ok) return null;

      const stationsData = await stationsResponse.json() as {
        features: Array<{ properties: { stationIdentifier: string } }>;
      };
      const stations = stationsData.features || [];

      if (stations.length === 0) return null;

      // Get latest observation from first (nearest) station
      const stationId = stations[0].properties.stationIdentifier;
      const obsUrl = `${NOAA_BASE_URL}/stations/${stationId}/observations/latest`;

      const obsResponse = await fetch(obsUrl, {
        headers: { 'User-Agent': USER_AGENT },
      });

      if (!obsResponse.ok) return null;

      const obsData = await obsResponse.json() as {
        properties: {
          timestamp: string;
          temperature?: { value: number; unitCode: string };
          relativeHumidity?: { value: number };
          windSpeed?: { value: number };
          windDirection?: { value: number };
          textDescription?: string;
          precipitationLastHour?: { value: number };
        };
      };
      const props = obsData.properties;

      return {
        station: stationId,
        timestamp: props.timestamp,
        temperature: props.temperature?.value != null
          ? this.celsiusToFahrenheit(props.temperature.value)
          : 0,
        temperatureUnit: 'F',
        humidity: props.relativeHumidity?.value ?? 0,
        windSpeed: props.windSpeed?.value != null
          ? Math.round(props.windSpeed.value * 2.237) // m/s to mph
          : 0,
        windDirection: this.degreesToDirection(props.windDirection?.value ?? 0),
        description: props.textDescription || 'Unknown',
        precipitationLastHour: props.precipitationLastHour?.value,
      };
    } catch (error) {
      logger.error('[NOAA] Failed to get current observation:', error);
      return null;
    }
  }

  /**
   * Get forecast by city name
   */
  async getForecastByCity(cityName: string): Promise<WeatherForecast> {
    const normalizedCity = cityName.toLowerCase().trim();
    const coords = CITY_COORDINATES[normalizedCity];

    if (!coords) {
      throw new Error(`Unknown city: ${cityName}. Try a major US city like "New York" or "Los Angeles".`);
    }

    return this.getForecast(coords.lat, coords.lon);
  }

  /**
   * Get precipitation probability for a specific date
   */
  async getPrecipitationProbability(
    lat: number,
    lon: number,
    targetDate: Date
  ): Promise<{ probability: number; period: ForecastPeriod } | null> {
    const forecast = await this.getForecast(lat, lon);

    for (const period of forecast.periods) {
      const periodStart = new Date(period.startTime);
      const periodEnd = new Date(period.endTime);

      if (targetDate >= periodStart && targetDate < periodEnd) {
        return {
          probability: period.probabilityOfPrecipitation.value ?? 0,
          period,
        };
      }
    }

    return null;
  }

  /**
   * Get temperature forecast for a specific date
   */
  async getTemperatureForecast(
    lat: number,
    lon: number,
    targetDate: Date
  ): Promise<{ high: number; low: number; periods: ForecastPeriod[] } | null> {
    const forecast = await this.getForecast(lat, lon);
    const targetDay = targetDate.toDateString();

    const periodsForDay = forecast.periods.filter(p => {
      const periodDate = new Date(p.startTime).toDateString();
      return periodDate === targetDay;
    });

    if (periodsForDay.length === 0) return null;

    const temps = periodsForDay.map(p => p.temperature);
    return {
      high: Math.max(...temps),
      low: Math.min(...temps),
      periods: periodsForDay,
    };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private celsiusToFahrenheit(celsius: number): number {
    return Math.round((celsius * 9) / 5 + 32);
  }

  private degreesToDirection(degrees: number): string {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(degrees / 45) % 8;
    return directions[index];
  }
}

// ============================================================================
// Factory
// ============================================================================

let noaaClientInstance: NOAAClient | null = null;

export function getNOAAClient(): NOAAClient {
  if (!noaaClientInstance) {
    noaaClientInstance = new NOAAClient();
  }
  return noaaClientInstance;
}
