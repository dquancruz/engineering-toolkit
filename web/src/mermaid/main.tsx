import { render } from "preact";
import { App } from "./App.js";
import "../styles.css";
import "./mermaid.css";

render(<App />, document.getElementById("app")!);
