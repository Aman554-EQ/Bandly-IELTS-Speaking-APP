-- Runs once, when the container's data volume is first created.
-- A separate database for `pnpm test:db`, so tests never touch your dev data.
CREATE DATABASE bandly_test OWNER bandly;
