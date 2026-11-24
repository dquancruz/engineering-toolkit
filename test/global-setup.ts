import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The smoke test runs the compiled bin, so build once before the suite.
export default function setup(): void {
  const root = fileURLToPath(new URL("..", import.meta.url));
  // On Windows npm is npm.cmd, which cannot be started without a shell.
  execFileSync("npm", ["run", "build", "--silent"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
}
