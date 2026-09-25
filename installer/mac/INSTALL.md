# Installing SI Hive on macOS

SI Hive runs as a small local server on your Mac, which you use in your browser at
`http://localhost:4747`. It's the same app the Windows installer sets up.

You need macOS 13 or later (Apple Silicon or Intel) and an internet connection.
The installer downloads its dependencies from npm while it runs.

## Install

1. Unzip `HiveMac.zip`. Double-clicking it in Finder is fine.
2. Open **Terminal** and run:

   ```bash
   cd ~/Downloads/HiveMac
   bash install.sh
   ```

   Run it as yourself. **Don't use `sudo`**, because SI Hive installs into your
   own user account and doesn't need an admin password.
3. The install takes about 3–5 minutes. When it finishes, SI Hive opens in your
   browser. No sign-in is needed by default; turn on login in Settings → Authentication if you want it.

SI Hive starts automatically every time you log in.

> Always start the installer with `bash install.sh`. If you double-click it
> instead, macOS blocks it because the script isn't signed.

## Updating

Click **Refresh from Repo** in SI Hive. It downloads the latest version, rebuilds,
and restarts. This works the same way as on Windows, so you don't need to
reinstall.

If you ever need to reinstall, run `bash install.sh` again from a newer
`HiveMac.zip`. Your settings are kept.

## Where things live

| Thing                | Path                                              |
| -------------------- | ------------------------------------------------- |
| App                  | `~/Library/Hive/app`                              |
| Bundled Node.js      | `~/Library/Hive/node`                             |
| LaunchAgent          | `~/Library/LaunchAgents/dev.hive.server.plist` |
| Server log           | `~/Library/Logs/Hive/server.log`                  |
| Install log          | `~/Library/Logs/Hive/install.log`                 |
| Settings + database  | `~/.hive`                                         |

## Uninstall

```bash
bash ~/Library/Hive/uninstall.sh          # keeps settings in ~/.hive
bash ~/Library/Hive/uninstall.sh --all    # removes settings and logs too
```

## Troubleshooting

**The installer failed.** The error message shows the last lines of the log.
The full log is at `~/Library/Logs/Hive/install.log`. Fix the problem and
re-run `bash install.sh`. Re-running is always safe.

**"better-sqlite3 / node-pty did not load".** npm couldn't download a prebuilt
native module and had to compile it. Install Apple's command line tools, then
re-run the installer:

```bash
xcode-select --install
```

**SI Hive isn't responding.** Check the server log:

```bash
tail -100 ~/Library/Logs/Hive/server.log
```

Restart the server:

```bash
launchctl kickstart -k gui/$(id -u)/dev.hive.server
```

**Port 4747 is already in use.** Find the process that's holding it:

```bash
lsof -nP -iTCP:4747 -sTCP:LISTEN
```

**Terminals in SI Hive fail with "posix_spawnp failed".** Restart SI Hive with the
`kickstart` command above. The server fixes the permission on the terminal
helper every time it starts.

---

## For maintainers: building HiveMac.zip

You can build the zip on Windows. You don't need a Mac:

```bash
node installer/mac/build-mac-bundle.cjs
```

The script writes `installer/HiveMac.zip`. It builds from the **HEAD commit**,
not your working tree, and stamps that commit as the installed version.
Commit and push first. Node.js for both Mac architectures is downloaded and
checksum-verified into `installer/mac/.node-cache/`.
