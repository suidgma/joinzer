/**
 * Directory Session 3b — LLM enrichment provider (Gemini).
 *
 * ONE-FILE-SWAP wrapper (brief decision 5): the rest of the pipeline calls generateEnrichment();
 * to change providers later, replace this file. Uses the Gemini REST API directly (global fetch,
 * no SDK → no new deps). JSON output mode + a strictly-grounded prompt to avoid hallucinated facts.
 */

export const PROVIDER = 'gemini'
// flash-lite-latest: current, cheap, and has open free-tier quota (gemini-2.0-flash's free quota is exhausted).
export const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function buildPrompt(f) {
  const facts = [
    `Name: ${f.name}`,
    f.city ? `City/area: ${f.city}, ${f.state}` : `Area: ${f.state}`,
    f.access_type && f.access_type !== 'unknown' ? `Access type: ${f.access_type}` : null,
    f.indoor === true ? 'Indoor facility' : f.indoor === false ? 'Outdoor facility' : null,
    f.surface ? `Court surface: ${f.surface}` : null,
  ].filter(Boolean).join('\n')

  // The load-bearing constraint: generate only from known facts; never invent specifics.
  return `You are writing a short, factual directory listing for a pickleball facility.
Write ONLY from the facts provided. Do NOT invent hours, prices, phone numbers, exact court counts,
ratings, website URLs, or any specific detail not given. When a specific is unknown, speak generally
about what players typically find at a venue like this, or say it varies and to check ahead.

Facility facts:
${facts}

Return a JSON object with exactly these fields:
- "description": 2-3 sentence factual, welcoming overview of this pickleball facility. No invented specifics.
- "amenities": array of 3-6 short strings that are safe to state for this kind of venue (e.g. "Dedicated pickleball courts"). No unverifiable claims.
- "whatToKnow": array of 3-5 short, practical visitor tips, generic and safe.
- "nearby": 1-2 sentences about the general ${f.city || f.state} area for players. Do not name specific businesses.
- "faqs": array of 3-4 objects {"q","a"} of commonly, safely-answerable questions.

Be concise and genuinely useful. Never fabricate.`
}

export async function generateEnrichment(facility, apiKey, attempt = 1) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(facility) }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 1200 },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { await sleep(4000 * attempt); return generateEnrichment(facility, apiKey, attempt + 1) }
    const err = new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 220)}`); err.status = res.status; throw err
  }
  const json = await res.json()
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini returned no text: ' + JSON.stringify(json).slice(0, 160))
  return JSON.parse(text)
}
