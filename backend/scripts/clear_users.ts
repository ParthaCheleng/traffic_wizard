import postgres from 'postgres';
import * as dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  try {
    console.log('Connecting to database to remove all users...');
    
    // Run deletion in a transaction to prevent partial states if any constraint fails
    await sql.begin(async (sql) => {
      console.log('Truncating device locations telemetry...');
      await sql`DELETE FROM public.device_locations`;
      
      console.log('Deleting profiles metadata...');
      // Use Try/Catch or check if profiles table exists to avoid crashes
      try {
        await sql`DELETE FROM public.profiles`;
      } catch (e: any) {
        console.warn('Could not clear public.profiles (might not exist or already empty):', e.message);
      }

      console.log('Clearing public.users references...');
      await sql`DELETE FROM public.users`;

      console.log('Deleting all users from auth.users (Supabase Auth)...');
      await sql`DELETE FROM auth.users`;
    });

    console.log('Successfully removed all users and related telemetry/profiles from the database!');
    process.exit(0);
  } catch (err) {
    console.error('Failed to remove users from database:', err);
    process.exit(1);
  }
}

main();
