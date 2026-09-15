FROM node:20-alpine

# Prisma's query engine needs OpenSSL on Alpine.
RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma

RUN npm install --omit=dev && npx prisma generate

COPY src ./src

ENV NODE_ENV=production
ENV PORT=3000

# Non-secret defaults for the seeded demo account (see documents/backend-api-specification.md
# Section 6.1) — override with `-e` for a different demo account. DATABASE_URL and JWT_SECRET have
# no defaults here on purpose: they must always be supplied explicitly (see docker-compose.yml).
ENV DEMO_USER_USERNAME="reader"
ENV DEMO_USER_PASSWORD="reader"
ENV DEMO_USER_FULL_NAME="Demo Reader"
ENV DEMO_USER_ROLE="reader"

EXPOSE 3000

# Migrations are applied by the `liquibase` service before this container starts (see
# docker-compose.yml). (Re)runs the idempotent seed, then starts the server.
CMD ["sh", "-c", "node prisma/seed.js && node src/server.js"]
