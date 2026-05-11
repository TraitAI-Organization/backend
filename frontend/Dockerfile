# Stage 1: Build the React/Vite app
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the frontend source
COPY . .

# Build-time API URL for Vite

# Default: use relative API path (works with nginx proxy in Docker + production)
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL

# Alternative (not recommended for Docker builds):
# ARG VITE_API_URL=http://localhost:8001/api/v1
# ENV VITE_API_URL=$VITE_API_URL
# This would require the backend to be accessible at localhost:8001
# → only useful when frontend runs outside Docker (npm run dev without proxy)

# Build-time Firebase web SDK config — Vite inlines `import.meta.env.VITE_*` at
# build time, so these MUST be present when `npm run build` runs. They're
# public-by-design (Firebase enforces access via security rules + authorized
# domains), so passing them as build-args is fine. Pass via:
#
#   docker build \
#     --build-arg VITE_FIREBASE_API_KEY=AIza... \
#     --build-arg VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com \
#     --build-arg VITE_FIREBASE_PROJECT_ID=your-project \
#     --build-arg VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app \
#     --build-arg VITE_FIREBASE_MESSAGING_SENDER_ID=... \
#     --build-arg VITE_FIREBASE_APP_ID=1:... \
#     -t traitharvest-frontend ./frontend
#
# Or in docker-compose, add `args:` under the `build:` block.
ARG VITE_FIREBASE_API_KEY=
ARG VITE_FIREBASE_AUTH_DOMAIN=
ARG VITE_FIREBASE_PROJECT_ID=
ARG VITE_FIREBASE_STORAGE_BUCKET=
ARG VITE_FIREBASE_MESSAGING_SENDER_ID=
ARG VITE_FIREBASE_APP_ID=

# Persist Firebase build-args into .env.production.local IF they were passed.
# Empty/unset args skip writing that line, which lets a checked-in .env.local
# (copied in by the COPY . . above) remain the source of truth when no args
# are provided. .env.production.local has higher priority than .env.local in
# Vite's loader, so passed args always win.
#
# IMPORTANT: do NOT use `ENV VITE_FOO=$VITE_FOO` for these — that would set
# process.env.VITE_FOO="" when the ARG is unset, which Vite treats as a set
# (empty) value and would override .env.local at build time.
RUN { \
      [ -n "$VITE_FIREBASE_API_KEY" ]             && printf 'VITE_FIREBASE_API_KEY=%s\n' "$VITE_FIREBASE_API_KEY"; \
      [ -n "$VITE_FIREBASE_AUTH_DOMAIN" ]         && printf 'VITE_FIREBASE_AUTH_DOMAIN=%s\n' "$VITE_FIREBASE_AUTH_DOMAIN"; \
      [ -n "$VITE_FIREBASE_PROJECT_ID" ]          && printf 'VITE_FIREBASE_PROJECT_ID=%s\n' "$VITE_FIREBASE_PROJECT_ID"; \
      [ -n "$VITE_FIREBASE_STORAGE_BUCKET" ]      && printf 'VITE_FIREBASE_STORAGE_BUCKET=%s\n' "$VITE_FIREBASE_STORAGE_BUCKET"; \
      [ -n "$VITE_FIREBASE_MESSAGING_SENDER_ID" ] && printf 'VITE_FIREBASE_MESSAGING_SENDER_ID=%s\n' "$VITE_FIREBASE_MESSAGING_SENDER_ID"; \
      [ -n "$VITE_FIREBASE_APP_ID" ]              && printf 'VITE_FIREBASE_APP_ID=%s\n' "$VITE_FIREBASE_APP_ID"; \
      true; \
    } > .env.production.local

# Build the production bundle
RUN npm run build

# Sanity check: fail the build if no Firebase API key made it into the bundle.
# Catches silent misconfigurations (missing .env.local AND missing build-args)
# at build time instead of at first user visit.
RUN if ! grep -q 'AIzaSy[A-Za-z0-9_-]\{10,\}' dist/js/index-*.js 2>/dev/null; then \
      echo "ERROR: No Firebase API key found in the built bundle." >&2; \
      echo "Either provide frontend/.env.local in the build context," >&2; \
      echo "or pass VITE_FIREBASE_* values via --build-arg." >&2; \
      exit 1; \
    fi

# Stage 2: Serve the built files with nginx
FROM nginx:stable-alpine

# Copy custom nginx config if you want SPA routing support
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the build output from the builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose nginx port
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
