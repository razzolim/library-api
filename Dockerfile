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
ENV DATABASE_URL="file:/app/data/prod.db"

# Non-secret defaults for the seeded demo account (see documents/backend-api-specification.md
# Section 6.1) — override with `-e` for a different demo account. JWT_SECRET has no default here
# on purpose: it must always be supplied explicitly.
ENV DEMO_USER_USERNAME="reader"
ENV DEMO_USER_PASSWORD="reader"
ENV DEMO_USER_FULL_NAME="Demo Reader"
ENV DEMO_USER_ROLE="reader"

EXPOSE 3000
VOLUME ["/app/data"]

# Applies pending migrations, (re)runs the idempotent seed, then starts the server.
CMD ["sh", "-c", "mkdir -p /app/data && npx prisma migrate deploy && node prisma/seed.js && node src/server.js"]
