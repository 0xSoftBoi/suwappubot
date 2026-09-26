This change intentionally separates build-time frontend configuration from runtime service discovery:

- Vite continues to build the React application.
- Railway provides `API_TS_PRIVATE_DOMAIN` at runtime via a service reference variable.
- nginx performs the runtime reverse proxy.
- The browser never needs to know the backend service hostname.
