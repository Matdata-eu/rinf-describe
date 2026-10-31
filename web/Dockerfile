# --- build stage ---
# The static bundle is the same on every architecture, so build it on the builder's platform;
# npm under qemu emulation crashes (illegal instruction).
FROM --platform=$BUILDPLATFORM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Shown in the About dialog; CI passes the release tag (falls back to package.json).
ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION
RUN npm run build

# --- runtime stage ---
FROM nginx:1.31-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/describe/security.conf
COPY --from=build /app/dist /usr/share/nginx/html
# Search engine settings from DESCRIBE_PUBLIC_URL / DESCRIBE_INDEXING at start (docs/seo.md);
# until then, and if the script cannot run, the instance asks not to be indexed.
COPY docker-entrypoint.d/40-describe-seo.sh /docker-entrypoint.d/
RUN chmod +x /docker-entrypoint.d/40-describe-seo.sh \
 && mkdir -p /etc/nginx/describe /usr/share/nginx/html/site \
 && echo 'add_header X-Robots-Tag "noindex, nofollow" always;' > /etc/nginx/describe/robots.conf \
 && : > /etc/nginx/describe/sitemaps.conf
EXPOSE 80
