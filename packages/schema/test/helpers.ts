import toyJson from "../fixtures/wholesale-offer.world.json";
import type { World } from "../src/types";

export function toyWorld(): World {
  return structuredClone(toyJson) as unknown as World;
}

export function clone<T>(x: T): T {
  return structuredClone(x);
}
