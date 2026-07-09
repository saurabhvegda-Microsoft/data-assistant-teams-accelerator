import express from "express";
import axios from "axios";

const connectorApp = express();
connectorApp.use(express.json());

const capturedReplies: any[] = [];

connectorApp.post("/v3/conversations/:convId/activities", (req, res) => {
  capturedReplies.push(req.body);
  console.log(`\n--- Bot Reply #${capturedReplies.length} ---`);
  console.log(`Type: ${req.body.type}`);
  if (req.body.attachments?.length) {
    const card = req.body.attachments[0];
    const content = card.content || {};
    const title = content.body?.[0]?.text ?? "(no title)";
    const actions = (content.actions || []).map(
      (a: any) => `${a.type}${a.url ? " -> " + a.url : a.title ? " (" + a.title + ")" : ""}`
    );
    console.log(`Card: ${card.contentType}`);
    console.log(`Title: ${title}`);
    if (actions.length) console.log(`Actions: ${actions.join(" | ")}`);
  } else if (req.body.text) {
    console.log(`Text: ${req.body.text}`);
  }
  res.json({ id: `reply-${capturedReplies.length}` });
});

connectorApp.post("/v3/conversations/:convId/activities/:actId", (req, res) => {
  capturedReplies.push(req.body);
  console.log(`\n--- Bot Reply (update) #${capturedReplies.length} ---`);
  console.log(`Type: ${req.body.type}`);
  res.json({ id: `reply-${capturedReplies.length}` });
});

const CONNECTOR_PORT = 3980;
const BOT_PORT = 3978;

async function run() {
  await new Promise<void>((resolve) => {
    connectorApp.listen(CONNECTOR_PORT, () => {
      console.log(`Mock connector listening on http://localhost:${CONNECTOR_PORT}`);
      resolve();
    });
  });

  const questions = [
    "What is the revenue by region?",
    "Show me monthly revenue trend",
    "Show me an interactive chart",
    "What are the profit margins?",
    "Tell me about quantum physics",
  ];

  for (const question of questions) {
    capturedReplies.length = 0;
    console.log(`\n========================================`);
    console.log(`QUESTION: "${question}"`);
    console.log(`========================================`);

    try {
      await axios.post(`http://localhost:${BOT_PORT}/api/messages`, {
        type: "message",
        text: question,
        from: { id: "user1", name: "Test User" },
        recipient: { id: "bot1", name: "Data Assistant Bot" },
        conversation: { id: "test-conv-1", tenantId: "test-tenant", conversationType: "personal" },
        channelId: "msteams",
        serviceUrl: `http://localhost:${CONNECTOR_PORT}`,
      }, { timeout: 30000 });
    } catch (err: any) {
      if (err.response) {
        console.log(`HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`);
      } else {
        console.log(`Error: ${err.message}`);
      }
    }

    await new Promise((r) => setTimeout(r, 4000));
    console.log(`Total replies captured: ${capturedReplies.length}`);
  }

  console.log("\n\nAll tests complete.");
  process.exit(0);
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
