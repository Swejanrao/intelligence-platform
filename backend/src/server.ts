import "dotenv/config";
import { app } from "./app";
import { prisma } from "./config/database";

const port = Number(process.env.PORT || 5000);

async function start() {
  await prisma.$connect();
  app.listen(port, () => console.log(`Assessment API listening at http://localhost:${port}`));
}

start().catch(async (error) => {
  console.error("Failed to start API:", error);
  await prisma.$disconnect();
  process.exit(1);
});

process.on("SIGINT", async () => { await prisma.$disconnect(); process.exit(0); });
process.on("SIGTERM", async () => { await prisma.$disconnect(); process.exit(0); });
