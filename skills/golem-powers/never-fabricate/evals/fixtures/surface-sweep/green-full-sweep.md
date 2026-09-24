# Completion report: compact-output preference

Implemented the new `compactOutput` preference and completed the surface sweep.

## Entry points

Checked: desktop Settings screen, **Toggle compact output** command-palette
command, and its keybinding — each updates the same persisted preference and
the next request. CLI flags, MCP tools, URLs, and schedules are N/A because this
is a desktop-session preference and those surfaces do not expose session UI
preferences in this repo.

## Clients

Checked: desktop renderer and session worker — the renderer persists and sends
the value, and the worker reads it for new and resumed sessions. Web, mobile,
extension, and external clients are N/A because the repository contains no such
consumers of the settings contract.

## Providers

Checked: Anthropic, OpenAI, and Ollama provider adapters — each maps enabled and
disabled values into its provider-specific request options. The mock adapter
was also checked and asserts the normalized option passed through the shared
interface.

## Contracts

Checked: persisted-settings schema and loader, renderer-to-worker IPC message,
shared provider-options type, and each provider request builder — both producers
and consumers accept the field; an absent value from an upgraded profile uses
the documented `false` default.

## Reverse states

Checked: disabling Compact output from Settings, toggling it off through the
command palette and keybinding, an empty/absent persisted value, and provider
request errors — disabling removes the compact request option immediately; an
error does not mutate the saved preference.

## Connection modes

Checked: fresh profile, upgraded profile without the field, resumed desktop
session, remote Anthropic/OpenAI sessions, local Ollama session, and offline
desktop startup — offline mode preserves the setting and applies it when the
next provider connection starts.

## Docs

Checked: Settings help text, command-palette description, keybinding reference,
and provider-options developer note — all name the preference and its default.
README and CLI help are N/A because neither documents desktop-only session
preferences.

Verification included settings-store tests, IPC contract tests, adapter tests
for Anthropic/OpenAI/Ollama/mock, reverse-state coverage, fresh/upgrade/resume
coverage, and a desktop live check of both enabling and disabling the preference.
