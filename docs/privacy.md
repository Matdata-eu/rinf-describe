# Privacy statement

RINF Describe does not ship a privacy statement of its own: whoever runs an
instance is the one who processes visitors' data, so they write it. The app
gives that statement a place.

## Adding one

Put a page at `site/privacy.html` next to `docker-compose.yml`. The
`describe-web` container serves the `site/` folder read-only at `/site/`, and
when `site/privacy.html` exists the app shows a **Privacy** link in the footer
and in the About dialog. Without the file there is no link. No rebuild or
restart is needed: the app checks for the page on every load.

```sh
cp site/privacy.example.html site/privacy.html   # then edit it
```

The page is served as is, so it can be a full HTML page with your own styling
(it opens in a new tab). If the statement already lives elsewhere, for example
on your organisation's website, make `site/privacy.html` a redirect:

```html
<!doctype html>
<meta http-equiv="refresh" content="0; url=https://example.org/privacy">
<a href="https://example.org/privacy">Privacy statement</a>
```

Everything in `site/` except the examples is git-ignored, so `git pull` does
not touch it. If you run the published images without a checkout, create the
`site/` folder next to your `docker-compose.yml`.

## What the app processes

A starting point for what to disclose, for an instance run with the default
configuration. Check it against your own setup (reverse proxy, log shipping,
backups, hosting provider).

**In the visitor's browser**

- No cookies, analytics, trackers or third-party fonts and scripts (the IBM
  Plex fonts are served by the instance).
- `localStorage`, which never leaves the browser:
  - `describe-theme`, only when the visitor picks a light or dark theme;
  - `describe-tour`, that the visitor has seen the first-visit tour;
  - `describe-whats-new-seen`, the latest release the visitor has seen in
    What's new.
- **Share** and **Copy** write to the clipboard only when clicked.

**Requests the browser makes to third parties**

- On pages with a map (sections of line, for example): basemap tiles from
  `tile.openstreetmap.org` (OpenStreetMap Foundation) and railway overlay tiles
  from `{a,b,c}.tiles.openrailwaymap.org`. The visitor's IP address, user agent
  and the page as referrer reach them; the OSMF's
  [privacy policy](https://osmfoundation.org/wiki/Privacy_Policy) applies.
- Links to ERA, RINF Atlas and GitHub are only followed when clicked.

**On your server**

- nginx (`describe-web`) logs every request: client IP address, time, URL and
  user agent. Page and API URLs contain the IRI of the resource viewed and the
  text typed in the search box. uvicorn (`describe-api`) logs requests as well,
  with the IP address of the nginx container. Both go to the Docker log driver;
  retention is whatever you configure there.
- Pages, searches and exports are answered from RINF Atlas's database and are
  not stored apart from those logs.

**Requests your server makes to ERA**

- For a resource that is not in the index (`DESCRIBE_LIVE=1`, the default),
  the API queries ERA's SPARQL endpoint. The request comes from your server and
  carries only the resource's IRI, not the visitor's IP address.
- RINF Atlas's worker, not RINF Describe, keeps the index current from ERA.

The RINF data itself describes railway infrastructure published by the
infrastructure managers through ERA.
