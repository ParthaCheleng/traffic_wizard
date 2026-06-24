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
        // Organic scatter around epicenter using gaussian-like spread
        const r = 0.02 * (Math.random() + Math.random() + Math.random()) / 3;
        const theta = Math.random() * 2 * Math.PI;
        lng = clusterCenter[0] + r * Math.cos(theta);
        lat = clusterCenter[1] + r * Math.sin(theta);
      } else {
        // Organic city-wide spread using Gaussian approximation (Irwin-Hall)
        // This prevents any visible geometric shapes (squares or circles) at the edges
        const centerLng = 78.4744;
        const centerLat = 17.3850;
        
        // Sum of 6 randoms creates a nice bell curve (normal distribution)
        let randX = 0;
        let randY = 0;
        for (let j = 0; j < 6; j++) { randX += Math.random(); randY += Math.random(); }
        randX = (randX / 6) - 0.5; // Range: -0.5 to 0.5, heavily weighted towards 0
        randY = (randY / 6) - 0.5;
        
        // Spread across a very wide ~40km area
        lng = centerLng + (randX * 0.6); 
        lat = centerLat + (randY * 0.6);
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
            const dist = Math.sqrt(Math.pow(pt.lng - cx, 2) + Math.pow(pt.lat - cy, 2));
            if (dist > 0.02) {
              pt.dx -= (pt.lng - cx) * 0.01;
              pt.dy -= (pt.lat - cy) * 0.01;
            }
          } else {
             // Organic bounds using gravity towards center instead of a hard wall
             const centerLng = 78.4744;
             const centerLat = 17.3850;
             const dist = Math.sqrt(Math.pow(pt.lng - centerLng, 2) + Math.pow(pt.lat - centerLat, 2));
             // Gravity increases as they drift further away
             if (dist > 0.05) {
                 pt.dx -= (pt.lng - centerLng) * 0.0005 * dist;
                 pt.dy -= (pt.lat - centerLat) * 0.0005 * dist;
             }
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
