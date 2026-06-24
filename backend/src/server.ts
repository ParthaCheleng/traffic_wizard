import fastify from 'fastify';
import circle from '@turf/circle';
import bearing from '@turf/bearing';
import destination from '@turf/destination';
import distance from '@turf/distance';
import nearestPointOnLine from '@turf/nearest-point-on-line';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { lineString, point } from '@turf/helpers';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import * as dotenv from 'dotenv';
import crypto from 'crypto';
import { db } from './db';
import { users, deviceLocations, trafficHotspots } from './db/schema';
import { sql } from 'drizzle-orm';
import fs from 'fs';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_ANON_KEY || 'placeholder'
);

// Priority weight mappings (Tier 1: Truck/Bus, Tier 2: Car/SUV/Van, Tier 3: Motorcycle/Bike/Scooter/Other)
const VEHICLE_PRIORITY_WEIGHTS: Record<string, number> = {
  'truck': 3,
  'bus': 3,
  'heavy commercial': 3,
  'car': 2,
  'suv': 2,
  'van': 2,
  'motorcycle': 1,
  'bike': 1,
  'scooter': 1,
};

function getVehiclePriority(type?: string): number {
  const t = (type || '').toLowerCase();
  if (t.includes('truck') || t.includes('bus') || t.includes('heavy') || t.includes('commercial')) return 3;
  if (t.includes('car') || t.includes('suv') || t.includes('van')) return 2;
  return 1; // Default low priority
}

const EMERGENCY_INCIDENTS: Record<string, Array<{ incident: string; level: number }>> = {
  'Ambulance': [
    { incident: 'Cardiac Arrest', level: 1 },
    { incident: 'Severe Trauma', level: 2 },
    { incident: 'Minor Injury', level: 3 },
    { incident: 'Routine Transfer', level: 4 }
  ],
  'Firetruck': [
    { incident: 'Structure Fire', level: 1 },
    { incident: 'Rescue Operation', level: 2 },
    { incident: 'Hazard Control', level: 3 },
    { incident: 'Inspection', level: 4 }
  ],
  'Police': [
    { incident: 'Active Pursuit/Shooter', level: 1 },
    { incident: 'Major Accident', level: 2 },
    { incident: 'Traffic Control', level: 3 },
    { incident: 'Routine Patrol', level: 4 }
  ]
};

// Cooldown tracker for webhook triggers to prevent spam
const triggeredHotspotIds = new Set<string>();
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/traffic-anomaly';

// Global cache for traffic hotspots used by routing avoidance algorithm
let currentActiveHotspots: any = { type: 'FeatureCollection', features: [] };

// Initialize Gemini SDK
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// Cache for LLM predicted hotspots
let predictedHotspots: Array<{ lat: number, lng: number, severity: number, radiusKm: number, locationName: string }> | null = null;

const HYDERABAD_LOCATIONS = [
  "Hitec City Junction", "Gachibowli Flyover", "Madhapur Metro Station",
  "Jubilee Hills Road No. 36", "Banjara Hills Road No. 1", "Begumpet Police Lines",
  "Secunderabad Station", "Charminar Circle", "Mehdipatnam Ring Road",
  "Kukatpally Y-Junction", "Ameerpet Cross Roads", "Abids GPO",
  "Khairatabad Flyover", "Koti Womens College", "Kondapur RTO",
  "Osmania University Gate", "Nampally Station Road", "Film Nagar Junction",
  "Tolichowki Cross Roads", "Somajiguda Circle", "Panjagutta Junction",
  "Tarnaka Flyover", "Miyapur Cross Roads", "Lingampally Junction",
  "Dilsukhnagar Metro Station"
];

const MOCK_COORDS: Record<string, [number, number]> = {
  "charminar": [78.4744, 17.3616],
  "hitec city": [78.3814, 17.4483],
  "gachibowli": [78.3489, 17.4065],
  "madhapur": [78.3908, 17.4485],
  "kondapur": [78.3688, 17.4622],
  "jubilee hills": [78.4003, 17.4316],
  "banjara hills": [78.4284, 17.4165],
  "secunderabad": [78.5011, 17.4399],
  "begumpet": [78.4582, 17.4447],
  "mehdipatnam": [78.4429, 17.3916],
  "kukatpally": [78.4111, 17.4788],
  "ameerpet": [78.4419, 17.4374],
  "koti": [78.4855, 17.3822]
};

// In-memory store for connected users and their live telemetry coordinates
const activeUsers = new Map<string, {
  id: string;
  fullName: string;
  email?: string;
  phone?: string;
  role: string;
  vehicleType?: string;
  emergencyServiceType?: string;
  lng: number;
  lat: number;
  heading?: number;
  speedKmh?: number;
  socketId: string;
}>();

// Preemption System: Webhook dispatcher to n8n when emergency vehicles enter hotspots
async function triggerPreemptionAlert(emergency: any, hotspot: any, customIncident?: string, customSeverity?: number) {
  const props = hotspot.properties || {};
  const epicenter = props.epicenter || [0, 0];
  const hotspotId = props.id || 'unknown';

  // Find target general users inside this hotspot circle
  const targetUsers = Array.from(activeUsers.values())
    .filter(u => u.role === 'general' && u.lng !== undefined && u.lat !== undefined)
    .filter(u => booleanPointInPolygon(point([u.lng, u.lat]), hotspot))
    .map(u => ({
      id: u.id,
      name: u.fullName,
      email: u.email || '',
      phone: u.phone || '',
      vehicle_type: u.vehicleType || 'Car'
    }));

  // Sort target general users by vehicle priority weight descending (Tier 1 first)
  targetUsers.sort((a, b) => getVehiclePriority(b.vehicle_type) - getVehiclePriority(a.vehicle_type));

  let severity = customSeverity;
  let incident = customIncident;
  if (severity === undefined || incident === undefined) {
    const serviceType = emergency.vehicleType || 'Ambulance';
    const list = EMERGENCY_INCIDENTS[serviceType] || EMERGENCY_INCIDENTS['Ambulance'];
    severity = list[0].level;
    incident = list[0].incident;
  }

  const payload = {
    emergency_vehicle: {
      id: emergency.id,
      type: emergency.vehicleType || 'Emergency Vehicle',
      incident: incident,
      severity: severity,
      location: [emergency.lng, emergency.lat]
    },
    target_users: targetUsers,
    hotspot_center: epicenter
  };

  console.log(`[Preemption System] Dispatched preemption alert to n8n webhook for Hotspot ${hotspotId}. Active targets: ${targetUsers.length}`);
  
  try {
    const response = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      console.error(`[Preemption System] Webhook server returned non-ok status: ${response.status}`);
    }
  } catch (err) {
    console.error('[Preemption System] Failed to send preemption alert to n8n webhook:', err);
  }
}

async function triggerVirtualPreemptionAlert(emergency: any, incident: string, severity: number) {
  // Create a virtual circle of 0.5km radius around emergency coordinates
  const virtualCircle = circle([emergency.lng, emergency.lat], 0.5, { units: 'kilometers' });
  virtualCircle.properties = {
    id: `virtual-hotspot-${emergency.id}-${Date.now()}`,
    epicenter: [emergency.lng, emergency.lat],
    radiusKm: 0.5,
    locationName: 'Emergency Responder Path'
  };
  
  await triggerPreemptionAlert(emergency, virtualCircle, incident, severity);
}

const app = fastify({ logger: true });
app.register(cors, { origin: '*' });

// Socket.io initialization
const io = new Server(app.server, {
  cors: { origin: '*' },
});

// Reusable helper function for OSRM + Turf.js detour routing
async function calculateDetourRoute(start: string, end: string, avoidanceMultiplier: number = 1.25): Promise<any> {
  const logFile = 'server.log';
  fs.writeFileSync(logFile, `=== Routing Request: start=${start}, end=${end}, avoidanceMultiplier=${avoidanceMultiplier} ===\n`);

  if (!start || !end) {
    fs.appendFileSync(logFile, 'Error: missing start or end coordinates\n');
    throw new Error('start and end coordinates are required');
  }

  // Configurable parameters to scale avoidance zones based on multiplier
  const AVOIDANCE_RADIUS_MULTIPLIER = avoidanceMultiplier; // Scale the detection radius to avoid clipping edges
  const DETOUR_PROJECTION_MULTIPLIER = avoidanceMultiplier + 0.3; // Distance to push waypoints outside the epicenter

  // 1. Fetch base route from OSRM
  const baseRouteRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${start};${end}?geometries=geojson`);
  const baseRouteData = await baseRouteRes.json();

  if (baseRouteData.code !== 'Ok' || !baseRouteData.routes || baseRouteData.routes.length === 0) {
    fs.appendFileSync(logFile, `OSRM base route query failed: ${JSON.stringify(baseRouteData)}\n`);
    return baseRouteData;
  }

  const baseRouteCoords = baseRouteData.routes[0].geometry.coordinates;
  if (baseRouteCoords.length < 2) {
    fs.appendFileSync(logFile, `Error: route coordinates length too short (${baseRouteCoords.length})\n`);
    return baseRouteData;
  }

  const baseRouteLine = lineString(baseRouteCoords);
  let currentRouteData = baseRouteData;
  
  interface DetourWaypoint {
    hotspotId: string;
    type: 'entry' | 'detour' | 'exit';
    lng: number;
    lat: number;
    locationAlongBaseLine: number;
  }

  const accumulatedDetours: DetourWaypoint[] = [];
  const detourCounts = new Map<string, number>();

  // We will run up to 3 iterations to avoid newly intersected hotspots
  for (let iter = 1; iter <= 3; iter++) {
    const currentRouteCoords = currentRouteData.routes[0].geometry.coordinates;
    if (currentRouteCoords.length < 2) break;

    const currentRouteLine = lineString(currentRouteCoords);
    const newCollisions: DetourWaypoint[] = [];

    fs.appendFileSync(logFile, `Iteration ${iter}: Checking collisions. Active hotspots: ${currentActiveHotspots?.features?.length || 0}\n`);

    // Scan active hotspots for intersections with the CURRENT route
    if (currentActiveHotspots && currentActiveHotspots.features) {
      fs.appendFileSync(logFile, `Active hotspots count: ${currentActiveHotspots.features.length}\n`);
      for (const hotspot of currentActiveHotspots.features) {
        const props = hotspot.properties;
        if (!props || !props.epicenter || !props.radiusKm) continue;

        // If we already detoured this hotspot too many times, skip it to prevent infinite loops
        const detourCount = detourCounts.get(props.id) || 0;
        if (detourCount >= 2) {
          fs.appendFileSync(logFile, `Hotspot ${props.id} already detoured 2+ times. Skipping to avoid loops.\n`);
          continue;
        }

        const epicenter = props.epicenter as [number, number];
        const radiusKm = props.radiusKm as number;
        const epicenterPt = point(epicenter);

        // Apply our avoidance radius multiplier
        const effectiveAvoidanceRadiusKm = radiusKm * AVOIDANCE_RADIUS_MULTIPLIER;

        // Find nearest point on the CURRENT route to the epicenter
        const nearestPtOnCurrent = nearestPointOnLine(currentRouteLine, epicenterPt);
        const distToCurrentKm = distance(epicenterPt, nearestPtOnCurrent);

        fs.appendFileSync(logFile, `Hotspot: ${props.id} (${props.locationName || 'Unknown'}), epicenter: [${epicenter}], distToRouteKm: ${distToCurrentKm.toFixed(3)}, effectiveRadiusKm: ${effectiveAvoidanceRadiusKm.toFixed(3)}\n`);

        // If the current route collides with the hotspot's effective avoidance zone
        if (distToCurrentKm < effectiveAvoidanceRadiusKm) {
          fs.appendFileSync(logFile, `-> COLLISION DETECTED with hotspot ${props.id} (distance: ${distToCurrentKm.toFixed(3)}km, effective radius: ${effectiveAvoidanceRadiusKm.toFixed(3)}km)!\n`);

          // Find all coordinates along the current route that lie inside the effective hotspot radius
          const insideIndices: number[] = [];
          for (let idx = 0; idx < currentRouteCoords.length; idx++) {
            const dist = distance(point(currentRouteCoords[idx]), epicenterPt);
            if (dist < effectiveAvoidanceRadiusKm) {
              insideIndices.push(idx);
            }
          }

          if (insideIndices.length === 0) continue;

          const firstInside = insideIndices[0];
          const lastInside = insideIndices[insideIndices.length - 1];

          // Identify the entry and exit road coordinates immediately outside the hotspot boundary
          const entryCoord = firstInside > 0 ? currentRouteCoords[firstInside - 1] : currentRouteCoords[0];
          const exitCoord = lastInside < currentRouteCoords.length - 1 ? currentRouteCoords[lastInside + 1] : currentRouteCoords[currentRouteCoords.length - 1];

          // Compute stable sorting keys by finding their projection on the original BASE route
          const baseNearestEntry = nearestPointOnLine(baseRouteLine, point(entryCoord));
          const baseNearestExit = nearestPointOnLine(baseRouteLine, point(exitCoord));

          const entryBaseLocation = baseNearestEntry.properties.location ?? 0;
          const exitBaseLocation = baseNearestExit.properties.location ?? 0;

          // Calculate road heading from entry to exit point
          const roadBrg = bearing(point(entryCoord), point(exitCoord));

          // Increment detour count for this hotspot
          detourCounts.set(props.id, detourCount + 1);

          // Remove any previous waypoints for this hotspot to replace them
          for (let i = accumulatedDetours.length - 1; i >= 0; i--) {
            if (accumulatedDetours[i].hotspotId === props.id) {
              accumulatedDetours.splice(i, 1);
            }
          }

          // Generate perpendicular detour candidate points sideways to the road corridor, pushed out further if repeated detour
          const currentProjectionMultiplier = DETOUR_PROJECTION_MULTIPLIER * (1 + detourCount * 0.5);
          const candidate1 = destination(epicenterPt, radiusKm * currentProjectionMultiplier, roadBrg + 90, { units: 'kilometers' });
          const candidate2 = destination(epicenterPt, radiusKm * currentProjectionMultiplier, roadBrg - 90, { units: 'kilometers' });

          // Choose the candidate that minimizes total detour distance (entry -> detour -> exit)
          const distA = distance(point(entryCoord), candidate1) + distance(candidate1, point(exitCoord));
          const distB = distance(point(entryCoord), candidate2) + distance(candidate2, point(exitCoord));

          // Anti-Cascading Collision Check: Check if candidate falls inside any OTHER active hotspot's effective radius
          let overlapsOther1 = false;
          let overlapsOther2 = false;

          if (currentActiveHotspots && currentActiveHotspots.features) {
            for (const otherHotspot of currentActiveHotspots.features) {
              const otherProps = otherHotspot.properties;
              if (!otherProps || otherProps.id === props.id) continue;
              const otherEpicenter = otherProps.epicenter as [number, number];
              const otherRadius = otherProps.radiusKm as number;
              const otherEffectiveRadius = otherRadius * AVOIDANCE_RADIUS_MULTIPLIER;

              if (distance(candidate1, point(otherEpicenter)) < otherEffectiveRadius) {
                overlapsOther1 = true;
              }
              if (distance(candidate2, point(otherEpicenter)) < otherEffectiveRadius) {
                overlapsOther2 = true;
              }
            }
          }

          let chosenDetourPoint = candidate1;
          if (overlapsOther1 && !overlapsOther2) {
            chosenDetourPoint = candidate2;
            fs.appendFileSync(logFile, `-> Detour candidate 1 overlaps another hotspot. Switched to candidate 2.\n`);
          } else if (!overlapsOther1 && overlapsOther2) {
            chosenDetourPoint = candidate1;
            fs.appendFileSync(logFile, `-> Detour candidate 2 overlaps another hotspot. Switched to candidate 1.\n`);
          } else {
            chosenDetourPoint = distA < distB ? candidate1 : candidate2;
          }

          const detourBaseLocation = (entryBaseLocation + exitBaseLocation) / 2;

          // 1. Add entry waypoint if it's not the start point
          if (firstInside > 0) {
            newCollisions.push({
              hotspotId: props.id,
              type: 'entry',
              lng: entryCoord[0],
              lat: entryCoord[1],
              locationAlongBaseLine: entryBaseLocation
            });
          }

          // 2. Add the main perpendicular detour waypoint
          newCollisions.push({
            hotspotId: props.id,
            type: 'detour',
            lng: chosenDetourPoint.geometry.coordinates[0],
            lat: chosenDetourPoint.geometry.coordinates[1],
            locationAlongBaseLine: detourBaseLocation
          });

          // 3. Add exit waypoint if it's not the end point
          if (lastInside < currentRouteCoords.length - 1) {
            newCollisions.push({
              hotspotId: props.id,
              type: 'exit',
              lng: exitCoord[0],
              lat: exitCoord[1],
              locationAlongBaseLine: exitBaseLocation
            });
          }
        }
      }
    }

    // If no new collisions detected, the current route is clean!
    if (newCollisions.length === 0) {
      fs.appendFileSync(logFile, `Iteration ${iter}: No new collisions. Route is optimized and clean!\n`);
      break;
    }

    // Accumulate the new detours
    for (const col of newCollisions) {
      accumulatedDetours.push(col);
    }

    // Sort all accumulated detours by their order along the base route
    accumulatedDetours.sort((a, b) => a.locationAlongBaseLine - b.locationAlongBaseLine);

    // Build the OSRM multi-point query string
    const waypointsString = [
      start,
      ...accumulatedDetours.map(d => `${d.lng},${d.lat}`),
      end
    ].join(';');

    fs.appendFileSync(logFile, `Iteration ${iter}: Requesting detoured route from OSRM: ${waypointsString}\n`);
    const detourRouteRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${waypointsString}?geometries=geojson`);
    const detourRouteData = await detourRouteRes.json();

    if (detourRouteData.code === 'Ok' && detourRouteData.routes && detourRouteData.routes.length > 0) {
      currentRouteData = detourRouteData;
    } else {
      fs.appendFileSync(logFile, `OSRM detour fetch failed (code: ${detourRouteData.code}). Reverting to base route.\n`);
      break;
    }
  }

  return currentRouteData;
}

// Endpoint to retrieve currently active hotspots
app.get('/api/hotspots', async (request, reply) => {
  return currentActiveHotspots;
});

// Mock Valhalla routing abstraction proxying to OSRM with Turf.js traffic avoidance detours
app.get('/', async (request, reply) => {
  return { status: 'ok', service: 'traffic-wizard-backend' };
});

app.get('/api/route', async (request, reply) => {
  const { start, end, avoidanceMultiplier } = request.query as { start: string; end: string; avoidanceMultiplier?: string };
  try {
    const parsedMultiplier = avoidanceMultiplier ? parseFloat(avoidanceMultiplier) : 1.25;
    const routeData = await calculateDetourRoute(start, end, parsedMultiplier);
    return routeData;
  } catch (err: any) {
    return reply.status(500).send({ error: err.message || 'Routing failed' });
  }
});

// Helper: Extract Intent using Gemini
async function extractIntentFromLLM(text: string): Promise<{ destination: string, vehicleMode: string, avoidHighways: boolean }> {
  if (!genAI) {
    console.warn("Gemini API key not configured. Using rule-based fallback intent extraction.");
    return fallbackExtractIntent(text);
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            destination: { type: SchemaType.STRING, description: "The exact destination name requested by the user, extracted verbatim (e.g. Raja Dhanrajgir palace, Charminar)" },
            vehicleMode: { type: SchemaType.STRING, enum: ["driving", "cycling", "walking"], format: "enum", description: "Mode of transportation" },
            avoidHighways: { type: SchemaType.BOOLEAN, description: "Whether the user wants to avoid highways/major bypass roads" }
          },
          required: ["destination", "vehicleMode", "avoidHighways"]
        }
      }
    });

    const prompt = `Analyze this user navigation request: "${text}". Extract the exact destination name requested by the user. Do not hallucinate or substitute the location. Extract vehicle mode, and whether they want to avoid highways. If unspecified, default vehicleMode to "driving" and avoidHighways to false.`;
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    return JSON.parse(responseText);
  } catch (error) {
    console.error("Gemini intent extraction failed, using fallback:", error);
    return fallbackExtractIntent(text);
  }
}

function fallbackExtractIntent(text: string): { destination: string, vehicleMode: string, avoidHighways: boolean } {
  const lower = text.toLowerCase();
  let destination = "";
  
  for (const loc of HYDERABAD_LOCATIONS) {
    const cleanName = loc.replace(" Junction", "").replace(" Flyover", "").replace(" Metro Station", "").replace(" Circle", "").replace(" Cross Roads", "").replace(" RTO", "").replace(" Ring Road", "");
    if (lower.includes(cleanName.toLowerCase())) {
      destination = cleanName;
      break;
    }
  }

  if (!destination) {
    const toMatch = text.match(/(?:navigate to|go to|take me to|to)\s+([^.]+)/i);
    if (toMatch && toMatch[1]) {
      destination = toMatch[1].trim();
    } else {
      destination = "Charminar";
    }
  }

  let vehicleMode = "driving";
  if (lower.includes("cycle") || lower.includes("bike") || lower.includes("cycling")) {
    vehicleMode = "cycling";
  } else if (lower.includes("walk") || lower.includes("foot") || lower.includes("walking")) {
    vehicleMode = "walking";
  }

  const avoidHighways = lower.includes("avoid") && (lower.includes("highway") || lower.includes("expressway"));

  return { destination, vehicleMode, avoidHighways };
}

// Helper: Geocode destination name to coordinates
async function geocodeDestination(destination: string): Promise<[number, number] | null> {
  try {
    const geocodeUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(destination)}+Hyderabad&format=json&limit=1`;
    const geoRes = await fetch(geocodeUrl, {
      headers: { 'User-Agent': 'TrafficWizardCopilot/1.0' }
    });
    const geoData = await geoRes.json();
    if (Array.isArray(geoData) && geoData.length > 0) {
      return [parseFloat(geoData[0].lon), parseFloat(geoData[0].lat)];
    }
  } catch (err) {
    console.error("Nominatim geocoding failed, using local coordinates dictionary:", err);
  }

  const key = destination.toLowerCase().trim();
  for (const k of Object.keys(MOCK_COORDS)) {
    if (key.includes(k) || k.includes(key)) {
      return MOCK_COORDS[k];
    }
  }
  return null;
}

// Feature 2: Natural Language "Copilot" Route
app.post('/api/copilot', async (request, reply) => {
  const { text, userLocation, avoidanceMultiplier } = request.body as { text: string, userLocation: [number, number], avoidanceMultiplier?: number };
  
  if (!text || !userLocation || userLocation.length !== 2) {
    return reply.status(400).send({ error: 'text and userLocation are required' });
  }

  try {
    const intent = await extractIntentFromLLM(text);
    console.log("Extracted Copilot Intent:", intent);

    const coords = await geocodeDestination(intent.destination);
    if (!coords) {
      return reply.status(404).send({ error: `Could not resolve destination: ${intent.destination}` });
    }

    const [destLng, destLat] = coords;
    const startStr = `${userLocation[0]},${userLocation[1]}`;
    const endStr = `${destLng},${destLat}`;
    const parsedMultiplier = avoidanceMultiplier !== undefined ? avoidanceMultiplier : 1.25;
    const detourRouteData = await calculateDetourRoute(startStr, endStr, parsedMultiplier);

    if (detourRouteData.code !== 'Ok' || !detourRouteData.routes || detourRouteData.routes.length === 0) {
      return reply.status(500).send({ error: 'Routing failed to generate a path' });
    }

    const routeGeoJSON = {
      type: 'Feature',
      properties: {},
      geometry: detourRouteData.routes[0].geometry
    };

    const modeText = intent.vehicleMode === 'driving' ? 'commute' : intent.vehicleMode;
    const highwayText = intent.avoidHighways ? ', avoiding major highways' : '';
    const message = `I have calculated your route to ${intent.destination} using ${modeText} mode${highwayText}. Dynamic detour routing has adjusted the path to navigate around active traffic hotspots.`;

    return {
      message,
      routeGeoJSON,
      destinationCoords: [destLng, destLat]
    };

  } catch (err: any) {
    console.error("Copilot endpoint error:", err);
    return reply.status(500).send({ error: err.message || 'Copilot execution failed' });
  }
});

// Webhook for n8n to generate natural language summaries
app.post('/api/traffic-anomaly', async (request, reply) => {
  const { hotspotId, severityLevel, coordinates } = request.body as any;
  // In a real scenario, this would send a payload to process.env.N8N_WEBHOOK_URL
  console.log(`Sending webhook to n8n for Hotspot: ${hotspotId}`);
  return { status: 'Webhook received and processed by n8n placeholder' };
});

// Authenticated connection middleware
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication token missing'));
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      console.error('Socket authentication failed:', error?.message);
      return next(new Error('Invalid or expired authentication token'));
    }

    const role = socket.handshake.auth.role || 'operator';
    
    socket.data.userId = user.id;
    socket.data.profile = {
      id: user.id,
      role: role,
      fullName: user.email?.split('@')[0] || `Op-${user.id.substring(0,4)}`,
      vehicleType: socket.handshake.auth.emergencyType || 'Car',
    };

    next();
  } catch (err) {
    console.error('Unexpected socket auth error:', err);
    next(new Error('Internal Authentication Error'));
  }
});

io.on('connection', async (socket) => {
  console.log('Client connected:', socket.id, 'User:', socket.data.userId);

  try {
    await db.insert(users).values({ id: socket.data.userId }).onConflictDoNothing();
  } catch (err) {
    console.error('Error ensuring user in database users table:', err);
  }

  socket.on('telemetry_update', async (data) => {
    try {
      const { longitude, latitude, heading, speedKmh } = data;
      
      // Update user in the in-memory active users map
      activeUsers.set(socket.data.userId, {
        ...socket.data.profile,
        lng: longitude,
        lat: latitude,
        heading: heading || 0,
        speedKmh: speedKmh || 0,
        socketId: socket.id
      });

      await db.insert(deviceLocations).values({
        userId: socket.data.userId,
        location: sql`ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)`,
        heading,
        speedKmh,
      });

    } catch (err) {
      console.error('Error saving telemetry:', err);
    }
  });

  socket.on('location_update', (data) => {
    const { lng, lat } = data;
    activeUsers.set(socket.data.userId, {
      ...socket.data.profile,
      lng,
      lat,
      socketId: socket.id
    });
  });

  const handleManualSiren = async (data: any) => {
    try {
      const { incident, severity } = data;
      const emergencyUser = activeUsers.get(socket.data.userId);
      if (!emergencyUser || emergencyUser.lng === undefined || emergencyUser.lat === undefined) {
        console.warn(`[Preemption System] Manual siren trigger failed: user not found or coordinates missing`);
        return;
      }

      // Search if the user is inside any active hotspot
      let foundHotspot = null;
      const emergencyPt = point([emergencyUser.lng, emergencyUser.lat]);

      if (currentActiveHotspots && currentActiveHotspots.features) {
        for (const hotspot of currentActiveHotspots.features) {
          if (booleanPointInPolygon(emergencyPt, hotspot)) {
            foundHotspot = hotspot;
            break;
          }
        }
      }

      if (foundHotspot) {
        console.log(`[Preemption System] Manual siren triggered inside active hotspot ${foundHotspot.properties.id}`);
        await triggerPreemptionAlert(emergencyUser, foundHotspot, incident, severity);
      } else {
        console.log(`[Preemption System] Manual siren triggered outside any hotspot. Generating virtual preemption corridor.`);
        await triggerVirtualPreemptionAlert(emergencyUser, incident, severity);
      }
    } catch (err) {
      console.error('[Preemption System] Error triggering manual siren:', err);
    }
  };

  socket.on('manual_emergency_trigger', handleManualSiren);
  socket.on('manual_emergency_siren_trigger', handleManualSiren);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    activeUsers.delete(socket.data.userId);
  });
});

// Background Worker: Dynamic Traffic Hotspot Generator
interface HotspotState {
  id: string;
  centerLng: number;
  centerLat: number;
  targetLng: number;
  targetLat: number;
  radiusKm: number;
  targetRadiusKm: number;
  severity: number;
  description: string;
  locationName: string;
}

let activeHotspots: HotspotState[] = [];
const HYDERABAD_BOUNDS = {
  minLng: 78.3,
  maxLng: 78.6,
  minLat: 17.3,
  maxLat: 17.5
};

const SEVERITIES = ['Moderate Traffic', 'Heavy Congestion', 'Gridlock'];

function createRandomHotspot(id: string, index?: number): HotspotState {
  const centerLng = HYDERABAD_BOUNDS.minLng + Math.random() * (HYDERABAD_BOUNDS.maxLng - HYDERABAD_BOUNDS.minLng);
  const centerLat = HYDERABAD_BOUNDS.minLat + Math.random() * (HYDERABAD_BOUNDS.maxLat - HYDERABAD_BOUNDS.minLat);
  const radiusKm = 0.15 + Math.random() * 0.15; // 150m to 300m
  const severityVal = 1 + Math.floor(Math.random() * 3); // 1, 2, or 3

  const idx = index !== undefined ? index : parseInt(id.replace('hotspot-', '')) || 0;
  const locationName = HYDERABAD_LOCATIONS[idx % HYDERABAD_LOCATIONS.length];

  return {
    id,
    centerLng,
    centerLat,
    targetLng: centerLng + (Math.random() - 0.5) * 0.015,
    targetLat: centerLat + (Math.random() - 0.5) * 0.01,
    radiusKm,
    targetRadiusKm: 0.15 + Math.random() * 0.15,
    severity: severityVal,
    description: SEVERITIES[severityVal - 1],
    locationName
  };
}

// Feature 1: LLM-Predicted Traffic Fetch
async function fetchPredictedTrafficFromLLM() {
  if (!genAI) {
    console.warn("Gemini API client not initialized. Using fallback random traffic.");
    return;
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.ARRAY,
          description: "List of predicted traffic hotspots in Hyderabad.",
          items: {
            type: SchemaType.OBJECT,
            properties: {
              lat: { type: SchemaType.NUMBER, description: "Latitude within 17.3 and 17.5" },
              lng: { type: SchemaType.NUMBER, description: "Longitude within 78.3 and 78.6" },
              severity: { type: SchemaType.NUMBER, description: "Traffic severity level from 1 to 10" },
              radiusKm: { type: SchemaType.NUMBER, description: "Hotspot radius in kilometers from 0.15 to 0.3" },
              locationName: { type: SchemaType.STRING, description: "Descriptive name of the intersection or road in Hyderabad (e.g., Gachibowli Flyover)" }
            },
            required: ["lat", "lng", "severity", "radiusKm", "locationName"]
          }
        }
      }
    });

    const now = new Date();
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayOfWeek = days[now.getDay()];
    const timeStr = now.toTimeString().split(' ')[0];

    const prompt = `Predict 15 realistic traffic congestion hotspots in Hyderabad, India (Bounding Box: Lng 78.3 to 78.6, Lat 17.3 to 17.5) for a typical ${dayOfWeek} at current time ${timeStr}. Consider typical rush hours, popular commercial/IT hubs, and major bottlenecks. Return an array of hotspots matching the requested schema. Ensure the coordinates are valid numbers within the bounding box.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);

    if (Array.isArray(parsed) && parsed.length > 0) {
      predictedHotspots = parsed.map(item => ({
        lat: Number(item.lat),
        lng: Number(item.lng),
        severity: Number(item.severity),
        radiusKm: Number(item.radiusKm),
        locationName: String(item.locationName)
      }));
      console.log(`Successfully fetched ${predictedHotspots.length} predicted traffic hotspots from Gemini.`);
    }
  } catch (error) {
    console.error("Error fetching predicted traffic from Gemini:", error);
  }
}

// Initial fetch on startup and interval every 5 minutes
fetchPredictedTrafficFromLLM();
setInterval(fetchPredictedTrafficFromLLM, 300000);

setInterval(() => {
  try {
    const features = [];

    if (predictedHotspots && predictedHotspots.length > 0) {
      // Loop through predicted hotspots from LLM
      for (let i = 0; i < predictedHotspots.length; i++) {
        const hotspot = predictedHotspots[i];

        // Generate the Turf circle feature
        const circleFeature = circle([hotspot.lng, hotspot.lat], hotspot.radiusKm, { units: 'kilometers' });
        
        const severityIndex = Math.min(2, Math.max(0, Math.floor((hotspot.severity - 1) / 3.3)));
        const description = SEVERITIES[severityIndex];

        // Inject epicenter and radius into properties
        circleFeature.properties = {
          id: `predicted-hotspot-${i}`,
          severity: hotspot.severity,
          description: `${description} (Level ${hotspot.severity}/10)`,
          epicenter: [hotspot.lng, hotspot.lat],
          radiusKm: hotspot.radiusKm,
          locationName: hotspot.locationName
        };

        features.push(circleFeature);
      }
    } else {
      // Fallback: original Math.random logic
      const numHotspots = 25; // Keep a stable density of 25 hotspots
      
      // Initialize if empty
      if (activeHotspots.length === 0) {
        for (let i = 0; i < numHotspots; i++) {
          activeHotspots.push(createRandomHotspot(`hotspot-${i}`, i));
        }
      }

      for (let i = 0; i < activeHotspots.length; i++) {
        const hotspot = activeHotspots[i];

        // 1. Slowly drift coordinates towards targets
        hotspot.centerLng += (hotspot.targetLng - hotspot.centerLng) * 0.05;
        hotspot.centerLat += (hotspot.targetLat - hotspot.centerLat) * 0.05;

        // 2. Slowly adjust radius towards target
        hotspot.radiusKm += (hotspot.targetRadiusKm - hotspot.radiusKm) * 0.08;

        // 3. Keep the values bounded
        if (hotspot.centerLng < HYDERABAD_BOUNDS.minLng || hotspot.centerLng > HYDERABAD_BOUNDS.maxLng ||
            hotspot.centerLat < HYDERABAD_BOUNDS.minLat || hotspot.centerLat > HYDERABAD_BOUNDS.maxLat) {
          // Reset if drifted out of bounds
          activeHotspots[i] = createRandomHotspot(hotspot.id, i);
          continue;
        }

        // 4. Randomly pick new targets periodically (approx. every 10 ticks / 50s)
        if (Math.random() < 0.1) {
          hotspot.targetLng = hotspot.centerLng + (Math.random() - 0.5) * 0.015;
          hotspot.targetLat = hotspot.centerLat + (Math.random() - 0.5) * 0.01;
          hotspot.targetRadiusKm = 0.15 + Math.random() * 0.15;
          // 25% chance to change severity/description
          if (Math.random() < 0.25) {
            hotspot.severity = 1 + Math.floor(Math.random() * 3);
            hotspot.description = SEVERITIES[hotspot.severity - 1];
          }
        }

        // 5. Very small chance to completely clear and relocate a hotspot (approx. every 100 ticks)
        if (Math.random() < 0.01) {
          activeHotspots[i] = createRandomHotspot(hotspot.id, i);
          continue;
        }

        // Generate the Turf circle feature
        const circleFeature = circle([hotspot.centerLng, hotspot.centerLat], hotspot.radiusKm, { units: 'kilometers' });
        
        // Inject epicenter and radius into properties
        circleFeature.properties = {
          id: hotspot.id,
          severity: hotspot.severity,
          description: hotspot.description,
          epicenter: [hotspot.centerLng, hotspot.centerLat],
          radiusKm: hotspot.radiusKm,
          locationName: hotspot.locationName
        };

        features.push(circleFeature);
      }
    }

    const featureCollection = {
      type: 'FeatureCollection',
      features,
    };

    currentActiveHotspots = featureCollection;

    // --- Spatial Proximity Preemption Loop ---
    const emergencyResponders = Array.from(activeUsers.values()).filter(u => u.role === 'emergency');
    const currentCollisions = new Set<string>();

    for (const emergency of emergencyResponders) {
      if (emergency.lng === undefined || emergency.lat === undefined) continue;
      const emergencyPt = point([emergency.lng, emergency.lat]);

      for (const hotspot of featureCollection.features) {
        const props = hotspot.properties;
        if (!props || !props.id) continue;

        const isInside = booleanPointInPolygon(emergencyPt, hotspot);
        if (isInside) {
          currentCollisions.add(props.id);
          if (!triggeredHotspotIds.has(props.id)) {
            triggeredHotspotIds.add(props.id);
            // Trigger preemption webhook alert
            triggerPreemptionAlert(emergency, hotspot).catch(err => {
              console.error('[Preemption System] Error triggerPreemptionAlert:', err);
            });
          }
        }
      }
    }

    // Clean up triggered hotspots that are no longer actively colliding
    for (const id of triggeredHotspotIds) {
      if (!currentCollisions.has(id)) {
        triggeredHotspotIds.delete(id);
      }
    }

    // Convert active users map to array, filtering out users who haven't sent coordinates yet
    const usersArray = Array.from(activeUsers.values()).filter(u => u.lng !== undefined && u.lat !== undefined);
    
    io.emit('live_traffic', {
      type: 'map_update',
      traffic: featureCollection,
      users: usersArray
    });
  } catch (err) {
    console.error('Error in hotspot generator:', err);
  }
}, 5000);

// Admin manual alert trigger REST dispatch endpoint
app.post('/api/admin/dispatch', async (request, reply) => {
  const { targetUserId, hotspotId } = request.body as { targetUserId?: string; hotspotId?: string };
  
  try {
    let targetUsersList: any[] = [];
    let location: [number, number] = [78.4867, 17.3850];
    
    if (targetUserId) {
      const user = activeUsers.get(targetUserId);
      if (user) {
        targetUsersList.push({
          id: user.id,
          name: user.fullName,
          email: user.email || '',
          phone: user.phone || '',
          vehicle_type: user.vehicleType || 'Car'
        });
        location = [user.lng, user.lat];
      }
    } else if (hotspotId) {
      // Find all users in hotspot
      if (currentActiveHotspots && currentActiveHotspots.features) {
        const hotspot = currentActiveHotspots.features.find((f: any) => f.properties.id === hotspotId);
        if (hotspot) {
          location = hotspot.properties.epicenter;
          targetUsersList = Array.from(activeUsers.values())
            .filter(u => u.role === 'general' && u.lng !== undefined && u.lat !== undefined)
            .filter(u => booleanPointInPolygon(point([u.lng, u.lat]), hotspot))
            .map(u => ({
              id: u.id,
              name: u.fullName,
              email: u.email || '',
              phone: u.phone || '',
              vehicle_type: u.vehicleType || 'Car'
            }));
        }
      }
    }
    
    const payload = {
      emergency_vehicle: {
        id: 'admin-dispatch',
        type: 'Admin Dispatch override',
        incident: 'Manual Dispatch Trigger',
        severity: 1, // Critical
        location
      },
      target_users: targetUsersList,
      hotspot_center: location
    };
    
    console.log(`[Preemption System] Admin triggered manual preemption alert dispatch to n8n webhook.`);
    
    await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    return { status: 'success', message: 'Manual alert sent to n8n webhook' };
  } catch (err: any) {
    console.error('[Preemption System] Admin dispatch failed:', err);
    return reply.status(500).send({ error: err.message || 'Dispatch failed' });
  }
});

const start = async () => {
  try {
    await app.listen({ port: Number(process.env.PORT) || 8080, host: '0.0.0.0' });
    console.log(`Server listening on port ${process.env.PORT || 8080}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
