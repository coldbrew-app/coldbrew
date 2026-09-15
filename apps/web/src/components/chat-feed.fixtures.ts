import type { ChatMessage, ChatSourceId } from "@streambrew/packages/chat.js";

const sourceIds = {
  youtube: "00000000-0000-4000-8000-000000000001",
  twitch: "00000000-0000-4000-8000-000000000002",
  kick: "00000000-0000-4000-8000-000000000003",
  boosty: "00000000-0000-4000-8000-000000000004",
  vk_video: "00000000-0000-4000-8000-000000000005",
} as const satisfies Record<ChatMessage["provider"], ChatSourceId>;

const connectionIds = {
  youtube: "00000000-0000-4000-8000-000000000011",
  twitch: "00000000-0000-4000-8000-000000000012",
  kick: "00000000-0000-4000-8000-000000000013",
  boosty: "00000000-0000-4000-8000-000000000014",
  vk_video: "00000000-0000-4000-8000-000000000015",
} as const;

const messageTemplates = [
  {
    provider: "youtube",
    author: "Кофейный зритель",
    text: "Вот это момент! Пересмотрю после стрима ☕",
  },
  {
    provider: "twitch",
    author: "very_long_viewer_name",
    text: "Длинное сообщение спокойно переносится и не перекрывает весь кадр трансляции.",
  },
  {
    provider: "kick",
    author: "Зелёный сигнал",
    text: "Привет из Kick! Сегодня отличный эфир 🔥",
  },
  {
    provider: "boosty",
    author: "Подписчик Boosty",
    text: "Спасибо за длинный стрим — как раз заварил ещё чашку.",
  },
  {
    provider: "vk_video",
    author: "Гость из VK Видео",
    text: "Ссылка тоже остаётся читаемой: https://example.com/watch?v=streambrew-preview",
  },
] as const;

export const chatFeedMessages = Array.from({ length: 400 }, (_, index): ChatMessage => {
  const template = messageTemplates[index % messageTemplates.length];
  const messageNumber = index + 1;

  return {
    id: `${template.provider}-${messageNumber}`,
    sourceId: sourceIds[template.provider],
    connectionId: connectionIds[template.provider],
    provider: template.provider,
    author: {
      id: `viewer-${messageNumber}`,
      displayName: `${template.author} · ${messageNumber}`,
    },
    text: template.text,
    occurredAt: new Date(Date.UTC(2026, 8, 13, 18, 0, index)),
  };
});
