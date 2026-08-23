# Seedbox — Topaz W&B calculator deploy

Thanks for setting up the restricted deploy key. We initially misread it and
tried to use `rsync`, which fails against a forced command. We've switched to
the tarball-over-stdin interface you designed. Three short questions below.

---

## What we now understand

The deploy key in `authorized_keys` is restricted to a forced command
(`command="…"`), so it ignores any command the client requests and always runs
its own — extracting a gzipped tarball from stdin.

We diagnosed this from CI: we asked the server to run `whoami`, and it replied
with `gzip: stdin: unexpected end of file` / `tar: Child returned status 1` —
i.e. it ran `tar` regardless of what we asked, and got no stdin.

Our deploy step is now:

```bash
tar -czf - -C dist . | ssh -i <deploy_key> jackbr4@narvi.whatbox.ca
```

The archive contains the site's files at its root (`./index.html`,
`./assets/…`, `./manifest.webmanifest`, icons) — no wrapping directory, so it
extracts straight into whatever `-C` directory the forced command targets.

---

## What we'd like confirmed

### 1. Where does the forced command extract to?

We assume `/home/jackbr4/apps/janskiairplane/dist/`. Please confirm — this is
the one thing we can't see from our side.

```bash
grep janskiairplane ~/.ssh/authorized_keys
```

(The `command="…"` prefix is all we need; the key material itself is not
relevant and doesn't need to be shared.)

### 2. Is that the same directory nginx serves on port 8790?

This is our main open question. `http://narvi.whatbox.ca:8790/` currently
returns HTTP 200 with a 61-byte placeholder:

```html
<!doctype html><html><body><p>Deploying…</p></body></html>
```

`Last-Modified` is **2026-06-08** and hasn't changed. If the extract directory
and the nginx `root` are different paths, our files land somewhere nobody
serves. The `root` for the 8790 server block is what we need:

```bash
grep -rn -B3 -A12 '8790' /etc/nginx/ ~/.config/nginx ~/nginx 2>/dev/null \
  | grep -iE '8790|root|alias'
```

If it differs from the extract path, please point one at the other — either is
fine by us.

### 3. Does the forced command replace stale files?

`tar -xzf -` overlays: it overwrites files present in the archive but leaves
behind ones that aren't. Our `index.html` will overwrite the placeholder
(same name, so that resolves itself), but old content-hashed
`assets/index-<hash>.js` files will accumulate over time.

Harmless for now, and entirely your call whether to bother. If you'd like it
cleaned, adding something like `--recursive-unlink`, or a `rm -rf` of the
target before extracting, would do it.

---

## Two optional extras

Neither blocks us.

**a. HTTPS.** This is a Progressive Web App that pilots install to their phone
home screen. Service workers — the part that makes it work **offline in the
cockpit with no signal** — are disabled by browsers on plain HTTP. Over HTTP
it installs and runs, but only with a connection. If TLS is easy on your side,
offline mode starts working with no change on ours.

**b. Don't cache `index.html`.** JS/CSS filenames are content-hashed and safe
to cache forever, but if `index.html` is cached aggressively, phones keep
booting an old build after a deploy:

```nginx
location = /index.html {
    add_header Cache-Control "no-cache";
}
```

---

## Reference

| | |
|---|---|
| Repository | https://github.com/EwkaPotrafi/janskiairplane |
| Deploy | GitHub Actions → `tar -czf - \| ssh` (forced command) |
| SSH user | `jackbr4@narvi.whatbox.ca` |
| Assumed extract path | `/home/jackbr4/apps/janskiairplane/dist/` |
| Public URL | http://narvi.whatbox.ca:8790/ |
| Content | Static files only — no server-side runtime |
| Size | ~190 KB uncompressed, ~80 KB on the wire |

Thank you!
