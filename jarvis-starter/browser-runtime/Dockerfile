FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /worker
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY worker.mjs ./
USER pwuser
ENTRYPOINT ["node", "/worker/worker.mjs"]
