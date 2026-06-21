"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Globe } from "@/components/ui/cobe-globe";

const markers = [
  { id: "sf", location: [37.7595, -122.4367] as [number, number], label: "San Francisco" },
  { id: "nyc", location: [40.7128, -74.006] as [number, number], label: "New York" },
  { id: "tokyo", location: [35.6762, 139.6503] as [number, number], label: "Tokyo" },
  { id: "london", location: [51.5074, -0.1278] as [number, number], label: "London" },
  { id: "sydney", location: [-33.8688, 151.2093] as [number, number], label: "Sydney" },
  { id: "capetown", location: [-33.9249, 18.4241] as [number, number], label: "Cape Town" },
  { id: "dubai", location: [25.2048, 55.2708] as [number, number], label: "Dubai" },
  { id: "paris", location: [48.8566, 2.3522] as [number, number], label: "Paris" },
  { id: "saopaulo", location: [-23.5505, -46.6333] as [number, number], label: "São Paulo" },
]

const arcs = [
  {
    id: "sf-tokyo",
    from: [37.7595, -122.4367] as [number, number],
    to: [35.6762, 139.6503] as [number, number],
    label: "SF → Tokyo",
  },
  {
    id: "nyc-london",
    from: [40.7128, -74.006] as [number, number],
    to: [51.5074, -0.1278] as [number, number],
    label: "NYC → London",
  },
]

const GLOBE_CONFIG = {
  markerColor: [0.2, 0.8, 0.9] as [number, number, number],
  baseColor: [0.5, 0.5, 0.5] as [number, number, number],
  arcColor: [0.2, 0.8, 0.9] as [number, number, number],
  glowColor: [0.05, 0.05, 0.05] as [number, number, number],
};

interface GlobePreloaderProps {
  onComplete: () => void;
}

export function GlobePreloader({ onComplete }: GlobePreloaderProps) {
  useEffect(() => {
    // Random duration between 2s and 5s
    const duration = Math.random() * 3000 + 2000;
    
    const timer = setTimeout(() => {
      onComplete();
    }, duration);

    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, filter: "blur(10px)" }}
      transition={{ duration: 0.8, ease: "easeInOut" }}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black overflow-hidden"
    >
      <div className="w-full max-w-2xl h-[600px] flex items-center justify-center">
        <Globe
          markers={markers}
          arcs={arcs}
          markerColor={GLOBE_CONFIG.markerColor}
          baseColor={GLOBE_CONFIG.baseColor}
          arcColor={GLOBE_CONFIG.arcColor}
          glowColor={GLOBE_CONFIG.glowColor}
          dark={1}
          mapBrightness={10}
          markerSize={0.025}
          markerElevation={0.01}
          speed={0.005}
        />
      </div>
    </motion.div>
  );
}
