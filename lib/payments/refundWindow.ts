// Is a self-serve refund still allowed for a paid registration/participation?
//
// A dedicated no-refund date, when set, is the authoritative cutoff — refunds stop
// at the START of that day (no refunds on or after it). When it's unset, we fall
// back to the registration-close deadline (legacy behavior). With neither set,
// refunds are always allowed within the cancel flow.
//
// `noRefundDate` is a 'YYYY-MM-DD' date string; `registrationClosesAt` is an ISO
// timestamptz. This does NOT apply to organizer-initiated cancellations, which
// refund regardless of the cutoff.
export function isWithinRefundWindow(
  noRefundDate?: string | null,
  registrationClosesAt?: string | null,
): boolean {
  const noRefund = noRefundDate ? new Date(noRefundDate + 'T00:00:00') : null
  const regClose = registrationClosesAt ? new Date(registrationClosesAt) : null
  const cutoff = noRefund ?? regClose
  return !cutoff || new Date() < cutoff
}
