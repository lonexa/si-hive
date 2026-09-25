@echo off
REM hive-img — Windows shim that hands off to the Node CLI.
REM Located in apps/hive/scripts/. Hive prepends this directory to PATH
REM for every spawned PTY so agents (Claude / Gemini / Codex) can invoke
REM the tool via plain `hive-img <path>`.
node "%~dp0hive-img.cjs" %*
