FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY src ./src

RUN npm ci --legacy-peer-deps
RUN npm run build

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV CLODDS_STATE_DIR=/data
ENV CLODDS_WORKSPACE=/data/workspace

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps

COPY --from=builder /app/dist ./dist

RUN mkdir -p /data /data/workspace .transformers-cache

# Pre-download embedding model so it's warm at runtime (no first-request hang)
RUN node -e "const{pipeline,env}=require('@xenova/transformers');env.cacheDir='./.transformers-cache';pipeline('feature-extraction','Xenova/all-MiniLM-L6-v2',{quantized:true}).then(()=>console.log('Model cached')).catch(e=>console.error('Model cache failed:',e))"

EXPOSE 18789

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:18789/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
