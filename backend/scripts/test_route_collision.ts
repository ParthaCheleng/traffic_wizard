import * as dotenv from 'dotenv';
dotenv.config();

async function test() {
  const start = '78.520,17.375';
  const end = '78.545,17.371';

  try {
    console.log('Fetching route from OSRM...');
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${start};${end}?geometries=geojson`);
    const data = await res.json();

    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      console.log('Route geometry type:', data.routes[0].geometry.type);
      console.log('First 5 coordinates in response:', data.routes[0].geometry.coordinates.slice(0, 5));
    } else {
      console.log('Error or no route found:', data);
    }
  } catch (err) {
    console.error(err);
  }
}

test();
