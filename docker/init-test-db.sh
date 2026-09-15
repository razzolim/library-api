#!/bin/sh
# Runs once when the `db` container first initializes its data volume (Postgres's
# docker-entrypoint-initdb.d convention). Provisions a second database, alongside the main
# POSTGRES_DB one, for `npm test` to run against so tests never touch dev data.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE library_test;
EOSQL
