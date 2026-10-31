#!/bin/sh
# Search engine settings of this instance, written when the container starts
# (the nginx image runs /docker-entrypoint.d/*.sh before nginx). See docs/seo.md.
#
#   DESCRIBE_PUBLIC_URL  public address, e.g. https://rinf-describe.example.org.
#                        Set: canonical links, absolute og:url/og:image, sitemaps, indexing allowed.
#                        Empty: the instance asks search engines not to index it.
#   DESCRIBE_INDEXING    "off" keeps an instance with a public address out of search engines
#                        (test, UAT); anything else lets DESCRIBE_PUBLIC_URL decide.
set -eu

ME=$(basename "$0")
HTML=/usr/share/nginx/html
SNIPPET_DIR=/etc/nginx/describe

url=$(printf '%s' "${DESCRIBE_PUBLIC_URL:-}" | sed 's#/*$##')
# Only plain URL characters: the value is written into HTML, JSON and XML as is.
if [ -n "$url" ] && ! printf '%s' "$url" | grep -Eq '^https?://[A-Za-z0-9._~:/?#@!$()*+,;=%-]+$'; then
  echo "$ME: DESCRIBE_PUBLIC_URL is not a plain http(s) URL, ignoring it: $url" >&2
  url=
fi

index=no
if [ -n "$url" ] && [ "${DESCRIBE_INDEXING:-}" != off ]; then index=yes; fi

if ! [ -w "$HTML/index.html" ] || ! [ -w "$HTML" ]; then
  echo "$ME: $HTML is read-only, leaving the search engine settings as built" >&2
  exit 0
fi

# Tags between the describe:seo markers in index.html (replaced on every start). The app
# points the canonical link and og:url at each page as it opens (web/src/seo.ts).
head=$(mktemp)
if [ -n "$url" ]; then
  cat > "$head" <<EOT
    <link rel="canonical" href="$url/" />
    <meta property="og:url" content="$url/" />
    <meta property="og:image" content="$url/og-image.jpg" />
    <meta name="twitter:image" content="$url/og-image.jpg" />
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebApplication","name":"RINF Describe","url":"$url/","applicationCategory":"ReferenceApplication","operatingSystem":"Any (web browser)","isAccessibleForFree":true,"offers":{"@type":"Offer","price":"0","priceCurrency":"EUR"},"description":"Readable pages for the sections of line, tracks and other resources of the EU Register of Railway Infrastructure (ERA RINF).","image":"$url/og-image.jpg","license":"https://opensource.org/licenses/MIT","codeRepository":"https://github.com/Matdata-eu/rinf-describe","isBasedOn":"https://www.era.europa.eu/domains/registers/rinf_en"}</script>
EOT
fi
if [ "$index" = no ]; then
  echo '    <meta name="robots" content="noindex, nofollow" />' >> "$head"
fi
out=$(mktemp)
awk -v f="$head" '
  /<!-- describe:seo -->/ { print; while ((getline l < f) > 0) print l; skip = 1; next }
  /<!-- \/describe:seo -->/ { skip = 0 }
  !skip { print }
' "$HTML/index.html" > "$out"
cat "$out" > "$HTML/index.html"
rm -f "$head" "$out"

if [ "$index" = yes ]; then
  cat > "$HTML/robots.txt" <<EOT
User-agent: *
Disallow: /api/
Crawl-delay: 1

Sitemap: $url/sitemap.xml
EOT
  # The start page and the deployer's pages in ./site (docs/privacy.md), not the shipped
  # examples. The API serves /sitemap.xml (the index) and the describe pages' sitemaps.
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    echo "  <url><loc>$url/</loc></url>"
    for f in "$HTML"/site/*.html; do
      [ -f "$f" ] || continue
      case "$f" in *.example.html) continue ;; esac
      echo "  <url><loc>$url/site/$(basename "$f")</loc></url>"
    done
    echo '</urlset>'
  } > "$HTML/sitemap-site.xml"
  noindex=
  sitemaps='location = /sitemap.xml { include /etc/nginx/describe/api-limit.conf; set $u http://describe-api:8000; proxy_pass $u/api/sitemap.xml; }
location ~ "^/sitemap-([0-9]{1,6})\.xml$" { include /etc/nginx/describe/api-limit.conf; set $u http://describe-api:8000; proxy_pass $u/api/sitemap-$1.xml; }'
  echo "$ME: search engines may index $url/"
else
  printf 'User-agent: *\nDisallow: /\n' > "$HTML/robots.txt"
  rm -f "$HTML/sitemap-site.xml"
  noindex='add_header X-Robots-Tag "noindex, nofollow" always;'
  sitemaps=
  if [ -n "$url" ]; then why="DESCRIBE_INDEXING=off"; else why="set DESCRIBE_PUBLIC_URL to allow it"; fi
  echo "$ME: asking search engines not to index this instance ($why)"
fi

# Included by nginx.conf: the header in every location that sends its own headers, the
# sitemap locations in the server block.
if [ -w "$SNIPPET_DIR" ]; then
  printf '%s\n' "$noindex" > "$SNIPPET_DIR/robots.conf"
  printf '%s\n' "$sitemaps" > "$SNIPPET_DIR/sitemaps.conf"
fi
