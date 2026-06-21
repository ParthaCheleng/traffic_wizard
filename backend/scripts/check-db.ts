import postgres from 'postgres';
import * as dotenv from 'dotenv';
dotenv.config();

async function check() {
  try {
    console.log('Connecting to database...');
    const sql = postgres(process.env.DATABASE_URL!);
    console.log('Connected! Creating PostGIS extension...');
    await sql`CREATE EXTENSION IF NOT EXISTS postgis`;
    console.log('PostGIS enabled!');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}
check();
