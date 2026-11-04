/**
 * Rasch (1PL) helpers used for the INTERNAL "irt-lite" router and for training
 * projections. Item difficulties are author estimates, not ETS calibrations.
 */
export interface IrtResponse {
  b: number;
  correct: boolean;
}

export function pCorrect(theta: number, b: number): number {
  return 1 / (1 + Math.exp(-(theta - b)));
}

/** Expected-a-posteriori ability estimate with a N(mu, sigma) prior over a grid. */
export function estimateTheta(
  responses: IrtResponse[],
  prior: { mu: number; sigma: number } = { mu: 0.5, sigma: 1.2 },
): { theta: number; sd: number; n: number } {
  const grid: number[] = [];
  for (let t = -4; t <= 4.0001; t += 0.05) grid.push(t);
  const logPost = grid.map((t) => {
    let lp = -0.5 * ((t - prior.mu) / prior.sigma) ** 2;
    for (const r of responses) {
      const p = pCorrect(t, r.b);
      lp += Math.log(r.correct ? p : 1 - p);
    }
    return lp;
  });
  const max = Math.max(...logPost);
  const w = logPost.map((lp) => Math.exp(lp - max));
  const z = w.reduce((a, b) => a + b, 0);
  const theta = grid.reduce((acc, t, i) => acc + t * w[i]!, 0) / z;
  const variance = grid.reduce((acc, t, i) => acc + (t - theta) ** 2 * w[i]!, 0) / z;
  return { theta, sd: Math.sqrt(variance), n: responses.length };
}
