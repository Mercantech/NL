FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html qa.html pakkeliste.html previous-years.html styles.css script.js /usr/share/nginx/html/
COPY media /usr/share/nginx/html/media

# wget is available in alpine nginx image for healthchecks
RUN apk add --no-cache wget

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --retries=6 --start-period=10s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
