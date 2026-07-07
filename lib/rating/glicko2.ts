// Pure Glicko-2 rating core (Glickman, "Example of the Glicko-2 system"). No DB, no
// side effects, no I/O. Works on the standard Glicko-2 internal scale and returns
// ratings on the display scale (base 1500). Validated against the paper's published
// worked example in the tests. Part of the Phase 2 engine — see
// docs/phases/rating-engine-phase2.md. NOT wired to anything yet.

export const DEFAULT_RATING = 1500
export const DEFAULT_RD = 350
export const DEFAULT_VOL = 0.06
export const DEFAULT_TAU = 0.5

const SCALE = 173.7178 // Glicko-2 ⇄ display-scale conversion constant
const CONVERGENCE = 0.000001

export type Glicko2Rating = { rating: number; rd: number; vol: number }
/** One game outcome from the player's perspective. score: 1 win · 0.5 draw · 0 loss. */
export type Glicko2Game = { opponentRating: number; opponentRd: number; score: number }

const g = (phi: number): number => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI))
const expectedScore = (mu: number, muJ: number, phiJ: number): number =>
  1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)))

// Update a player's rating from ONE rating period's games. Empty games ⇒ inactivity.
export function updateRating(player: Glicko2Rating, games: Glicko2Game[], tau = DEFAULT_TAU): Glicko2Rating {
  if (games.length === 0) return applyInactivity(player)

  const mu = (player.rating - DEFAULT_RATING) / SCALE
  const phi = player.rd / SCALE
  const sigma = player.vol

  // Estimated variance v and improvement direction Σ g(φ_j)(s_j − E).
  let invV = 0
  let sumGxE = 0
  for (const gm of games) {
    const muJ = (gm.opponentRating - DEFAULT_RATING) / SCALE
    const phiJ = gm.opponentRd / SCALE
    const gPhiJ = g(phiJ)
    const e = expectedScore(mu, muJ, phiJ)
    invV += gPhiJ * gPhiJ * e * (1 - e)
    sumGxE += gPhiJ * (gm.score - e)
  }
  const v = 1 / invV
  const delta = v * sumGxE

  // New volatility σ' via the Illinois (regula-falsi) iteration.
  const a = Math.log(sigma * sigma)
  const f = (x: number): number => {
    const ex = Math.exp(x)
    const num = ex * (delta * delta - phi * phi - v - ex)
    const den = 2 * Math.pow(phi * phi + v + ex, 2)
    return num / den - (x - a) / (tau * tau)
  }
  let A = a
  let B: number
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v)
  } else {
    let k = 1
    while (f(a - k * tau) < 0) k++
    B = a - k * tau
  }
  let fA = f(A)
  let fB = f(B)
  while (Math.abs(B - A) > CONVERGENCE) {
    const C = A + ((A - B) * fA) / (fB - fA)
    const fC = f(C)
    if (fC * fB <= 0) { A = B; fA = fB } else { fA = fA / 2 }
    B = C
    fB = fC
  }
  const newSigma = Math.exp(A / 2)

  // Pre-period RD, then updated φ' and μ'.
  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma)
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v)
  const newMu = mu + newPhi * newPhi * sumGxE

  return {
    rating: SCALE * newMu + DEFAULT_RATING,
    rd: SCALE * newPhi,
    vol: newSigma,
  }
}

// A player who didn't compete this period: RD grows (φ* = √(φ² + σ²)), rating & vol
// unchanged. Capped at the default so uncertainty never exceeds "brand new".
export function applyInactivity(player: Glicko2Rating): Glicko2Rating {
  const phi = player.rd / SCALE
  const phiStar = Math.sqrt(phi * phi + player.vol * player.vol)
  return {
    rating: player.rating,
    rd: Math.min(SCALE * phiStar, DEFAULT_RD),
    vol: player.vol,
  }
}
