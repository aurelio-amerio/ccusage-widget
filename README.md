# ccusage-widget

A VS Code extension that shows today's Claude Code spend in the status bar and reveals a daily / monthly / active-session-block breakdown on hover.

## Prerequisites

Install ccusage globally before using this extension:

```sh
npm install -g ccusage
```

If ccusage is not found on your PATH when the extension activates, a prompt will appear with an option to install it automatically. You can also run it manually via the Command Palette:

> **ccusage Widget: Install / update ccusage globally**

## Usage

Once installed and ccusage is on your PATH, the widget activates automatically. The status bar item shows today's cost (`$4.27 $(search)`). Click it to force a refresh. Hover for a full breakdown.

### Settings

| Setting | Default | Description |
|---|---|---|
| `ccusageWidget.ccusageCommand` | `"ccusage"` | Binary to invoke. Override if ccusage is installed at a non-standard path. |
| `ccusageWidget.refreshIntervalMinutes` | `5` | How often to poll for fresh data. |
| `ccusageWidget.timezone` | `null` | IANA timezone passed to `ccusage --timezone`. |
| `ccusageWidget.showSessionBlock` | `true` | Show the active 5h session block in the tooltip. |
