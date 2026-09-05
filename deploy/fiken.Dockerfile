FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/folio-mcp/package.json packages/folio-mcp/
COPY packages/fiken-mcp/package.json packages/fiken-mcp/
RUN npm ci
COPY packages/fiken-mcp packages/fiken-mcp
RUN npm run build --workspace=@bruchris/fiken-mcp

FROM node:22-alpine AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/folio-mcp/package.json packages/folio-mcp/
COPY packages/fiken-mcp/package.json packages/fiken-mcp/
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/packages/fiken-mcp/dist packages/fiken-mcp/dist
COPY packages/fiken-mcp/LICENSE packages/fiken-mcp/
WORKDIR /app/packages/fiken-mcp
ENV HOST=0.0.0.0
ENV PORT=3001
USER node
EXPOSE 3001
CMD ["node", "dist/http.js"]
