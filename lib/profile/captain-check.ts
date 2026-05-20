import { createClient as createAdmin } from '@supabase/supabase-js'

const service = () => createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Cheap at pilot scale (small joins, indexed). If profile-view density
// grows, consider memoizing by (viewerId, targetUserId) within request
// scope. Not needed now.
export async function isCaptainOf(viewerId: string, targetUserId: string): Promise<boolean> {
  const { data } = await service().rpc('is_captain_of', {
    viewer_id: viewerId,
    target_id: targetUserId,
  })
  return data === true
}
