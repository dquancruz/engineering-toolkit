/** Replaces `{{name}}` placeholders. An unknown placeholder is an error (it would be a typo in a template). */
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new Error(`Unknown template placeholder: {{${name}}}`);
    return value;
  });
}
