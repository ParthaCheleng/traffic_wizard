import postgres from 'postgres';
import * as dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  try {
    console.log('Starting RLS policy migration on Supabase database...');

    // 1. users table
    console.log('Applying RLS to "users" table...');
    await sql`ALTER TABLE public.users ENABLE ROW LEVEL SECURITY`;
    await sql`DROP POLICY IF EXISTS "Users are viewable by authenticated users" ON public.users`;
    await sql`DROP POLICY IF EXISTS "Users can insert their own record" ON public.users`;
    await sql`
      CREATE POLICY "Users are viewable by authenticated users" 
      ON public.users FOR SELECT USING (true)
    `;
    await sql`
      CREATE POLICY "Users can insert their own record" 
      ON public.users FOR INSERT WITH CHECK (auth.uid() = id)
    `;

    // 2. device_locations table
    console.log('Applying RLS to "device_locations" table...');
    await sql`ALTER TABLE public.device_locations ENABLE ROW LEVEL SECURITY`;
    await sql`DROP POLICY IF EXISTS "Device locations are viewable by authenticated users" ON public.device_locations`;
    await sql`DROP POLICY IF EXISTS "Users can insert their own device locations" ON public.device_locations`;
    await sql`
      CREATE POLICY "Device locations are viewable by authenticated users" 
      ON public.device_locations FOR SELECT USING (true)
    `;
    await sql`
      CREATE POLICY "Users can insert their own device locations" 
      ON public.device_locations FOR INSERT WITH CHECK (auth.uid() = user_id)
    `;

    // 3. traffic_hotspots table
    console.log('Applying RLS to "traffic_hotspots" table...');
    await sql`ALTER TABLE public.traffic_hotspots ENABLE ROW LEVEL SECURITY`;
    await sql`DROP POLICY IF EXISTS "Traffic hotspots are viewable by everyone" ON public.traffic_hotspots`;
    await sql`
      CREATE POLICY "Traffic hotspots are viewable by everyone" 
      ON public.traffic_hotspots FOR SELECT USING (true)
    `;

    console.log('RLS policies successfully updated on all tables!');
    process.exit(0);
  } catch (err) {
    console.error('Error applying RLS policies:', err);
    process.exit(1);
  }
}

main();
