import type { TestProject } from "vitest/node";
import { startIntegrationDatabase } from "./ephemeral-postgres";

export default function setup(project: TestProject): Promise<() => void> {
  return startIntegrationDatabase(project);
}
