#!/bin/sh
# Limits on the API, written when the container starts (the nginx image runs
# /docker-entrypoint.d/*.sh before nginx). Every uncached page is several queries to ERA's
# shared SPARQL endpoint, so one client should not be able to ask for thousands. See docs/deploy.md.
#
#   DESCRIBE_RATE_LIMIT       requests per second per client to /api/ (default 10), with
#                             bursts of four times that; "off" for no limit.
#   DESCRIBE_TRUSTED_PROXIES  reverse proxies in front of this one (addresses or CIDR ranges,
#                             comma or space separated). Their X-Forwarded-For then names the
#                             client; without it every visitor behind the proxy shares one limit.
set -eu

ME=$(basename "$0")
DIR=/etc/nginx/describe

if ! [ -w "$DIR" ]; then
  echo "$ME: $DIR is read-only, leaving the API limits as built" >&2
  exit 0
fi

rate=${DESCRIBE_RATE_LIMIT:-10}
if [ "$rate" != off ] && ! printf '%s' "$rate" | grep -Eq '^[1-9][0-9]{0,4}$'; then
  echo "$ME: DESCRIBE_RATE_LIMIT is not a whole number of requests per second or \"off\", using 10: $rate" >&2
  rate=10
fi

{
  if [ "$rate" != off ]; then
    echo "limit_req_zone \$binary_remote_addr zone=describe_api:10m rate=${rate}r/s;"
    echo "limit_req_status 429;"
  fi
  trusted=
  for p in $(printf '%s' "${DESCRIBE_TRUSTED_PROXIES:-}" | tr ',' ' '); do
    if printf '%s' "$p" | grep -Eq '^[0-9A-Fa-f:.]+(/[0-9]{1,3})?$'; then
      echo "set_real_ip_from $p;"
      trusted=yes
    else
      echo "$ME: DESCRIBE_TRUSTED_PROXIES: not an address or CIDR range, ignoring it: $p" >&2
    fi
  done
  if [ -n "$trusted" ]; then
    echo "real_ip_header X-Forwarded-For;"
    echo "real_ip_recursive on;"
  fi
} > "$DIR/http.conf"

if [ "$rate" = off ]; then
  : > "$DIR/api-limit.conf"
  echo "$ME: no rate limit on /api/ (DESCRIBE_RATE_LIMIT=off)"
else
  echo "limit_req zone=describe_api burst=$((rate * 4)) nodelay;" > "$DIR/api-limit.conf"
  echo "$ME: /api/ limited to $rate requests per second per client"
fi
