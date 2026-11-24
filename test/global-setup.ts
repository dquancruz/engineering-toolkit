import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The smoke test runs the compiled bin, so build once before the suite.
export default function setup(): void {
  const root = fileURLToPath(new URL("..", import.meta.url));
  execFileSync("npm", ["run", "build", "--silent"], { cwd: root, stdio: "inherit" });
}
