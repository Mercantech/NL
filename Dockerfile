FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html qa.html pakkeliste.html previous-years.html learning-objectives.html 2026.html styles.css script.js i18n.js favicon.png favicon-32.png apple-touch-icon.png /usr/share/nginx/html/
COPY media /usr/share/nginx/html/media
COPY billetter.html billetter.js ticket-journeys.mjs /usr/share/nginx/html/
COPY helmond-program.mjs helmond-program-data.mjs /usr/share/nginx/html/
COPY projekter-2026.html projekter-2026.mjs projekter-2026-data.mjs github-invertocat.svg /usr/share/nginx/html/
COPY manifest.webmanifest service-worker.js pwa.js app-icon-192.png app-icon-512.png /usr/share/nginx/html/

# Invalidate the offline cache whenever the app shell changes.
RUN cd /usr/share/nginx/html \
    && revision="$(sha256sum *.html *.js *.mjs *.css *.png *.svg *.webmanifest | sha256sum | cut -d ' ' -f 1)" \
    && sed -i "s/__PWA_REVISION__/${revision}/" service-worker.js

# wget is available in alpine nginx image for healthchecks
RUN apk add --no-cache wget

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --retries=6 --start-period=10s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
