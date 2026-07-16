// Shared machine-code → HTTP status + friendly-message mapping for the Phase-5 lifecycle routes
// (withdraw / reclaim / organizer-correct). The RPCs raise the code as the exception message.

export const LIFECYCLE_STATUS: Record<string, number> = {
  bad_request: 400,
  request_not_found: 404, placement_not_found: 404, occasion_not_found: 404, accepter_not_found: 404,
  not_current_substitute: 403, not_requester: 403, accepter_ineligible: 403, gender_mismatch: 403, own_request: 403,
  organizer_required: 403,
  not_filled: 409, already_reopened: 409, already_cancelled: 409, already_expired: 409,
  duplicate_participation: 409, generation_started: 409, unsafe_after_start: 409, placement_mismatch: 409,
  occasion_started: 410,
}

const MESSAGES: Record<string, string> = {
  request_not_found: 'That request is no longer available.',
  not_current_substitute: "You're not the current substitute for this request.",
  not_requester: 'Only the player who requested the sub can do that.',
  not_filled: 'This request no longer has a substitute to change.',
  already_reopened: 'This request has already been reopened.',
  already_cancelled: 'This request was already resolved.',
  already_expired: 'This request has expired.',
  occasion_started: 'This session has already started — ask your organizer to make the change.',
  generation_started: 'The lineup is already set — ask your organizer to make the change.',
  unsafe_after_start: "This can't be changed now — ask your organizer.",
  gender_mismatch: "That player's profile doesn't match this session's format.",
  accepter_ineligible: 'That player needs to finish setting up their profile first.',
  duplicate_participation: 'That player is already in this session.',
  own_request: "You can't assign the player to cover their own spot.",
  placement_not_found: 'The current placement could not be found.',
}

export function lifecycleMessage(code: string, status: number): string {
  return MESSAGES[code] ?? (status === 500 ? 'Something went wrong. Try again.' : code)
}
