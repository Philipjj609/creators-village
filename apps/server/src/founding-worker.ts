import { parentPort, workerData } from "node:worker_threads";
import { generateBaseline } from "@creators-village/world/founding";
try {
  parentPort!.postMessage({ baseline: generateBaseline(workerData.seed) });
} catch {
  parentPort!.postMessage({ error: "Geography could not be certified" });
}
