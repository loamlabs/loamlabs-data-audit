// This file receives and stores the abandoned build data.
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// --- CORS Headers ---
// These headers tell the browser that requests from your Shopify store are allowed.
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://loamlabsusa.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
  // --- CORS Preflight Handling ---
  // This is the new "bouncer" logic. It handles the browser's OPTIONS security check.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // --- Existing POST Handling ---
  // Your original logic for handling the actual data now runs only for POST requests.
  if (req.method === 'POST') {
    try {
      const buildData = await req.json(); // Use req.json() for Vercel edge functions
      
      const dataToStore = {
          ...buildData,
          capturedAt: new Date().toISOString(),
      };

      await redis.lpush('abandoned_builds', JSON.stringify(dataToStore));

      // Respond with 202 Accepted, including the CORS headers.
      return new Response(JSON.stringify({ message: 'Build data accepted.' }), {
        status: 202,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (error) {
      console.error('Error in log-abandoned-build:', error);
      return new Response(JSON.stringify({ message: 'Error processed.' }), {
        status: 202, // Always send success to the browser
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }
  
  // If the request is not OPTIONS or POST, deny it.
  return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
}
