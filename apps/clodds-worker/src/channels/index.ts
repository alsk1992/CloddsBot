/**
 * Channel Router
 */

export { handleTelegramWebhook, setWebhook as setTelegramWebhook } from './telegram';
export { handleDiscordInteraction, registerCommands as registerDiscordCommands } from './discord';
export { handleSlackEvent } from './slack';
