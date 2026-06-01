// Vercel serverless function: transcript -> structured workout JSON.
//
// Reads GEMINI_API_KEY from process.env at request time. The key is set in the
// Vercel dashboard under Project Settings -> Environment Variables. It is NEVER
// included in any response or logged in detail.
//
// Endpoint:  POST /api/parse-workout
// Body:      { "transcript": "three sets of bench, 8 at 60, 8 at 60, 6 at 65" }
// Returns:   { "exercise": "...", "sets": [{"reps":N,"weight":N}, ...],
//              "unit": "kg", "notes": "...", "rpe": null | 1-10 }

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// Strict JSON schema for Gemini's responseSchema feature. Guarantees shape.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    exercise: { type: 'string' },
    sets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          reps:   { type: 'integer' },
          weight: { type: 'number' },
        },
        required: ['reps', 'weight'],
      },
    },
    unit:  { type: 'string', enum: ['kg'] },
    notes: { type: 'string' },
    rpe:   { type: ['integer', 'null'] },
  },
  required: ['exercise', 'sets', 'unit', 'notes'],
};

const SYSTEM_INSTRUCTION = `You extract structured workout data from transcribed user speech.

Output STRICT JSON conforming to the response schema. No prose, no markdown, no commentary.

Field rules:
- exercise: prefer canonical names when close to one of: Bench Press, Squat, Deadlift, Overhead Press, Barbell Row, Pull-up. For other lifts (Romanian Deadlift, Lat Pulldown, Tricep Pushdown, Hip Thrust, etc.) use the most common Title-Case English name. Map informal terms: "bench" -> "Bench Press", "OHP" -> "Overhead Press", "RDLs" -> "Romanian Deadlift", "pull ups" -> "Pull-up", "squats" -> "Squat".
- sets: an explicit array of {reps, weight} objects. Expand "three sets of eight at 60" to three identical objects. Parse "8 at 60, 8 at 60, 6 at 65" as three distinct objects. Weight 0 is valid (bodyweight Pull-up).
- unit: ALWAYS "kg". If user says lb / lbs / pounds, convert (multiply by 0.453592) and round to the nearest 0.5 kg before storing in the weight field.
- notes: capture sensations (felt heavy/strong/easy), injury or discomfort mentions (shoulder tight, lower back fatigue), equipment notes. Strip rep/weight chatter already captured structurally. Empty string if nothing notable.
- rpe: integer 1-10 ONLY if user explicitly mentions RPE, "rate of perceived exertion", or "felt like an X". Otherwise null.

Examples:

Input: "three sets of bench, eight at sixty, eight at sixty, six at sixty-five"
Output: {"exercise":"Bench Press","sets":[{"reps":8,"weight":60},{"reps":8,"weight":60},{"reps":6,"weight":65}],"unit":"kg","notes":"","rpe":null}

Input: "RDLs four sets of six at a hundred kilos last set felt heavy lower back kind of tight rpe 8"
Output: {"exercise":"Romanian Deadlift","sets":[{"reps":6,"weight":100},{"reps":6,"weight":100},{"reps":6,"weight":100},{"reps":6,"weight":100}],"unit":"kg","notes":"Last set felt heavy. Lower back tight.","rpe":8}

Input: "pull-ups three by ten bodyweight"
Output: {"exercise":"Pull-up","sets":[{"reps":10,"weight":0},{"reps":10,"weight":0},{"reps":10,"weight":0}],"unit":"kg","notes":"","rpe":null}

Input: "bench press 5 sets of 5 at 135 pounds"
Output: {"exercise":"Bench Press","sets":[{"reps":5,"weight":61.5},{"reps":5,"weight":61.5},{"reps":5,"weight":61.5},{"reps":5,"weight":61.5},{"reps":5,"weight":61.5}],"unit":"kg","notes":"","rpe":null}`;

export default async function handler(req, res) {
  // CORS not needed: function and client share an origin (same Vercel project).

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({
      error: 'API key not configured. Add GEMINI_API_KEY in Vercel Project Settings -> Environment Variables, then redeploy.',
    });
  }

  // Vercel auto-parses JSON bodies when Content-Type is application/json.
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';

  if (transcript.length === 0) {
    return res.status(400).json({ error: 'transcript (non-empty string) is required.' });
  }
  if (transcript.length > 2000) {
    return res.status(400).json({ error: 'transcript too long (max 2000 chars).' });
  }

  const geminiBody = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: transcript }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.1,
    },
  };

  let gResp;
  try {
    gResp = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody),
    });
  } catch (err) {
    return res.status(502).json({ error: 'Could not reach Gemini.', detail: String(err.message || err).slice(0, 300) });
  }

  if (!gResp.ok) {
    const errText = await gResp.text();
    return res.status(502).json({
      error: 'Gemini API error.',
      status: gResp.status,
      // Truncated; never includes the key (it's only in the URL we sent, not the response we got).
      detail: errText.slice(0, 300),
    });
  }

  const data = await gResp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    return res.status(502).json({
      error: 'Gemini returned no text.',
      finishReason: data?.candidates?.[0]?.finishReason,
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return res.status(502).json({ error: 'Gemini returned invalid JSON.', raw: text.slice(0, 300) });
  }

  return res.status(200).json(parsed);
}
