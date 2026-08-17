// Public entry point for src/core/engine — the only path app/ (or any
// other core family) may import through, per eslint-plugin-boundaries
// (docs/adr/0003-module-boundary-enforcement.md).

export { runEngine, ENGINE_VERSION } from "./calculate";
export { roundRatioHalfUp4dp, ratioBasisPoints } from "./rounding";
export type {
  Occupancy,
  EngineCostTable,
  EngineInput,
  EngineElementResult,
  EngineOutput,
  ThresholdResult,
} from "./types";
