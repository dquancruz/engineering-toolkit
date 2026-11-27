/**
 * Takes the place of KaTeX in the build of the Mermaid page, and refuses every formula. Mermaid calls it before
 * it puts a label that has a formula into the page as HTML, so failing here keeps that HTML out.
 */
import { FORMULA_REFUSED } from "../../core/diagram/source.js";

export default {
  renderToString: (): never => {
    throw new Error(FORMULA_REFUSED);
  },
};
