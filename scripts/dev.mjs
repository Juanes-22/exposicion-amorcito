// Arranca servidor (tsx watch) y Vite a la vez; Ctrl+C detiene ambos.
import { spawn } from "node:child_process";

const children = [
  spawn("npm", ["run", "dev:server"], { stdio: "inherit" }),
  spawn("npm", ["run", "dev:client"], { stdio: "inherit" }),
];
const stop = () => children.forEach((c) => c.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const c of children) c.on("exit", (code) => {
  stop();
  process.exitCode ||= code ?? 0;
});
