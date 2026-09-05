FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/folio-mcp/package.json packages/folio-mcp/
COPY packages/fiken-mcp/package.json packages/fiken-mcp/
RUN npm ci
COPY packages/folio-mcp packages/folio-mcp
RUN npm run build --workspace=@bruchris/folio-mcp

FROM node:22-alpine AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/folio-mcp/package.json packages/folio-mcp/
COPY packages/fiken-mcp/package.json packages/fiken-mcp/
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/packages/folio-mcp/dist packages/folio-mcp/dist
COPY packages/folio-mcp/LICENSE packages/folio-mcp/
WORKDIR /app/packages/folio-mcp
ENV HOST=0.0.0.0
ENV PORT=3000
USER node
EXPOSE 3000
CMD ["node", "dist/http.js"]
