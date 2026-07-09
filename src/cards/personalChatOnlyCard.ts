import { CardFactory } from "@microsoft/agents-hosting";

export function buildPersonalChatOnlyCard() {
  const card = {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.4",
    body: [
      {
        type: "TextBlock",
        text: "Personal chat only",
        weight: "Bolder",
        size: "Medium",
        color: "Attention",
      },
      {
        type: "TextBlock",
        text: "Data Assistant is available in 1:1 personal chat only. Group chats and channels are not supported.",
        wrap: true,
        spacing: "Medium",
      },
      {
        type: "TextBlock",
        text: "How to start a 1:1 chat:",
        weight: "Bolder",
        spacing: "Large",
        size: "Small",
      },
      {
        type: "TextBlock",
        text: "• Open Teams chat\n• Search for \"Data Assistant\"\n• Send your question directly",
        wrap: true,
        spacing: "Small",
      },
    ],
  };

  return CardFactory.adaptiveCard(card);
}
