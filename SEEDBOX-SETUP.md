# Seedbox setup — Topaz W&B calculator

Thanks for helping. This is a small static site (~190 KB of HTML/CSS/JS, no
backend, no database) that should be served at:

> **http://narvi.whatbox.ca:8790/**

A GitHub Actions workflow builds it and `rsync`s the output over SSH to:

> **`/home/jackbr4/apps/janskiairplane/dist/`**

Everything in the pipeline works except the final delivery. Below is what we
know, then four things we'd like you to check.

---

## Current symptom

`http://narvi.whatbox.ca:8790/` returns **HTTP 200**, but serves a 61-byte
placeholder rather than the app:

```html
<!doctype html><html><body><p>Deploying…</p></body></html>
```

Its `Last-Modified` is **2026-06-08**, so it has not been touched in ~2.5
months. Our deploys are not reaching whatever directory nginx is serving.

On the GitHub side the run gets as far as connecting over SSH, then either
fails to authenticate or hangs during the rsync handshake.

---

## What we need checked

Please run these as the `jackbr4` user and send back the output. All are
read-only except #3, which only creates a directory.

### 1. Is the deploy key installed?

```bash
ssh-keygen -lf ~/.ssh/authorized_keys
```

This prints a **fingerprint** for each authorised key — no secret material.
Our CI prints the fingerprint of the key it holds, so if one of yours matches,
authentication is correctly set up. If none match, the public half of our
deploy key never made it into `authorized_keys` and we'll send you the
`.pub` line to append.

Also worth confirming permissions, since sshd silently refuses keys if these
are too open:

```bash
ls -ld ~ ~/.ssh
ls -l  ~/.ssh/authorized_keys
```

Expected: home `755` or stricter, `~/.ssh` `700`, `authorized_keys` `600`.

### 2. Is `rsync` available to a non-interactive SSH session?

This matters: rsync runs over a *non-login* shell, which sometimes has a
different `PATH` than an interactive one.

```bash
ssh jackbr4@localhost 'command -v rsync'
```

If that prints nothing, rsync isn't reachable the way our deploy invokes it,
and we'll switch to a `tar`-over-SSH transfer instead. Not a problem — we just
need to know.

### 3. Does the target directory exist and is it writable?

```bash
mkdir -p /home/jackbr4/apps/janskiairplane/dist
ls -ld  /home/jackbr4/apps/janskiairplane/dist
touch   /home/jackbr4/apps/janskiairplane/dist/.write-test && echo "writable" \
  && rm /home/jackbr4/apps/janskiairplane/dist/.write-test
```

### 4. ⚠️ The one we most suspect — what is nginx actually serving on 8790?

This is our leading theory: the files may be landing correctly in
`…/janskiairplane/dist/`, while nginx serves port 8790 from a **different**
directory that still contains the June placeholder.

```bash
grep -rn -A15 '8790' /etc/nginx/ 2>/dev/null | grep -iE '8790|root|alias|server_name'
```

or, if nginx config lives in your home directory:

```bash
grep -rn -A15 '8790' ~/.config/nginx ~/nginx ~/.nginx 2>/dev/null \
  | grep -iE '8790|root|alias'
```

And to find the placeholder itself:

```bash
find /home/jackbr4 -name '*.html' -newermt '2026-06-01' ! -newermt '2026-06-30' 2>/dev/null
grep -rl 'Deploying' /home/jackbr4 --include='*.html' 2>/dev/null
```

**What we need from this:** the `root` (or `alias`) path for the port-8790
server block.

- If it is **not** `/home/jackbr4/apps/janskiairplane/dist`, either point it
  there and reload nginx, or tell us the correct path and we'll change our
  deploy target instead — whichever you prefer. Changing our end is a
  one-line edit, so please don't reconfigure anything on our account.
- Whichever directory it is, nginx needs read access to it and to every parent
  directory in the path.

---

## Two optional extras

Neither blocks us; both would be nice if they're easy on your side.

**a. HTTPS.** The app is a Progressive Web App that pilots install to their
phone home screen. Service workers — the part that makes it work **offline in
the cockpit, with no signal** — are disabled by browsers on plain HTTP. Over
HTTP it still installs and runs, but only with a connection. If there's a
straightforward way to put it behind TLS, offline mode starts working with no
change on our side.

**b. `index.html` caching.** Filenames for JS/CSS are content-hashed, so those
are safe to cache forever, but `index.html` should not be cached aggressively
or phones will keep booting an old build after a deploy. If nginx has a
long default cache header, something like this is ideal:

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
| Deploy method | GitHub Actions → `rsync -az --delete` over SSH |
| SSH user | `jackbr4@narvi.whatbox.ca` |
| Target path | `/home/jackbr4/apps/janskiairplane/dist/` |
| Public URL | http://narvi.whatbox.ca:8790/ |
| Content | Static files only — no server-side runtime required |
| Total size | ~190 KB |

Note that our deploy uses `rsync --delete`, which mirrors the build output and
removes files not present in it. It is scoped strictly to the `dist/`
directory above and touches nothing else.

Thank you!
