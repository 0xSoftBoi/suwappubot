# Minimal non-US egress reverse proxy for HyperUnit (see Caddyfile + README).
FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile

# Caddy reads $PORT (set by Railway) via the {$PORT} placeholder in the Caddyfile.
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
