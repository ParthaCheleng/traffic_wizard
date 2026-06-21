import postgres from 'postgres';
import * as dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  try {
    console.log('Checking and creating public.profiles table...');

    // 1. Create profiles table
    await sql`
      CREATE TABLE IF NOT EXISTS public.profiles (
        id uuid REFERENCES auth.users NOT NULL PRIMARY KEY,
        role text CHECK (role IN ('general', 'emergency', 'admin')),
        full_name text,
        phone_number text,
        vehicle_type text,
        emergency_service_type text,
        created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
      )
    `;
    console.log('Table "public.profiles" verified/created.');

    // 2. Enable RLS
    await sql`
      ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY
    `;
    console.log('Row Level Security enabled.');

    // 3. Drop existing policies if any to avoid errors on duplicate runs
    await sql`DROP POLICY IF EXISTS "Public profiles are viewable by everyone." ON public.profiles`;
    await sql`DROP POLICY IF EXISTS "Users can insert their own profile." ON public.profiles`;
    await sql`DROP POLICY IF EXISTS "Users can update own profile." ON public.profiles`;

    // 4. Create policies
    await sql`
      CREATE POLICY "Public profiles are viewable by everyone." 
      ON public.profiles FOR SELECT USING (true)
    `;
    await sql`
      CREATE POLICY "Users can insert their own profile." 
      ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id)
    `;
    await sql`
      CREATE POLICY "Users can update own profile." 
      ON public.profiles FOR UPDATE USING (auth.uid() = id)
    `;
    console.log('Database security policies created successfully.');

    console.log('Database auth profiles setup complete!');
    process.exit(0);
  } catch (err) {
    console.error('Failed to setup profiles table:', err);
    process.exit(1);
  }
}

main();
