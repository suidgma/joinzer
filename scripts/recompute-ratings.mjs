// One-off / manual rating backfill. Runs the exact tested TS engine via tsx:
//   npx --yes tsx scripts/recompute-ratings.mjs
// Reads Supabase creds from .env.local (service role). Writes player_ratings + the
// profiles cache. Idempotent (full replace). Not player-visible until slice 5.

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { recomputeAllRatings } from '../lib/rating/recompute.ts'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const admin = createClient(url, key)
const asOf = new Date().toISOString()
console.log(`[recompute] as of ${asOf} …`)

recomputeAllRatings(admin, { asOf })
  .then((summary) => {
    console.log('[recompute] done:', JSON.stringify(summary, null, 2))
    process.exit(0)
  })
  .catch((err) => {
    console.error('[recompute] failed:', err)
    process.exit(1)
  })
