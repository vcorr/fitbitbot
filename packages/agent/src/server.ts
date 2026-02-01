import "dotenv/config";
import express, { Request, Response } from "express";
import { Runner, InMemorySessionService } from "@google/adk";
import { rootAgent } from "./index.js";

const app = express();
app.use(express.json());

// Initialize the runner with in-memory sessions
const sessionService = new InMemorySessionService();
const runner = new Runner({
  appName: "fitness_coach",
  agent: rootAgent,
  sessionService,
});

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", agent: "fitness_coach" });
});

// Chat endpoint
app.post("/chat", async (req: Request, res: Response) => {
  try {
    const { message, userId, sessionId = "default" } = req.body;

    if (!message) {
      res.status(400).json({ error: "message is required" });
      return;
    }

    if (!userId) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    // Ensure session exists
    let session = await sessionService.getSession({
      appName: "fitness_coach",
      userId,
      sessionId,
    });
    if (!session) {
      session = await sessionService.createSession({
        appName: "fitness_coach",
        userId,
        sessionId,
        state: {},
      });
    }

    // Run the agent and collect all events
    const events = runner.runAsync({
      userId,
      sessionId,
      newMessage: {
        role: "user",
        parts: [{ text: message }],
      },
    });

    // Collect the agent's response
    let responseText = "";
    for await (const event of events) {
      // Look for the agent's final response
      if (event.author === "fitness_coach" && event.content?.parts) {
        for (const part of event.content.parts) {
          if ("text" in part && part.text) {
            responseText += part.text;
          }
        }
      }
    }

    res.json({
      response: responseText,
      userId,
      sessionId,
    });
  } catch (error) {
    console.error("Error running agent:", error);
    res.status(500).json({
      error: "Internal server error",
    });
  }
});

// List sessions (useful for debugging)
app.get("/sessions/:userId", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;
    const sessions = await sessionService.listSessions({
      appName: "fitness_coach",
      userId,
    });
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: "Failed to list sessions" });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Fitness coach agent running on port ${PORT}`);
});
