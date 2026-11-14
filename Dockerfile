# The site is static files: a non-root nginx serves them on 8080. infra/deploy.ps1 builds and pushes this image.
FROM nginxinc/nginx-unprivileged:1.27-alpine
# the image's entrypoint fills ${SITE_DOMAIN} in from the environment (infra/atlas.bicep sets it; empty: no redirect)
ENV SITE_DOMAIN=""
COPY infra/nginx.conf /etc/nginx/templates/default.conf.template
COPY --chown=nginx:nginx index.html LICENSE robots.txt sitemap.xml /usr/share/nginx/html/
COPY --chown=nginx:nginx assets /usr/share/nginx/html/assets
COPY --chown=nginx:nginx atlas /usr/share/nginx/html/atlas
EXPOSE 8080
