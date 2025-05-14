import express, { Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { log } from "./vite";
import { db } from "./db";

// Create Express application
const app = express();

// Configure middleware
app.use(express.json());

// Register API routes
async function start() {
  try {
    // Test database connection
    try {
      await db.execute("SELECT 1");
      log("Database connection successful", "express");
    } catch (error) {
      log(`Database connection error: ${error}`, "express");
      throw new Error(`Database connection failed: ${error}`);
    }

    // Set up routes
    const server = await registerRoutes(app);

    // Start the server
    const port = process.env.PORT || 5000;
    server.listen(port, () => {
      log(`serving on port ${port}`, "express");
    });
  } catch (error) {
    log(`Failed to start server: ${error}`, "express");
    process.exit(1);
  }
}

// Error handling middleware
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({
    message: "An unexpected error occurred",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// Start the server
start().catch((error) => {
  console.error("Failed to start application:", error);
  process.exit(1);
});