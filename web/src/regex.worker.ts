import { evaluate, type RegexRequest } from "./core/regex.js";

const scope = self as unknown as { onmessage: (event: { data: RegexRequest }) => void; postMessage: (message: unknown) => void };

scope.onmessage = (event) => scope.postMessage(evaluate(event.data));
