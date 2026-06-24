import { useState, useEffect, useRef } from 'react';

const DEFAULT_BOUNDS = {
  minLng: 78.3,
  maxLng: 78.6,
  minLat: 17.3,
  maxLat: 17.5
};

const VEHICLE_TYPES = ['Heavy Commercial', 'Truck', 'Bus', 'Car', 'SUV', 'Two-Wheeler', 'Bike'];

export function useDummyTraffic(trafficData: any, isMapLoaded: boolean) {
  const [dummyFeatures, setDummyFeatures] = useState<any>({ type: 'FeatureCollection', features: [] });
  const pointsRef = useRef<any[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (!isMapLoaded || isInitialized) return;

    const epicenters = (trafficData?.features || [])
      .map((f: any) => f.properties?.epicenter)
      .filter(Boolean);
    
    const count = 2500;
    const initialPoints = [];
    
    for (let i = 0; i < count; i++) {
      let lng, lat;
      let clusterCenter = null;
      
      // 80% chance to cluster tightly around hotspots if available (high density in danger zones)
      if (Math.random() < 0.8 && epicenters.length > 0) {
        clusterCenter = epicenters[Math.floor(Math.random() * epicenters.length)];
        // Add random scatter around epicenter
        lng = clusterCenter[0] + (Math.random() - 0.5) * 0.02;
        lat = clusterCenter[1] + (Math.random() - 0.5) * 0.02;
      } else {
        lng = DEFAULT_BOUNDS.minLng + Math.random() * (DEFAULT_BOUNDS.maxLng - DEFAULT_BOUNDS.minLng);
        lat = DEFAULT_BOUNDS.minLat + Math.random() * (DEFAULT_BOUNDS.maxLat - DEFAULT_BOUNDS.minLat);
      }
      
      initialPoints.push({
        id: `dummy-${i}`,
        lng,
        lat,
        clusterCenter,
        vehicleType: VEHICLE_TYPES[Math.floor(Math.random() * VEHICLE_TYPES.length)],
        dx: (Math.random() - 0.5) * 0.0002,
        dy: (Math.random() - 0.5) * 0.0002
      });
    }
    
    pointsRef.current = initialPoints;
    setIsInitialized(true);
  }, [trafficData, isMapLoaded, isInitialized]);

  useEffect(() => {
    if (!isInitialized) return;
    
    let animationFrameId: number;
    let lastUpdate = Date.now();
    
    const animate = () => {
      const now = Date.now();
      // Steady tick every 2 seconds for movement step
      if (now - lastUpdate > 2000) {
        lastUpdate = now;
        
        pointsRef.current.forEach(pt => {
          // Add small jitter to velocity
          pt.dx += (Math.random() - 0.5) * 0.0001;
          pt.dy += (Math.random() - 0.5) * 0.0001;
          
          // Clamp max drift
          pt.dx = Math.max(-0.0003, Math.min(0.0003, pt.dx));
          pt.dy = Math.max(-0.0003, Math.min(0.0003, pt.dy));
          
          pt.lng += pt.dx;
          pt.lat += pt.dy;
          
          // Bounding logic
          if (pt.clusterCenter) {
            const [cx, cy] = pt.clusterCenter;
            if (Math.abs(pt.lng - cx) > 0.02) {
              pt.lng = cx + (Math.random() - 0.5) * 0.01;
              pt.dx *= -1; // Reverse vector if escaping cluster
            }
            if (Math.abs(pt.lat - cy) > 0.02) {
              pt.lat = cy + (Math.random() - 0.5) * 0.01;
              pt.dy *= -1;
            }
          } else {
             // Default bounds wrap
             if (pt.lng < DEFAULT_BOUNDS.minLng || pt.lng > DEFAULT_BOUNDS.maxLng) pt.dx *= -1;
             if (pt.lat < DEFAULT_BOUNDS.minLat || pt.lat > DEFAULT_BOUNDS.maxLat) pt.dy *= -1;
          }
        });
        
        // Output new frame to FeatureCollection
        const features = pointsRef.current.map(pt => ({
          type: 'Feature',
          properties: { id: pt.id, vehicleType: pt.vehicleType },
          geometry: {
            type: 'Point',
            coordinates: [pt.lng, pt.lat]
          }
        }));
        
        setDummyFeatures({ type: 'FeatureCollection', features });
      }
      
      animationFrameId = requestAnimationFrame(animate);
    };
    
    animationFrameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isInitialized]);

  return { dummyFeatures, rawPoints: pointsRef.current };
}
