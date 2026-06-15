// Vercel serverless function: transcript -> structured workout JSON.
//
// Reads the Gemini key from process.env at request time. Accepts either
// GEMINI_API_KEY (preferred, self-documenting) or RK (the user's chosen short
// name) — set in the Vercel dashboard under Project Settings -> Environment
// Variables. It is NEVER included in any response or logged in detail.
//
// Endpoint:  POST /api/parse-workout
// Body:      { "transcript": "bench 3x8 at 60, then hammer curls 4x10 at 15" }
// Returns:   { "workouts": [
//              { "exercise": "...", "sets": [{"reps":N,"weight":N}, ...],
//                "unit": "kg", "notes": "...", "rpe": null | 1-10 },
//              ... up to MAX_WORKOUTS entries
//            ] }
//
// Hard cap: MAX_WORKOUTS exercises per call. Above that we return 422 so the
// user can split the recording. This guards against runaway prompts and keeps
// the preview UI sane.

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const MAX_WORKOUTS = 10;

// Schema for a single workout entry (one exercise + its sets).
const WORKOUT_ITEM = {
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
    rpe:   { type: 'integer', nullable: true },
  },
  required: ['exercise', 'sets', 'unit', 'notes'],
};

// Top-level: always a `workouts` array. Single-exercise rant returns length 1.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    workouts: {
      type: 'array',
      items: WORKOUT_ITEM,
    },
  },
  required: ['workouts'],
};

const SYSTEM_INSTRUCTION = `You extract structured workout data from transcribed user speech.

Output STRICT JSON conforming to the response schema. The top level is always an object with a single "workouts" array. No prose, no markdown, no commentary.

A single transcript may describe MULTIPLE exercises. Return one entry per distinct exercise. A single-exercise transcript returns a "workouts" array of length 1.

Field rules (per workout entry):
- exercise: prefer canonical names when close to one of: Bench Press, Squat, Deadlift, Overhead Press, Barbell Row, Pull-up. For other lifts (Romanian Deadlift, Lat Pulldown, Tricep Pushdown, Hammer Curl, Lateral Raise, Hip Thrust, etc.) use the most common Title-Case English name. Map informal terms: "bench" -> "Bench Press", "OHP" -> "Overhead Press", "RDLs" -> "Romanian Deadlift", "pull ups" -> "Pull-up", "squats" -> "Squat", "lat raises" -> "Lateral Raise".
- sets: an explicit array of {reps, weight} objects. Expand "three sets of eight at 60" to three identical objects. Parse "8 at 60, 8 at 60, 6 at 65" as three distinct objects. Weight 0 is valid (bodyweight Pull-up).
- unit: ALWAYS "kg". If user says lb / lbs / pounds, convert (multiply by 0.453592) and round to the nearest 0.5 kg before storing in the weight field.
- notes: capture sensations (felt heavy/strong/easy), injury or discomfort mentions (shoulder tight, lower back fatigue), equipment notes. Strip rep/weight chatter already captured structurally. Empty string if nothing notable. Do NOT include text about other exercises in this field — that text belongs in its own workout entry.
- rpe: integer 1-10 ONLY if user explicitly mentions RPE, "rate of perceived exertion", or "felt like an X" for that specific exercise. Otherwise null.

Multi-exercise parsing: phrases like "then I did", "after that", "next was", "and then", or a new exercise name introduce a new entry. Notes attached to a phrase ("shoulder felt tight on the last set of bench") belong on that exercise's entry, not subsequent ones.

Examples:

Input: "three sets of bench, eight at sixty, eight at sixty, six at sixty-five"
Output: {"workouts":[{"exercise":"Bench Press","sets":[{"reps":8,"weight":60},{"reps":8,"weight":60},{"reps":6,"weight":65}],"unit":"kg","notes":"","rpe":null}]}

Input: "RDLs four sets of six at a hundred kilos last set felt heavy lower back kind of tight rpe 8"
Output: {"workouts":[{"exercise":"Romanian Deadlift","sets":[{"reps":6,"weight":100},{"reps":6,"weight":100},{"reps":6,"weight":100},{"reps":6,"weight":100}],"unit":"kg","notes":"Last set felt heavy. Lower back tight.","rpe":8}]}

Input: "bench 3 sets of 8 at 60, then hammer curls 4 sets of 10 at 15, then lateral raises 3 sets of 12 at 8"
Output: {"workouts":[{"exercise":"Bench Press","sets":[{"reps":8,"weight":60},{"reps":8,"weight":60},{"reps":8,"weight":60}],"unit":"kg","notes":"","rpe":null},{"exercise":"Hammer Curl","sets":[{"reps":10,"weight":15},{"reps":10,"weight":15},{"reps":10,"weight":15},{"reps":10,"weight":15}],"unit":"kg","notes":"","rpe":null},{"exercise":"Lateral Raise","sets":[{"reps":12,"weight":8},{"reps":12,"weight":8},{"reps":12,"weight":8}],"unit":"kg","notes":"","rpe":null}]}

Input: "pull-ups three by ten bodyweight, then bench press 5 sets of 5 at 135 pounds, shoulder felt tight on bench"
Output: {"workouts":[{"exercise":"Pull-up","sets":[{"reps":10,"weight":0},{"reps":10,"weight":0},{"reps":10,"weight":0}],"unit":"kg","notes":"","rpe":null},{"exercise":"Bench Press","sets":[{"reps":5,"weight":61.5},{"reps":5,"weight":61.5},{"reps":5,"weight":61.5},{"reps":5,"weight":61.5},{"reps":5,"weight":61.5}],"unit":"kg","notes":"Shoulder felt tight.","rpe":null}]}`;

export default async function handler(req, res) {
  // CORS not needed: function and client share an origin (same Vercel project).

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  if (!(process.env.GEMINI_API_KEY || process.env.RK)) {
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
    gResp = await fetch(`${GEMINI_URL}?key=${encodeURIComponent((process.env.GEMINI_API_KEY || process.env.RK))}`, {
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

  // Defensive: schema should guarantee `workouts` is an array, but verify.
  if (!parsed || !Array.isArray(parsed.workouts)) {
    return res.status(502).json({ error: 'Gemini returned an unexpected shape.', raw: JSON.stringify(parsed).slice(0, 300) });
  }

  // Cap: refuse oversized rants so the preview UI stays manageable.
  if (parsed.workouts.length > MAX_WORKOUTS) {
    return res.status(422).json({
      error: `Too many exercises in one rant (${parsed.workouts.length}). Split into two recordings — max ${MAX_WORKOUTS} per rant.`,
    });
  }

  // Empty is also a soft failure — most likely Gemini understood the audio as non-workout chatter.
  if (parsed.workouts.length === 0) {
    return res.status(422).json({ error: 'No workouts detected in the transcript. Try again with clearer exercise names and sets.' });
  }

  return res.status(200).json(parsed);
}
