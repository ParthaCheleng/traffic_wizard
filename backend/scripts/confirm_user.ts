import postgres from 'postgres';
import * as dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  try {
    console.log('Confirming demo user email in auth.users...');
    const result = await sql`
      UPDATE auth.users 
      SET email_confirmed_at = NOW()
      WHERE email = 'demo@trafficwizard.com'
    `;
    console.log('Update query executed successfully. Result:', result);
    
    // Sync to public.users
    const userRow = await sql`
      SELECT id FROM auth.users WHERE email = 'demo@trafficwizard.com'
    `;
    
    if (userRow.length > 0) {
      const userId = userRow[0].id;
      await sql`
        INSERT INTO public.users (id, created_at)
        VALUES (${userId}, NOW())
        ON CONFLICT (id) DO NOTHING
      `;
      console.log('User synced to public.users table successfully.');
    } else {
      console.log('User demo@trafficwizard.com not found in auth.users.');
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Failed to confirm and sync user:', err);
    process.exit(1);
  }
}

main();
