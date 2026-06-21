import bearing from '@turf/bearing';
import destination from '@turf/destination';
import distance from '@turf/distance';
import nearestPointOnLine from '@turf/nearest-point-on-line';
import { lineString, point } from '@turf/helpers';
import * as dotenv from 'dotenv';
dotenv.config();

async function test() {
  const start = '78.520,17.375';
  const end = '78.545,17.371';

  try {
    // 1. Base Route
    console.log('--- Fetching Base Route ---');
    const baseRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${start};${end}?geometries=geojson`);
    const baseData = await baseRes.json();
    const baseCoords = baseData.routes[0].geometry.coordinates;
    console.log(`Base Route points: ${baseCoords.length}, distance: ${baseData.routes[0].distance} meters`);

    // Force a hotspot radius of 1.2km to ensure collision detection
    const epicenter = [78.5328, 17.3776] as [number, number];
    const radiusKm = 1.2;

    const routeLine = lineString(baseCoords);
    const epicenterPt = point(epicenter);

    const nearestPt = nearestPointOnLine(routeLine, epicenterPt);
    const distKm = distance(epicenterPt, nearestPt);

    console.log(`\nMock Hotspot: Center=[${epicenter}], Radius=${radiusKm}km`);
    console.log(`Nearest point on route: [${nearestPt.geometry.coordinates}], Distance to epicenter: ${distKm}km`);
    console.log(`Collision detected? ${distKm < radiusKm}`);

    if (distKm < radiusKm) {
      const brg = bearing(epicenterPt, nearestPt);
      
      // Calculate both perpendicular directions (+90 and -90)
      const detourAngle1 = brg + 90;
      const detourAngle2 = brg - 90;

      const p1 = destination(epicenterPt, radiusKm * 1.3, detourAngle1, { units: 'kilometers' }).geometry.coordinates;
      const p2 = destination(epicenterPt, radiusKm * 1.3, detourAngle2, { units: 'kilometers' }).geometry.coordinates;

      console.log(`\nCandidate 1 (bearing +90): [${p1}]`);
      console.log(`Candidate 2 (bearing -90): [${p2}]`);

      // Test OSRM with Candidate 1
      const url1 = `https://router.project-osrm.org/route/v1/driving/${start};${p1[0]},${p1[1]};${end}?geometries=geojson`;
      const res1 = await fetch(url1);
      const data1 = await res1.json();
      console.log(`\nCandidate 1 OSRM response: ${data1.code}`);
      if (data1.code === 'Ok') {
        console.log(`Candidate 1 Route distance: ${data1.routes[0].distance} meters`);
      }

      // Test OSRM with Candidate 2
      const url2 = `https://router.project-osrm.org/route/v1/driving/${start};${p2[0]},${p2[1]};${end}?geometries=geojson`;
      const res2 = await fetch(url2);
      const data2 = await res2.json();
      console.log(`\nCandidate 2 OSRM response: ${data2.code}`);
      if (data2.code === 'Ok') {
        console.log(`Candidate 2 Route distance: ${data2.routes[0].distance} meters`);
      }
    }

  } catch (err) {
    console.error(err);
  }
}

test();
