import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

async function run() {
  const email = 'demo@trafficwizard.com';
  const password = 'DemoPassword123!';

  console.log('Testing sign-in with password...');
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    console.error('Sign-in failed. Error details:', JSON.stringify(error, null, 2));
  } else {
    console.log('Sign-in succeeded! Session Access Token:', data.session?.access_token ? 'TOKEN_RECEIVED' : 'NO_TOKEN');
  }
}

run();
