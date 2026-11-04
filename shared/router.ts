import { estimateTheta, type IrtResponse } from "./irt";

export type Route = "lower" | "upper";

export interface RouterConfig {
  /** ETS does not publish an operational cut-off: always null. */
  officialThreshold: null;
  /** Internal training threshold on proportion correct (0–1). */
  trainingThreshold: number;
  /** Internal theta cut for the irt-lite model. */
  trainingThetaCut: number;
  model: "percent-correct" | "irt-lite";
}

export interface RouteDecision {
  route: Route;
  model: RouterConfig["model"];
  correct: number;
  total: number;
  proportion: number;
  theta: number | null;
  threshold: number;
  isOfficial: false;
}

export function routeModule1(responses: IrtResponse[], cfg: RouterConfig): RouteDecision {
  const total = responses.length;
  const correct = responses.filter((r) => r.correct).length;
  const proportion = total === 0 ? 0 : correct / total;
  if (cfg.model === "irt-lite") {
    const { theta } = estimateTheta(responses);
    return {
      route: theta >= cfg.trainingThetaCut ? "upper" : "lower",
      model: cfg.model,
      correct,
      total,
      proportion,
      theta,
      threshold: cfg.trainingThetaCut,
      isOfficial: false,
    };
  }
  return {
    route: proportion >= cfg.trainingThreshold ? "upper" : "lower",
    model: cfg.model,
    correct,
    total,
    proportion,
    theta: null,
    threshold: cfg.trainingThreshold,
    isOfficial: false,
  };
}
