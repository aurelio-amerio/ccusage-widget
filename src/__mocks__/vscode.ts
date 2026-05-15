export class MarkdownString {
  value = "";
  isTrusted = false;
  supportThemeIcons = false;
  appendMarkdown(md: string): this {
    this.value += md;
    return this;
  }
}
