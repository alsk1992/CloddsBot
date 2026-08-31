/**
 * Solder Cortex Integration for Clodds
 * 
 * Adds conviction scoring for prediction market bets.
 * Before placing bets, check conviction of wallets making similar bets.
 * 
 * Demo: http://76.13.193.103/
 * GitHub: https://github.com/metalmcclaw/solder-cortex
 */

const CORTEX_API = process.env.CORTEX_API_URL || 'http://76.13.193.103/api';

export interface ConvictionData {
  wallet: string;
  score: number;
  defiActivity: number;
  predictionMarketActivity: number;
}

export async function getWalletConviction(wallet: string): Promise<ConvictionData | null> {
  try {
    const res = await fetch(`${CORTEX_API}/conviction/${wallet}`);
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

export async function findInformedBettors(wallets: string[]): Promise<ConvictionData[]> {
  const results = await Promise.all(wallets.map(getWalletConviction));
  return results
    .filter((c): c is ConvictionData => c !== null && c.score >= 0.7)
    .sort((a, b) => b.score - a.score);
}

export async function shouldFollowBet(wallet: string): Promise<{ follow: boolean; reason: string }> {
  const conviction = await getWalletConviction(wallet);
  if (!conviction) return { follow: false, reason: 'Could not fetch conviction' };
  return conviction.score >= 0.7
    ? { follow: true, reason: `High conviction (${conviction.score.toFixed(2)}) - informed bettor` }
    : { follow: false, reason: `Low conviction (${conviction.score.toFixed(2)})` };
}
