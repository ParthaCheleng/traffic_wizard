'use client';

import { useState, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { motion, AnimatePresence } from 'framer-motion';
import { io, Socket } from 'socket.io-client';
import { Card, CardContent } from './ui/card';
import { AlertTriangle, Search, X, Navigation2, Utensils, Bed, Camera, Building, Train, Cross, CreditCard, User, LocateFixed, CornerUpRight, Grid3X3, LogOut, ShieldAlert } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { AuthOverlay } from './AuthOverlay';
import { CopilotPanel } from './CopilotPanel';

// EMERGENCY_INCIDENTS mappings matching backend preemption priorities
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

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:8080';

// Fallback mock location
const MOCK_CURRENT_LOCATION = {
  longitude: 78.4867,
  latitude: 17.3850
};

const QUICK_FILTERS = [
  { id: 'restaurants', label: 'Restaurants', icon: Utensils, query: 'node["amenity"="restaurant"]' },
  { id: 'hotels', label: 'Hotels', icon: Bed, query: 'node["tourism"="hotel"]' },
  { id: 'things_to_do', label: 'Things to do', icon: Camera, query: 'node["tourism"="attraction"]' },
  { id: 'museums', label: 'Museums', icon: Building, query: 'node["tourism"="museum"]' },
  { id: 'transit', label: 'Transit', icon: Train, query: 'node["public_transport"="station"]' },
  { id: 'pharmacies', label: 'Pharmacies', icon: Cross, query: 'node["amenity"="pharmacy"]' },
  { id: 'atms', label: 'ATMs', icon: CreditCard, query: 'node["amenity"="atm"]' }
];

export default function MapDashboard() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const hasCenteredRef = useRef(false);
  const copilotMarkerRef = useRef<maplibregl.Marker | null>(null);
  
  // Geolocation state
  const [currentLocation, setCurrentLocation] = useState(MOCK_CURRENT_LOCATION);

  // Avoidance Multiplier state for routing detour sensitivity
  const [avoidanceMultiplier, setAvoidanceMultiplier] = useState(1.25);

  // Preemption System: selected emergency incident state
  const [emergencyIncident, setEmergencyIncident] = useState('Cardiac Arrest');

  const [trafficData, setTrafficData] = useState<any>(null);
  const [route, setRoute] = useState<any>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [session, setSession] = useState<any>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [liveUsers, setLiveUsers] = useState<any[]>([]);

  // Search States
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isHotspotsDropdownOpen, setIsHotspotsDropdownOpen] = useState(false);
  
  // Filter States
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [isFetchingPOIs, setIsFetchingPOIs] = useState(false);

  // Geolocation Fetch
  // Geolocation Fetch (Manually triggered)
  const requestLocation = () => {
    // Instantly fly to the current state location first to ensure the map always moves
    if (mapRef.current && currentLocation) {
      mapRef.current.flyTo({
        center: [currentLocation.longitude, currentLocation.latitude],
        zoom: 14,
        duration: 1500
      });
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords = { longitude: position.coords.longitude, latitude: position.coords.latitude };
          setCurrentLocation(coords);
          
          if (mapRef.current) {
            mapRef.current.flyTo({ center: [coords.longitude, coords.latitude], zoom: 14, duration: 1500 });
          }
        },
        (error) => {
          if (error.code === 1) {
            console.warn("Geolocation Error: Permission denied.");
          } else if (error.code === 3) {
            console.warn("Geolocation Error: Timeout expired.");
          } else {
            console.warn("Geolocation Error:", error.message);
          }
        },
        {
          enableHighAccuracy: true,
          maximumAge: 3000, // Allow using cached location within 3 seconds for fast response
          timeout: 5000     // 5 seconds timeout
        }
      );
    } else {
      console.warn("Geolocation is not supported by this browser.");
    }
  };

  // Real-time location tracking & map centering on mount
  useEffect(() => {
    let watchId: number | null = null;

    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          const coords = { longitude: position.coords.longitude, latitude: position.coords.latitude };
          setCurrentLocation(coords);
          
          if (mapRef.current && !hasCenteredRef.current) {
            hasCenteredRef.current = true;
            const map = mapRef.current;
            if (!map.loaded()) {
              map.once('load', () => {
                map.flyTo({ center: [coords.longitude, coords.latitude], zoom: 14, duration: 2000 });
              });
            } else {
              map.flyTo({ center: [coords.longitude, coords.latitude], zoom: 14, duration: 2000 });
            }
          }
        },
        (error) => {
          if (error.code === 1) {
            console.warn("Geolocation watch warning: Permission denied.");
          } else if (error.code === 3) {
            console.warn("Geolocation watch warning: Timeout expired.");
          } else {
            console.warn("Geolocation watch warning:", error.message);
          }
        },
        {
          enableHighAccuracy: true,
          maximumAge: 5000, // cache up to 5s to resolve instantly
          timeout: 10000
        }
      );
    }

    return () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, []);

  // Send real-time telemetry updates to backend
  useEffect(() => {
    if (socket && currentLocation) {
      socket.emit('telemetry_update', {
        longitude: currentLocation.longitude,
        latitude: currentLocation.latitude,
        heading: 0,
        speedKmh: 0
      });
    }
  }, [currentLocation, socket]);

  // Update marker when location changes
  useEffect(() => {
    if (userMarkerRef.current) {
      userMarkerRef.current.setLngLat([currentLocation.longitude, currentLocation.latitude]);
    }
  }, [currentLocation]);

  // Initialize Map
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [currentLocation.longitude, currentLocation.latitude],
      zoom: 12,
      pitch: 45,
      bearing: 0,
      dragRotate: true,
      pitchWithRotate: true,
      touchZoomRotate: true,
      attributionControl: false
    });

    mapRef.current = map;

    map.on('style.load', () => {
      // Unhide base map labels and POIs to expose rich data
      const layers = map.getStyle().layers;
      if (layers) {
        layers.forEach(layer => {
          if (layer.id.includes('poi') || layer.id.includes('symbol') || layer.id.includes('label')) {
            map.setLayoutProperty(layer.id, 'visibility', 'visible');
            if (layer.minzoom !== undefined && layer.minzoom > 2) {
               map.setLayerZoomRange(layer.id, 2, layer.maxzoom || 24);
            }
          }
        });
      }
    });

    map.on('load', () => {
      setMapLoaded(true);

      // Add user location marker
      const el = document.createElement('div');
      el.className = 'relative flex items-center justify-center w-8 h-8';
      el.innerHTML = `
        <div class="absolute w-full h-full bg-blue-500 rounded-full animate-ping opacity-50"></div>
        <div class="relative bg-blue-600 rounded-full w-4 h-4 shadow-[0_0_10px_rgba(37,99,235,0.8)] border-2 border-white"></div>
      `;

      userMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([currentLocation.longitude, currentLocation.latitude])
        .addTo(map);

      // Add traffic source and layers
      map.addSource('traffic', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.addLayer({
        id: 'traffic-fill',
        type: 'fill',
        source: 'traffic',
        paint: {
          'fill-color': '#ef4444',
          'fill-opacity': 0.2
        }
      });

      // Glowing border layer
      map.addLayer({
        id: 'traffic-glow',
        type: 'line',
        source: 'traffic',
        paint: {
          'line-color': '#ef4444',
          'line-width': 4,
          'line-opacity': 0.6,
          'line-blur': 4
        }
      });
      
      map.addLayer({
        id: 'traffic-border',
        type: 'line',
        source: 'traffic',
        paint: {
          'line-color': '#f87171',
          'line-width': 2
        }
      });

      // Epicenters source and layer
      map.addSource('traffic-epicenters', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.addLayer({
        id: 'traffic-epicenters-circle',
        type: 'circle',
        source: 'traffic-epicenters',
        paint: {
          'circle-radius': 5,
          'circle-color': '#dc2626',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });

      // Add route source and layer
      map.addSource('route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        paint: {
          'line-color': '#3b82f6',
          'line-width': 6,
          'line-opacity': 0.8
        },
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        }
      });

      // POI Markers from Overpass API
      map.addSource('poi-markers', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'poi-layer',
        type: 'circle',
        source: 'poi-markers',
        paint: {
          'circle-radius': 6,
          'circle-color': '#10b981', // Emerald green
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });
      // Optionally add text labels for POIs
      map.addLayer({
        id: 'poi-labels',
        type: 'symbol',
        source: 'poi-markers',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'], // Fallbacks
          'text-offset': [0, 1.25],
          'text-anchor': 'top',
          'text-size': 12
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#000000',
          'text-halo-width': 1
        }
      });

      // Live Users source and layer
      map.addSource('live-users', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.addLayer({
        id: 'live-users-layer',
        type: 'circle',
        source: 'live-users',
        paint: {
          'circle-color': [
            'match',
            ['get', 'role'],
            'emergency', '#ef4444', // Red for emergency
            'general', '#ffffff',   // White for general
            '#a1a1aa' // fallback
          ],
          'circle-radius': [
            'match',
            ['get', 'role'],
            'emergency', 8,
            'general', 5,
            5
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': [
            'match',
            ['get', 'role'],
            'emergency', '#3b82f6', // blue stroke for emergency
            'general', '#18181b',   // dark stroke for general
            '#000000'
          ]
        }
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
      if (copilotMarkerRef.current) {
        copilotMarkerRef.current.remove();
        copilotMarkerRef.current = null;
      }
    };
  }, []);

  // Handle Supabase Auth Session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (!session) {
        setShowAuthModal(true);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        setShowAuthModal(false);
      } else {
        setShowAuthModal(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Handle WebSockets bound to User Session
  useEffect(() => {
    if (!session) {
      setSocket(null);
      return;
    }

    const token = session.access_token;
    const newSocket = io(SOCKET_URL, {
      auth: { token }
    });

    newSocket.on('connect', () => {
      console.log('Connected to telemetry server');
    });

    newSocket.on('live_traffic', (payload) => {
      console.log('Live traffic update received');
      if (payload && payload.type === 'map_update') {
        setTrafficData(payload.traffic);
        setLiveUsers(payload.users || []);
      } else {
        // Fallback for raw GeoJSON traffic payloads
        setTrafficData(payload);
      }
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [session]);

  // Update live users on map
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !liveUsers) return;
    
    const map = mapRef.current;
    const source = map.getSource('live-users') as maplibregl.GeoJSONSource;
    
    if (source) {
      const currentUserId = session?.user?.id;
      
      const userFeatures = liveUsers
        .filter((u: any) => u.role !== 'admin' && u.id !== currentUserId && u.lng !== undefined && u.lat !== undefined)
        .map((u: any) => ({
          type: 'Feature' as const,
          properties: {
            id: u.id,
            role: u.role,
            fullName: u.fullName,
            vehicleType: u.vehicleType,
            emergencyServiceType: u.emergencyServiceType
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [u.lng, u.lat]
          }
        }));

      source.setData({
        type: 'FeatureCollection',
        features: userFeatures
      });
    }
  }, [liveUsers, mapLoaded, session]);

  // Update traffic on map
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !trafficData) return;
    
    const map = mapRef.current;
    const source = map.getSource('traffic') as maplibregl.GeoJSONSource;
    const epicentersSource = map.getSource('traffic-epicenters') as maplibregl.GeoJSONSource;
    
    if (source) {
      source.setData(trafficData);
    }

    if (epicentersSource && trafficData.features) {
      const epicenterFeatures = trafficData.features.map((f: any) => ({
        type: 'Feature',
        properties: f.properties,
        geometry: {
          type: 'Point',
          coordinates: f.properties.epicenter
        }
      }));

      epicentersSource.setData({
        type: 'FeatureCollection',
        features: epicenterFeatures
      });
    }
  }, [trafficData, mapLoaded]);

  // Update route on map
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !route) return;
    
    const map = mapRef.current;
    const source = map.getSource('route') as maplibregl.GeoJSONSource;
    
    if (source) {
      source.setData(route);
    }
  }, [route, mapLoaded]);

  // Handle Autocomplete Fetch
  useEffect(() => {
    if (!searchQuery) {
      setSuggestions([]);
      return;
    }
    
    const timer = setTimeout(async () => {
      try {
        let viewboxParam = '';
        if (currentLocation) {
          const lon = currentLocation.longitude;
          const lat = currentLocation.latitude;
          const offset = 0.5; // Roughly 50km radius
          const minLon = lon - offset;
          const maxLat = lat + offset;
          const maxLon = lon + offset;
          const minLat = lat - offset;
          viewboxParam = `&viewbox=${minLon},${maxLat},${maxLon},${minLat}`;
        }

        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&addressdetails=1&limit=5${viewboxParam}`);
        const data = await res.json();
        setSuggestions(data);
      } catch (err) {
        console.error('Autocomplete fetch error:', err);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, currentLocation]);

  const handleCopilotRoute = (routeGeoJSON: any, destinationCoords: [number, number], message: string) => {
    setRoute(routeGeoJSON);
    if (mapRef.current) {
      const map = mapRef.current;
      if (copilotMarkerRef.current) {
        copilotMarkerRef.current.remove();
      }

      const el = document.createElement('div');
      el.className = 'relative flex items-center justify-center w-8 h-8';
      el.innerHTML = `
        <div class="absolute w-full h-full bg-emerald-500 rounded-full animate-ping opacity-35"></div>
        <div class="relative bg-emerald-600 rounded-full w-5 h-5 shadow-[0_0_12px_rgba(16,185,129,0.8)] border-2 border-white flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-compass"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>
        </div>
      `;

      copilotMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat(destinationCoords)
        .addTo(map);

      if (routeGeoJSON.geometry && routeGeoJSON.geometry.coordinates) {
        const coordinates = routeGeoJSON.geometry.coordinates;
        const bounds = coordinates.reduce((bounds: maplibregl.LngLatBounds, coord: [number, number]) => {
          return bounds.extend(coord as [number, number]);
        }, new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));

        map.fitBounds(bounds, {
          padding: 100,
          pitch: 45,
          bearing: 0,
          duration: 2000
        });
      }
    }
  };

  const handleSelectLocation = async (loc: any) => {
    setSearchQuery(loc.display_name);
    setIsDropdownOpen(false);
    setIsNavigating(true);
    
    try {
      const destLng = parseFloat(loc.lon);
      const destLat = parseFloat(loc.lat);
      
      // Fetch route from backend proxy with cache-busting timestamp and custom avoidanceMultiplier
      const osrmRes = await fetch(`${SOCKET_URL}/api/route?start=${currentLocation.longitude},${currentLocation.latitude}&end=${destLng},${destLat}&avoidanceMultiplier=${avoidanceMultiplier}&t=${Date.now()}`);
      const osrmData = await osrmRes.json();
      
      if (osrmData.code === 'Ok' && osrmData.routes.length > 0) {
        setRoute({
          type: 'Feature',
          properties: {},
          geometry: osrmData.routes[0].geometry
        });
        
        // Fit map bounds to the route
        if (mapRef.current) {
          const map = mapRef.current;
          const coordinates = osrmData.routes[0].geometry.coordinates;
          const bounds = coordinates.reduce((bounds: maplibregl.LngLatBounds, coord: [number, number]) => {
            return bounds.extend(coord as [number, number]);
          }, new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
          
          map.fitBounds(bounds, {
            padding: 100,
            pitch: 45,
            bearing: 0,
            duration: 2000
          });

          // Wait for camera movement to finish before turning off the loading state
          map.once('moveend', () => {
            setIsNavigating(false);
          });
        } else {
          setIsNavigating(false);
        }
      } else {
        throw new Error('Routing failed to return a valid path');
      }
    } catch (err) {
      console.error('Routing execution error:', err);
      setIsNavigating(false);
    }
  };

  const handleFilterClick = async (filter: any) => {
    if (activeFilter === filter.id) {
      setActiveFilter(null);
      // Clear POIs
      if (mapRef.current && mapLoaded) {
        const source = mapRef.current.getSource('poi-markers') as maplibregl.GeoJSONSource;
        if (source) source.setData({ type: 'FeatureCollection', features: [] });
      }
      return;
    }
    
    setActiveFilter(filter.id);
    setIsFetchingPOIs(true);
    
    try {
      if (!mapRef.current) return;
      const bounds = mapRef.current.getBounds();
      // Overpass expects (South, West, North, East)
      const s = bounds.getSouth();
      const w = bounds.getWest();
      const n = bounds.getNorth();
      const e = bounds.getEast();
      
      const overpassQuery = `[out:json];${filter.query}(${s},${w},${n},${e});out;`;
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: overpassQuery
      });
      const data = await res.json();
      
      const features = data.elements
        .filter((el: any) => el.lat && el.lon)
        .map((el: any) => ({
          type: 'Feature',
          properties: {
            name: el.tags?.name || filter.label,
            amenity: el.tags?.amenity
          },
          geometry: {
            type: 'Point',
            coordinates: [el.lon, el.lat]
          }
        }));
        
      if (mapRef.current && mapLoaded) {
        const source = mapRef.current.getSource('poi-markers') as maplibregl.GeoJSONSource;
        if (source) source.setData({ type: 'FeatureCollection', features });
      }
    } catch (err) {
      console.error('Overpass fetch error:', err);
    } finally {
      setIsFetchingPOIs(false);
    }
  };

  const userProfile = session?.user?.user_metadata || {};
  const userRole = userProfile.role || 'general';
  const userVehicleType = userProfile.vehicle_type || '';

  // Auto-select first incident for responder's vehicle type on metadata load
  useEffect(() => {
    if (userVehicleType) {
      const list = EMERGENCY_INCIDENTS[userVehicleType] || [];
      if (list.length > 0) {
        setEmergencyIncident(list[0].incident);
      }
    }
  }, [userVehicleType]);

  const triggerManualSiren = () => {
    if (!socket || !currentLocation) {
      alert('Siren trigger failed: socket or location not ready.');
      return;
    }
    
    const serviceType = userVehicleType || 'Ambulance';
    const list = EMERGENCY_INCIDENTS[serviceType] || [];
    const found = list.find((i: any) => i.incident === emergencyIncident);
    const severity = found ? found.level : 1;

    socket.emit('manual_emergency_trigger', {
      incident: emergencyIncident,
      severity: severity,
      location: [currentLocation.longitude, currentLocation.latitude]
    });

    alert(`🚨 Siren Triggered: ${emergencyIncident} (Severity Level ${severity}). Preemption alert sent to n8n.`);
  };

  const sendAdminDispatch = async (targetUserId?: string, hotspotId?: string) => {
    try {
      const res = await fetch(`${SOCKET_URL}/api/admin/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId, hotspotId })
      });
      
      if (res.ok) {
        alert('🚨 Preemption Alert sent to n8n Webhook successfully!');
      } else {
        const data = await res.json();
        alert(`Failed to send alert: ${data.error || 'Server error'}`);
      }
    } catch (err) {
      console.error('Admin dispatch error:', err);
      alert('Failed to connect to backend API');
    }
  };

  return (
    <div className="w-full h-full relative bg-zinc-950 overflow-hidden">
      {/* MapLibre Container */}
      <div ref={mapContainer} className="w-full h-full" />

      {/* Floating UI Shell (Top Left & Center) */}
      <div 
        className="absolute top-4 left-4 right-16 md:right-auto z-50 flex flex-col md:flex-row items-start md:items-center gap-3 max-w-full"
        onPointerDownCapture={(e) => e.stopPropagation()} // Prevent clicks leaking to map
      >
        {/* Search Container */}
        <div className="relative w-full md:w-[400px] flex-shrink-0">
          {/* Search Pill */}
          <div className="rounded-full bg-white shadow-md border border-gray-100 px-4 py-3 flex items-center gap-3 text-gray-800">
            <input 
              type="text"
              placeholder="Search Google Maps"
              className="bg-transparent outline-none flex-1 text-sm text-gray-900 placeholder-gray-500 font-medium"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsDropdownOpen(true);
              }}
              onFocus={() => setIsDropdownOpen(true)}
            />

            {isNavigating ? (
               <div className="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
            ) : searchQuery ? (
              <button 
                onClick={() => {
                  setSearchQuery('');
                  setSuggestions([]);
                }}
                className="p-1 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            ) : (
              <Search className="w-5 h-5 text-gray-600" />
            )}

            <div className="w-px h-6 bg-gray-200" />

            <button className="flex items-center justify-center bg-[#008c72] hover:bg-teal-700 rounded-md transition-colors w-7 h-7 transform rotate-45 mr-1">
              <CornerUpRight className="w-4 h-4 text-white transform -rotate-45" />
            </button>
          </div>

          {/* Autocomplete Dropdown */}
          <AnimatePresence>
            {isDropdownOpen && suggestions.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute top-full left-0 right-0 mt-2 rounded-2xl bg-white shadow-lg border border-gray-100 overflow-hidden text-gray-800 z-50"
              >
                {suggestions.map((loc, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSelectLocation(loc)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0 flex flex-col"
                  >
                    <span className="text-sm font-medium text-gray-900 line-clamp-1">{loc.display_name.split(',')[0]}</span>
                    <span className="text-xs text-gray-500 line-clamp-1 mt-0.5">{loc.display_name.split(',').slice(1).join(',')}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Traffic Hotspots Dropdown */}
        <div className="relative w-full md:w-auto">
          <button 
            onClick={() => setIsHotspotsDropdownOpen(!isHotspotsDropdownOpen)}
            className="w-full md:w-auto rounded-full bg-white shadow-md border border-gray-100 px-4 py-3 flex items-center justify-between gap-2 text-sm font-medium text-gray-800 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span>Live Traffic</span>
            </div>
            <span className="bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded-full font-bold">
              {trafficData?.features?.length || 0}
            </span>
          </button>

          <AnimatePresence>
            {isHotspotsDropdownOpen && trafficData?.features && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute top-full mt-2 left-0 w-full md:w-64 max-h-[300px] overflow-y-auto no-scrollbar bg-white rounded-2xl shadow-lg border border-gray-100 py-2 z-50"
              >
                <div className="px-4 pb-2 mb-2 border-b border-gray-100">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Active Hotspots</h3>
                </div>
                {trafficData.features.map((feature: any, idx: number) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setIsHotspotsDropdownOpen(false);
                      if (mapRef.current) {
                        const [lng, lat] = feature.properties.epicenter;
                        mapRef.current.flyTo({
                          center: [lng, lat],
                          zoom: 15,
                          duration: 1500
                        });
                      }
                    }}
                    className="w-full text-left px-4 py-2.5 hover:bg-red-50 transition-colors flex flex-col gap-1 border-b border-gray-50 last:border-0"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">
                        {feature.properties.locationName || `Hotspot #${idx + 1}`}
                      </span>
                      <span className="text-xs text-red-600 font-bold bg-red-50 px-1.5 py-0.5 rounded">
                        {feature.properties.radiusKm.toFixed(1)}km
                      </span>
                    </div>
                    <span className="text-xs text-gray-500 line-clamp-1">
                      {feature.properties.description}
                    </span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Quick-Filter Chips */}
        <div className="hidden md:flex gap-2 overflow-x-auto no-scrollbar py-1 px-1 -mx-1 snap-x items-center">
          {QUICK_FILTERS.map(filter => {
            const Icon = filter.icon;
            const isActive = activeFilter === filter.id;
            return (
              <button
                key={filter.id}
                onClick={() => handleFilterClick(filter)}
                disabled={isFetchingPOIs && !isActive}
                className={`snap-start whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-medium flex items-center gap-2 border shadow-sm transition-colors ${
                  isActive 
                    ? 'bg-neutral-900 text-white border-neutral-900' 
                    : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                {filter.label}
                {isFetchingPOIs && isActive && (
                  <div className="w-3 h-3 rounded-full border border-current border-t-transparent animate-spin ml-1" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Top Right Avatar & Menu */}
      <div 
        className="absolute top-4 right-4 z-50 flex items-center gap-3"
        onPointerDownCapture={(e) => e.stopPropagation()}
      >
        <button 
          onClick={requestLocation}
          className="p-2 bg-white/80 hover:bg-white rounded-full shadow-sm backdrop-blur-sm transition-colors border border-gray-100 flex items-center justify-center w-10 h-10"
          title="Locate Me"
        >
          <LocateFixed className="w-5 h-5 text-gray-700" />
        </button>
        <button className="p-2 bg-white/80 hover:bg-white rounded-full shadow-sm backdrop-blur-sm transition-colors border border-gray-100 flex items-center justify-center w-10 h-10">
          <Grid3X3 className="w-5 h-5 text-gray-600" />
        </button>
        <div 
          onClick={() => {
            if (window.confirm('Do you want to sign out?')) {
              supabase.auth.signOut();
            }
          }}
          className="w-10 h-10 rounded-full bg-blue-100 border-2 border-white shadow-md flex items-center justify-center overflow-hidden cursor-pointer hover:bg-blue-200 transition-all active:scale-95"
          title="Click to Sign Out"
        >
          <User className="w-6 h-6 text-blue-600" />
        </div>
      </div>

      {/* Active Hotspot Alert (Repositioned to bottom-right) */}
      <AnimatePresence>
        {trafficData?.features?.length > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute bottom-10 right-4 w-72 z-20"
            onPointerDownCapture={(e) => e.stopPropagation()}
          >
            <Card className="bg-zinc-950/90 backdrop-blur-xl border border-red-900/30 shadow-2xl text-zinc-100 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-red-500 to-amber-500 animate-pulse"></div>
              <CardContent className="p-4 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-sm text-zinc-100 flex items-center gap-1.5">
                      Live Congestion
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
                    </h4>
                    <p className="text-xs text-zinc-400 mt-0.5 leading-tight">
                      Tracking active traffic hotspots.
                    </p>
                  </div>
                </div>
                
                <div className="w-full h-px bg-zinc-800/60 my-0.5" />
                
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-zinc-400">Avoidance Buffer</span>
                    <span className="text-teal-400 font-bold bg-teal-500/10 px-1.5 py-0.5 rounded border border-teal-500/20">
                      {avoidanceMultiplier.toFixed(2)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min="1.0"
                    max="3.0"
                    step="0.25"
                    value={avoidanceMultiplier}
                    onChange={(e) => setAvoidanceMultiplier(parseFloat(e.target.value))}
                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500/50"
                  />
                  <div className="flex justify-between text-[10px] text-zinc-500">
                    <span>1.0x (Standard)</span>
                    <span>3.0x (Wide Detour)</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI Navigation Copilot Panel (Placed on bottom-left) */}
      <CopilotPanel 
        userLocation={currentLocation} 
        onRouteCalculated={handleCopilotRoute} 
        avoidanceMultiplier={avoidanceMultiplier}
      />

      {/* Emergency Operations Panel */}
      {userRole === 'emergency' && (
        <div className="absolute top-24 left-4 z-40 w-80" onPointerDownCapture={(e) => e.stopPropagation()}>
          <Card className="bg-zinc-950/90 backdrop-blur-xl border border-red-500/20 shadow-2xl text-zinc-100 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-red-600 animate-pulse"></div>
            <CardContent className="p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-red-500">
                <ShieldAlert className="w-4 h-4 animate-pulse" />
                <h3 className="font-bold text-xs uppercase tracking-wider">Emergency Operations</h3>
              </div>
              
              <div className="text-xs text-zinc-400">
                Vehicle: <span className="text-white font-semibold">{userVehicleType || 'Emergency Responder'}</span>
              </div>

              <div className="flex flex-col gap-1.5 mt-1">
                <label className="text-[10px] uppercase font-bold text-zinc-500">Select Severity Incident</label>
                <select
                  value={emergencyIncident}
                  onChange={(e) => setEmergencyIncident(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 px-3 text-xs text-white outline-none focus:border-red-500/40"
                >
                  {(EMERGENCY_INCIDENTS[userVehicleType] || []).map((item) => (
                    <option key={item.incident} value={item.incident}>
                      {item.incident} (Priority Level {item.level})
                    </option>
                  ))}
                  {(!EMERGENCY_INCIDENTS[userVehicleType] || EMERGENCY_INCIDENTS[userVehicleType].length === 0) && (
                    <>
                      <option value="Critical Incident">Critical Incident (Priority Level 1)</option>
                      <option value="Urgent Mission">Urgent Mission (Priority Level 2)</option>
                      <option value="Routine Dispatch">Routine Patrol (Priority Level 4)</option>
                    </>
                  )}
                </select>
              </div>

              <button
                onClick={triggerManualSiren}
                className="w-full bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 active:scale-[0.98] text-white font-bold py-2.5 rounded-xl transition-all text-xs flex items-center justify-center gap-2 shadow-lg shadow-red-950/40 cursor-pointer uppercase tracking-wider mt-1"
              >
                <AlertTriangle className="w-3.5 h-3.5 animate-bounce" />
                Trigger Manual Clearance Siren
              </button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Admin Command Center Sidebar */}
      {userRole === 'admin' && (
        <div className="absolute top-20 right-4 z-40 w-96 max-h-[calc(100vh-8rem)] bg-zinc-950/95 backdrop-blur-xl border border-zinc-800/80 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-zinc-100" onPointerDownCapture={(e) => e.stopPropagation()}>
          <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between bg-gradient-to-r from-zinc-950 to-zinc-900/50">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-blue-500/10 rounded-lg border border-blue-500/30">
                <Grid3X3 className="w-4 h-4 text-blue-400" />
              </div>
              <h3 className="text-sm font-semibold text-white">Admin Command Center</h3>
            </div>
            <span className="text-[10px] text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded-full font-medium">
              Live Roster
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
            {/* Emergency Responders Section */}
            <div>
              <h4 className="text-[10px] uppercase font-bold text-red-500 tracking-wider mb-2 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping"></span>
                Emergency Responders ({liveUsers.filter((u: any) => u.role === 'emergency').length})
              </h4>
              <div className="space-y-2">
                {liveUsers.filter((u: any) => u.role === 'emergency').map((u: any) => (
                  <div key={u.id} className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl p-3 flex flex-col gap-1 text-xs">
                    <div className="flex justify-between items-start">
                      <span className="font-semibold text-white">{u.fullName}</span>
                      <span className="text-[10px] font-bold bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded border border-red-500/20">
                        {u.vehicleType || 'Responder'}
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-500 flex justify-between mt-1">
                      <span>Coords: [{u.lng?.toFixed(3) || '0'}, {u.lat?.toFixed(3) || '0'}]</span>
                      <span className="text-zinc-400">{u.emergencyServiceType || 'Emergency'}</span>
                    </div>
                  </div>
                ))}
                {liveUsers.filter((u: any) => u.role === 'emergency').length === 0 && (
                  <p className="text-[11px] text-zinc-500 italic pl-1">No emergency responders active.</p>
                )}
              </div>
            </div>

            {/* General Users Section */}
            <div>
              <h4 className="text-[10px] uppercase font-bold text-zinc-450 tracking-wider mb-2 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-400"></span>
                General Commuters ({liveUsers.filter((u: any) => u.role === 'general').length})
              </h4>
              <div className="space-y-2">
                {liveUsers.filter((u: any) => u.role === 'general').map((u: any) => (
                  <div key={u.id} className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl p-3 flex flex-col gap-2 text-xs">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-semibold text-white">{u.fullName}</div>
                        <div className="text-[10px] text-zinc-500 mt-0.5">[{u.lng?.toFixed(3) || '0'}, {u.lat?.toFixed(3) || '0'}] ({u.vehicleType || 'Car'})</div>
                      </div>
                      <button
                        onClick={() => sendAdminDispatch(u.id, undefined)}
                        className="bg-blue-600/15 hover:bg-blue-600 text-blue-400 hover:text-white border border-blue-500/20 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all cursor-pointer"
                      >
                        Send Alert
                      </button>
                    </div>
                  </div>
                ))}
                {liveUsers.filter((u: any) => u.role === 'general').length === 0 && (
                  <p className="text-[11px] text-zinc-500 italic pl-1">No general commuters active.</p>
                )}
              </div>
            </div>

            {/* Active Hotspots Section */}
            <div>
              <h4 className="text-[10px] uppercase font-bold text-red-400 tracking-wider mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                Active Hotspots ({trafficData?.features?.length || 0})
              </h4>
              <div className="space-y-2">
                {trafficData?.features?.map((f: any, idx: number) => {
                  const id = f.properties.id;
                  const name = f.properties.locationName || `Hotspot #${idx + 1}`;
                  const radius = f.properties.radiusKm?.toFixed(1) || '0.5';
                  return (
                    <div key={id} className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl p-3 flex justify-between items-center text-xs">
                      <div>
                        <div className="font-semibold text-white">{name}</div>
                        <div className="text-[10px] text-zinc-500 mt-0.5">Radius: {radius}km | {f.properties.description}</div>
                      </div>
                      <button
                        onClick={() => sendAdminDispatch(undefined, id)}
                        className="bg-red-600/15 hover:bg-red-600 text-red-400 hover:text-white border border-red-500/20 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all cursor-pointer"
                      >
                        Send Alert
                      </button>
                    </div>
                  );
                })}
                {(!trafficData?.features || trafficData.features.length === 0) && (
                  <p className="text-[11px] text-zinc-500 italic pl-1">No active traffic hotspots.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Role-Based Authentication Overlay */}
      <AnimatePresence>
        {showAuthModal && (
          <AuthOverlay onAuthSuccess={() => setShowAuthModal(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
