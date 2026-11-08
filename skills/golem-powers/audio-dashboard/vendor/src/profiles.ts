import os from "node:os";
import path from "node:path";
import { findProfile as findUpstreamProfile } from "../narrationlayer/profiles.js";
export { qwenConfigFromProfile, warnIfNonAcceptedProfile } from "../narrationlayer/profiles.js";

export function findProfile(id: string, cwd?: string) {
  const root = process.env.NARRATIONLAYER_ROOT;
  const configured = root?.startsWith("~/") ? path.join(os.homedir(), root.slice(2)) : root;
  return findUpstreamProfile(id, configured ? path.resolve(configured) : cwd);
}
