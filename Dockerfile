FROM oven/bun:1.2-alpine

WORKDIR /app

# Copy root workspace config (lockfile excluded — workspace subset differs from local)
COPY package.json ./

# Copy ALL package.json files for workspace lockfile resolution
COPY packages/shared/package.json packages/shared/
COPY packages/services/package.json packages/services/
COPY packages/jobs/package.json packages/jobs/
COPY packages/recruiter/package.json packages/recruiter/
COPY packages/teller/package.json packages/teller/
COPY packages/coach/package.json packages/coach/
COPY packages/claude/package.json packages/claude/
COPY packages/content/package.json packages/content/
COPY packages/autonomous/package.json packages/autonomous/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/golems-tui/package.json packages/golems-tui/
COPY packages/ralph/package.json packages/ralph/

# Install workspace dependencies
RUN bun install --production

# Copy source code (only packages needed for cloud worker)
COPY packages/shared/ packages/shared/
COPY packages/services/ packages/services/
COPY packages/jobs/ packages/jobs/
COPY packages/recruiter/ packages/recruiter/
COPY packages/teller/ packages/teller/
COPY packages/coach/ packages/coach/
COPY packages/claude/ packages/claude/
COPY packages/content/ packages/content/
COPY packages/autonomous/ packages/autonomous/

# Run cloud worker
CMD ["bun", "run", "packages/services/src/cloud-worker.ts"]
