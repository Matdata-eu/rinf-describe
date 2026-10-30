# Search engines and link previews

RINF Describe does the technical part of search engine optimisation for every
instance. The parts tied to your domain and your organisation are yours.

## What the app does

The `describe-web` container writes these when it starts
(`web/docker-entrypoint.d/40-describe-seo.sh`), from two settings in `.env`:

| `.env` | Effect |
| --- | --- |
| `DESCRIBE_PUBLIC_URL` empty (default) | Search engines are asked not to index the instance: `robots.txt` disallows everything, pages carry `<meta name="robots" content="noindex">` and an `X-Robots-Tag: noindex` header. There are no sitemaps. Right for private, internal and test instances. |
| `DESCRIBE_PUBLIC_URL=https://rinf-describe.example.org` | Indexing allowed. `index.html` gets a canonical link, absolute `og:url` and `og:image` and JSON-LD (`schema.org/WebApplication`); `robots.txt` allows everything except `/api/` and points to `/sitemap.xml`. |
| `DESCRIBE_PUBLIC_URL=…` and `DESCRIBE_INDEXING=off` | Link previews work (canonical and Open Graph tags), but search engines are asked not to index it and there are no sitemaps. For a public test or UAT instance. |

Every instance also has a description, Open Graph and Twitter card tags, a
social preview image (`/og-image.jpg`, 1200 × 630), icons and a web manifest,
and a `<noscript>` text describing the app, so crawlers that do not run
JavaScript still see what it is. `/api/` always answers with
`X-Robots-Tag: noindex`.

### One indexable page per resource

Unlike RINF Atlas, which is one map view, every resource here has its own
address, `/describe?uri=<IRI>&env=<env>`. When a page opens, the app
(`web/src/seo.ts`) sets:

- the title, `<name> · RINF Describe`;
- a description from the class, the name, the key facts on the badges and the
  data provider, e.g. *Section of line Michelau <-> Goebelsmuhle in the EU
  Register of Railway Infrastructure (RINF, PROD): 2 tracks, Maximum permitted
  speed 95 km/h, 4.506 km, Electrified 2 of 2.*;
- the canonical link and `og:url`, `/describe?uri=<IRI>&env=<default env>`
  without the tab, so the tabs of a page count as one page;
- `noindex` on pages that are not in the sitemap: other environments than the
  first in `DESCRIBE_ENVS` (UAT), resources without a class page, and unknown
  addresses.

The sitemaps list exactly those canonical addresses. `/sitemap.xml` is an
index served by the API (`DESCRIBE_PUBLIC_URL` is passed to it too):
`/sitemap-site.xml` with the start page and your pages in `site/`, written by
the web container at start, then `/sitemap-1.xml`, `/sitemap-2.xml`, … with
40,000 describe pages each and the publication date of their dataset as
`lastmod`. The API reads them from ERA's SPARQL endpoint (every resource of a
class with a shape) and keeps them for a day: a resource ERA adds shows up the
next day.

The settings apply on every start: change `.env` and run
`docker compose up -d`. Check the result with:

```sh
curl -s https://rinf-describe.example.org/robots.txt
curl -s https://rinf-describe.example.org/ | grep -E 'canonical|robots'
curl -s https://rinf-describe.example.org/sitemap.xml
docker compose logs describe-web | grep describe-seo
```

## What you do for a public instance

1. **Serve it on its own HTTPS hostname**, for example
   `https://rinf-describe.example.org`, not under a path of another site. Put a
   TLS proxy (Traefik, Caddy, nginx) in front of the `describe-web` container.
2. **Set the public address** in `.env`:
   `DESCRIBE_PUBLIC_URL=https://rinf-describe.example.org`, then
   `docker compose up -d`.
3. **Redirect the alternatives** to that one address with a 301 on your
   proxy: `http://` to `https://`, `www.` to the bare name (or the other way
   round), and any old hostname. Search engines then count one address.
4. **Register the site** in [Google Search Console](https://search.google.com/search-console)
   and [Bing Webmaster Tools](https://www.bing.com/webmasters). Verify
   ownership with a DNS TXT record (nothing to change in the app), then
   submit `https://<your host>/sitemap.xml`. Pages are rendered with
   JavaScript, which Google and Bing run; expect indexing of the describe
   pages to take weeks and to cover part of them. Check the coverage report
   after a month.
5. **Check the link preview** by pasting your address into the
   [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/). Link
   previews show the site-wide title and image: preview bots do not run
   JavaScript, so they do not see a page's own title.
6. **Add pages of your own if you want**, such as a page about your
   organisation or the [privacy statement](privacy.md), in `site/` next to
   `docker-compose.yml`. They are served at `/site/…` and listed in the
   sitemap on the next start (`*.example.html` files are not).
7. **Analytics are your choice.** The app ships none. If you add some through
   your proxy, prefer a cookieless tool and mention it in `site/privacy.html`.
8. **Get linked.** For a specialised tool, ranking comes from links: your
   organisation's website, your RINF Atlas instance (its describe links can
   point here), rail and open data community pages.
9. **Keep `/api/` out of crawlers' reach.** If your proxy serves its own
   `robots.txt`, keep `Disallow: /api/` and the `Sitemap:` line.

## Not covered

Pages are not prerendered on the server, so a crawler that runs no
JavaScript sees the site-wide tags and the `<noscript>` text only. If you run
a read-only root filesystem (`read_only: true`), the start script cannot write
and the instance stays at the built-in noindex.
