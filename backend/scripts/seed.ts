import { db } from '../src/db';
import { users, deviceLocations } from '../src/db/schema';
import { sql } from 'drizzle-orm';
import crypto from 'crypto';

async function seed() {
  console.log('Seeding database with mock traffic jam...');
  
  try {
    const dummyUsers: any[] = [];
    
    // Generate 20 dummy users
    for (let i = 0; i < 20; i++) {
      const id = crypto.randomUUID();
      dummyUsers.push({ id });
    }

    // Insert dummy users
    await db.insert(users).values(dummyUsers).onConflictDoNothing();
    console.log(`Inserted ${dummyUsers.length} dummy users.`);

    // Base coordinates for Times Square area
    const baseLng = -73.985130;
    const baseLat = 40.758896;

    const locations: any[] = [];

    // Generate tightly packed locations to simulate gridlock
    dummyUsers.forEach((user, index) => {
      // Small random offsets (within ~50 meters)
      const offsetLng = (Math.random() - 0.5) * 0.0005;
      const offsetLat = (Math.random() - 0.5) * 0.0005;
      
      const lng = baseLng + offsetLng;
      const lat = baseLat + offsetLat;
      const speed = Math.random() * 3; // Speed between 0 and 3 km/h
      const heading = Math.random() * 360;

      locations.push({
        userId: user.id,
        location: sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`,
        heading,
        speedKmh: speed
      });
    });

    await db.insert(deviceLocations).values(locations);
    console.log(`Inserted ${locations.length} device locations simulating a traffic jam.`);
    
    console.log('Seed completed successfully. The backend clustering worker should pick this up within 10 seconds.');
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  }
}

seed();
