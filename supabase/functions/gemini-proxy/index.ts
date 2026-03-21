import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Deprecated: client now calls Gemini directly from the frontend with @google/genai.
// Keep this stub to avoid accidental v1beta calls.

export default async function handler(_req: Request): Promise<Response> {
  return new Response(
    JSON.stringify({
      error: "Deprecated endpoint",
      message: "Use the frontend Gemini client; this proxy is disabled.",
    }),
    { status: 410, headers: { "Content-Type": "application/json", ...corsHeaders } },
  );
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
